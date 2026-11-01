// Browser tests against the production build (dist/) with an in-memory Supabase stand-in. Run: npm run build && node tests/e2e.mjs
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
import { makeDb, installMock, USERS } from './mock-supabase.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const DIST = path.resolve(import.meta.dirname, '../dist'), SHOTS = process.env.SHOTS_DIR || path.resolve(import.meta.dirname, '../.shots');
fs.mkdirSync(SHOTS, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let f = path.join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname)); if (f.endsWith('/')) f += 'index.html';
  if (!f.startsWith(DIST) || !fs.existsSync(f)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(4173); const BASE = 'http://localhost:4173';

let pass = 0, fail = 0; const log = [];
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; log.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  → ' + extra}`); };
const session = (who) => JSON.stringify({ access_token: 'fake', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user: { id: USERS[who].id, email: USERS[who].email, aud: 'authenticated', user_metadata: { full_name: USERS[who].name } } });

const browser = await chromium.launch();
async function open(who, { viewport = { width: 1280, height: 860 }, db = makeDb(), seed = true, lang = 'ar' } = {}) {
  const context = await browser.newContext({ viewport, locale: lang === 'ar' ? 'ar-EG' : 'en-GB' });
  await installMock(context, db, who);
  if (seed) await context.addInitScript(([s, l]) => { try { if (!localStorage.getItem('ilogia-library-auth')) localStorage.setItem('ilogia-library-auth', s); localStorage.setItem('ilogia-library-lang', l); } catch {} }, [session(who), lang]);
  else await context.addInitScript((l) => { try { localStorage.setItem('ilogia-library-lang', l); } catch {} }, lang);
  const page = await context.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });
  return { page, db, errors, context };
}
const shot = (page, n) => page.screenshot({ path: path.join(SHOTS, n + '.png') });
const R = (db, n) => db.resources.find((r) => r.title === n || r.id.endsWith(String(n).padStart(12, '0')));

try {
  // 1 ─ auth gate + sign-in
  { const { page, errors } = await open('student', { seed: false });
    await page.goto(BASE + '/'); await page.waitForSelector('.auth');
    check('signed-out visitors see the sign-in screen (RTL, Arabic)', (await page.getAttribute('html', 'dir')) === 'rtl' && (await page.textContent('.auth-form h2')).includes('تسجيل الدخول'));
    await shot(page, '01-auth');
    await page.fill('[name=email]', 'bad'); await page.fill('[name=password]', '12345678'); await page.click('.auth-form button[type=submit]');
    check('invalid email is rejected client-side', (await page.textContent('.notice')).includes('بريدًا إلكترونيًا صحيحًا'));
    await page.fill('[name=email]', 'student@test.local'); await page.fill('[name=password]', 'password1'); await page.click('.auth-form button[type=submit]');
    await page.waitForSelector('.hero', { timeout: 8000 }); check('password sign-in reaches the home page', true);
    check('no console errors during sign-in', errors.length === 0, errors.join(' | ')); await page.context().close(); }

  // 2 ─ student journey
  const S = await open('student'); const { page, db } = S;
  await page.goto(BASE + '/'); await page.waitForSelector('.shelf .res');
  check('home: hero greets by first name', (await page.textContent('.hero h1')).includes('منى'));
  check('home: latest shelf lists published resources only', (await page.$$('.shelf .res')).length === 8);
  check('home: no pending/rejected resource appears to students', !(await page.content()).includes('Pending upload'));
  check('home: category tiles show real counts', (await page.textContent('.cats')).includes('٢٧ مصدر'));
  check('home: most-viewed appears because real views exist', (await page.textContent('[data-rest]')).includes('الأكثر مشاهدة'));
  check('home: no "continue reading" before reading anything', !(await page.textContent('[data-rest]')).includes('أكمل القراءة'));
  await shot(page, '02-home');
  check('XSS: malicious title is rendered as text, not executed', (await page.evaluate(() => window.__xss)) === undefined && (await page.content()).includes('&lt;img src=x'));
  check('cover images are signed (private bucket)', db.calls.some((c) => c.includes('/storage/v1/object/sign/library-resources')));
  check('sidebar hides Upload and Admin for students', !(await page.$('[data-nav=upload]')) && !(await page.$('a[href="/admin/"]')));

  // explore
  await page.click('[data-nav=explore]'); await page.waitForSelector('[data-results] .res');
  check('explore: first page has 24 cards', (await page.$$('[data-results] .res')).length === 24);
  await page.click('[data-page="2"]'); await page.waitForFunction(() => document.querySelectorAll('[data-results] .res').length === 6); check('explore: pagination page 2 has the remaining 6', true);
  await page.fill('[data-filters] [name=q]', 'الجبر'); await page.waitForFunction(() => document.querySelectorAll('[data-results] .res').length === 1); check('explore: search by title', (await page.textContent('[data-count]')).includes('١ نتيجة'));
  check('explore: URL keeps the search state', page.url().includes('q='));
  await page.fill('[data-filters] [name=q]', 'zzzz-nothing'); await page.waitForSelector('.state--empty'); check('explore: empty state when nothing matches', (await page.textContent('.state--empty')).includes('لا توجد نتائج'));
  await page.click('[data-clear]'); await page.waitForFunction(() => document.querySelectorAll('[data-results] .res').length === 24);
  await page.selectOption('[name=subject]', '2'); await page.waitForFunction(() => document.querySelectorAll('[data-results] .res').length === 1); check('explore: subject filter', true);
  await page.click('[data-view=list]'); await page.waitForSelector('.row-card'); check('explore: list view', true); await shot(page, '03-explore-list');

  // resource details + bookmark
  await page.goto(BASE + '/#/resource/' + R(db, 1).id); await page.waitForSelector('.detail');
  check('details: title, facts and actions render', (await page.textContent('.detail h1')).includes('الجبر') && (await page.textContent('.facts')).includes('الرياضيات') && !!(await page.$('[data-open]')) && !!(await page.$('[data-download]')));
  check('details: view event recorded server-side', db.events.some((e) => e.kind === 'view'));
  await shot(page, '04-resource');
  await page.click('.detail [data-bm]'); await page.waitForFunction(() => document.querySelector('.detail [data-bm]').getAttribute('aria-pressed') === 'true');
  check('bookmark: saved through the API', db.bookmarks.length === 1);
  await page.goto(BASE + '/#/resource/' + R(db, 2).id); await page.waitForSelector('.detail');
  check('details: read-only resource has no download button and says so', !(await page.$('[data-download]')) && (await page.textContent('.badges')).includes('قراءة فقط'));
  await page.goto(BASE + '/#/resource/' + R(db, 4).id); await page.waitForSelector('.detail'); await page.click('[data-open]'); await page.waitForSelector('video.player'); check('details: video plays inline from a signed URL', (await page.getAttribute('video.player', 'src')).includes('token='));

  // reader
  await page.goto(BASE + '/#/read/' + R(db, 1).id); await page.waitForSelector('[data-canvas]:not([hidden])', { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('[data-total]').textContent.includes('12') || document.querySelector('[data-total]').textContent.includes('١٢'));
  check('reader: PDF opens and knows its page count', true); await shot(page, '05-reader');
  const w0 = await page.evaluate(() => document.querySelector('[data-canvas]').width);
  await page.click('[data-next]'); await page.waitForFunction(() => document.querySelector('[data-goto]').value === '2'); check('reader: next page', true);
  await page.fill('[data-goto]', '7'); await page.press('[data-goto]', 'Enter'); await page.waitForFunction(() => document.querySelector('[data-goto]').value === '7'); check('reader: go to a specific page', true);
  await page.click('[data-zin]'); await page.waitForTimeout(400); check('reader: zoom in enlarges the canvas', (await page.evaluate(() => document.querySelector('[data-canvas]').width)) > w0);
  await page.click('[data-fs]'); check('reader: full-screen mode toggles', await page.evaluate(() => document.querySelector('[data-reader]').classList.contains('is-fs'))); await page.click('[data-fs]');
  await page.keyboard.press('ArrowLeft'); await page.waitForFunction(() => document.querySelector('[data-goto]').value === '8'); check('reader: RTL arrow key moves to the next page', true);
  await page.waitForTimeout(2000);
  check('reader: last page saved to the server (debounced)', db.progress.some((p) => p.last_page === 8 && p.page_count === 12 && p.percent === 67), JSON.stringify(db.progress));
  await page.goto(BASE + '/#/'); await page.goto(BASE + '/#/read/' + R(db, 1).id); await page.waitForFunction(() => document.querySelector('[data-goto]')?.value === '8', null, { timeout: 15000 });
  check('reader: reopening resumes at the saved page', true);
  await page.goto(BASE + '/#/'); await page.waitForSelector('[data-rest]'); await page.waitForFunction(() => document.querySelector('[data-rest]').textContent.includes('أكمل القراءة'));
  check('home: "continue reading" now shows the progress', (await page.textContent('[data-rest]')).includes('٦٧'));

  // my library
  await page.goto(BASE + '/#/my'); await page.waitForSelector('[data-panel] .res'); check('my library: saved tab lists the bookmarked resource', (await page.$$('[data-panel] .res')).length === 1);
  await page.click('[data-tab=lists]'); await page.click('[data-newlist]'); await page.fill('.modal [name=n]', 'مراجعة الترم'); await page.click('.modal .btn.primary'); await page.waitForSelector('.cat');
  check('my library: custom list created', db.collections.length === 1);
  await page.goto(BASE + '/#/resource/' + R(db, 1).id); await page.waitForSelector('[data-list]'); await page.click('[data-list]'); await page.check('.modal .checks input'); await page.click('.modal .btn.primary');
  await page.waitForFunction(() => document.querySelector('.toast'), null, { timeout: 5000 }); check('list: resource added to the list', db.items.length === 1);
  await page.goto(BASE + '/#/my?tab=history'); await page.waitForSelector('.history'); check('my library: history shows viewed items', (await page.$$('.history li')).length >= 1);
  await shot(page, '06-my');
  await page.goto(BASE + '/#/resource/' + R(db, 2).id); await page.click('[data-report]'); await page.selectOption('.modal [name=reason]', 'broken_file'); await page.click('.modal .btn.primary');
  await page.waitForTimeout(400); check('report: stored with the chosen reason', db.reports.length === 1 && db.reports[0].reason === 'broken_file');
  await page.goto(BASE + '/#/upload'); await page.waitForSelector('.state'); check('upload: students without rights see an explanation', (await page.textContent('.state')).includes('الرفع غير متاح'));
  check('student session: no unexpected console errors', S.errors.length === 0, S.errors.join(' | '));
  await S.context.close();

  // 3 ─ English / LTR + mobile
  { const { page, errors } = await open('student', { lang: 'en', viewport: { width: 390, height: 800 } });
    await page.goto(BASE + '/'); await page.waitForSelector('.shelf .res');
    check('English: document switches to LTR', (await page.getAttribute('html', 'dir')) === 'ltr' && (await page.textContent('.hero h1')).startsWith('Hi'));
    check('mobile: no horizontal overflow on home', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    check('mobile: sidebar is off-canvas until the menu is opened', !(await page.isVisible('.side .nav-item >> nth=0')) || (await page.evaluate(() => document.querySelector('.side').getBoundingClientRect().left < 0)));
    await page.click('[data-menu]'); await page.waitForTimeout(300); check('mobile: menu opens', await page.evaluate(() => { const r = document.querySelector('.side').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1; }));
    await shot(page, '07-mobile-en'); await page.click('[data-nav=explore]'); await page.waitForSelector('[data-results] .res');
    check('mobile: no horizontal overflow on explore', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    check('English session: no console errors', errors.length === 0, errors.join(' | ')); await page.context().close(); }

  // 4 ─ teacher upload
  { const T = await open('teacher'); const { page, db } = T; await page.goto(BASE + '/#/upload'); await page.waitForSelector('[data-form]');
    check('teacher sees the upload nav item', !!(await page.$('[data-nav=upload]')));
    await page.setInputFiles('[data-file]', path.resolve(import.meta.dirname, 'fixtures/malware.exe')); await page.waitForSelector('.drop.has-error');
    check('upload: executable is refused', (await page.textContent('.err')).includes('غير مسموح'));
    await page.setInputFiles('[data-file]', path.resolve(import.meta.dirname, 'fixtures/fake.pdf')); await page.waitForSelector('.drop.has-error .err, .err');
    check('upload: a text file renamed to .pdf is refused by content sniffing', (await page.textContent('.err')).includes('محتوى الملف'));
    await page.setInputFiles('[data-file]', path.resolve(import.meta.dirname, 'fixtures/sample.pdf')); await page.waitForSelector('.drop b');
    check('upload: a real PDF is accepted and the title is pre-filled', (await page.inputValue('[name=title]')) === 'sample');
    await page.click('.form [type=submit]'); await page.waitForSelector('.has-error'); check('upload: required fields and the rights checkbox are enforced', (await page.$$('.err')).length >= 2);
    await page.fill('[name=title]', 'مذكرة الفيزياء الأولى'); await page.selectOption('[name=category_id]', '2'); await page.selectOption('[name=subject_id]', '1'); await page.check('[name=rights]');
    await page.setInputFiles('[data-cover]', path.resolve(import.meta.dirname, 'fixtures/cover.png')); await page.waitForSelector('.cover-prev img');
    await shot(page, '08-upload'); await page.click('.form [type=submit]'); await page.waitForSelector('.review'); check('upload: review step before sending', (await page.textContent('.review')).includes('مذكرة الفيزياء'));
    await shot(page, '09-upload-review'); await page.click('[data-submit]'); await page.waitForSelector('.state--ok', { timeout: 15000 });
    const row = db.resources.find((r) => r.title === 'مذكرة الفيزياء الأولى');
    check('upload: resource stored as pending (not published) with page count', row && row.status === 'pending' && row.page_count === 12 && row.file_size === fs.statSync(path.resolve(import.meta.dirname, 'fixtures/sample.pdf')).size, JSON.stringify(row));
    check('upload: file went to the private bucket under u/<uid>/<id>/file.pdf', db.uploads.some((u) => u.bucketName === 'library-resources' && new RegExp(`^u/${USERS.teacher.id}/[0-9a-f-]{36}/file\\.pdf$`).test(u.objectName)), JSON.stringify(db.uploads));
    check('upload: cover uploaded next to it', db.uploads.some((u) => /\/cover\.png$/.test(u.objectName)));
    check('upload: appears in "my uploads" with the under-review status', (await page.textContent('[data-mine]')).includes('قيد المراجعة'));
    check('upload: a rejected upload shows the reason', (await page.textContent('[data-mine]')).includes('الصورة غير واضحة'));
    check('teacher session: no console errors', T.errors.length === 0, T.errors.join(' | ')); await T.context.close();

    // 5 ─ admin
    const db2 = db; const N = await open('student', { db: db2 }); await N.page.goto(BASE + '/admin/'); await N.page.waitForSelector('.state');
    check('admin: a non-admin is refused', (await N.page.textContent('.state')).includes('ليس مسؤولًا')); await N.context.close();
    db2.reports.push({ id: 'rep1', resource_id: db2.resources[1].id, reporter_id: USERS.student.id, reason: 'broken_file', details: 'لا يفتح', status: 'open', created_at: new Date().toISOString() });
    const A = await open('admin', { db: db2 }); const ap = A.page; await ap.goto(BASE + '/admin/'); await ap.waitForSelector('.tiles');
    check('admin: overview shows server statistics', (await ap.textContent('.tiles')).includes('متاح')); await shot(ap, '10-admin');
    await ap.click('[data-nav=queue]'); await ap.waitForSelector('.q-item'); check('admin: review queue lists pending resources', (await ap.$$('.q-item')).length === 2);
    await ap.click(`.q-item:has-text("مذكرة الفيزياء") [data-approve]`); await ap.waitForFunction(() => document.querySelectorAll('.q-item').length === 1);
    check('admin: approving publishes through the RPC', row.status === 'published'); await shot(ap, '11-admin-queue');
    await ap.click('.q-item [data-reject]'); await ap.fill('.modal [name=why]', 'المحتوى غير مكتمل'); await ap.click('.modal .btn.danger');
    await ap.waitForSelector('.state'); check('admin: rejection needs and stores a reason', db2.resources.find((r) => r.title === 'Pending upload').reject_reason === 'المحتوى غير مكتمل');
    await ap.click('[data-nav=resources]'); await ap.waitForSelector('.table'); check('admin: resources table', (await ap.$$('.table tbody tr')).length === 20);
    await ap.click('[data-nav=categories]'); await ap.waitForFunction(() => document.querySelectorAll('.table tbody tr').length === 6); check('admin: categories table lists the six kinds', (await ap.$$('.table tbody tr')).length === 6);
    await ap.click('[data-nav=reports]'); await ap.waitForSelector('.q-item'); check('admin: reports list shows the student report', (await ap.textContent('.q-item')).includes('الملف لا يفتح'));
    check('admin session: no console errors', A.errors.length === 0, A.errors.join(' | ')); await A.context.close(); }
} catch (e) { check('test run crashed', false, e.stack || e.message); }
finally { await browser.close(); server.close(); }
console.log(log.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
