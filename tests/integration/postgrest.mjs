// Runs the REAL src/lib/api.js query layer against a REAL PostgREST + PostgreSQL that has our migrations applied.
// This is what proves the client queries (embeds, or-filters, upserts, counts, RPCs) and RLS work end-to-end.
// Needs a PostgREST binary:  POSTGREST_BIN=/path/to/postgrest   and must be run as a non-root user.
import EmbeddedPostgres from 'embedded-postgres'; import { spawn } from 'node:child_process'; import http from 'node:http'; import crypto from 'node:crypto';
import fs from 'node:fs'; import path from 'node:path';
import { createServer } from 'vite';

const root = path.resolve(import.meta.dirname, '../..'), BIN = process.env.POSTGREST_BIN;
if (!BIN || !fs.existsSync(BIN)) { console.log('SKIP: set POSTGREST_BIN to a PostgREST binary'); process.exit(0); }
const SECRET = 'test-secret-test-secret-test-secret-1234567890';
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const jwt = (sub) => { const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64({ sub, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, email: sub + '@t.test' }); return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`; };
const U = { admin: '00000000-0000-0000-0000-0000000000a1', teacher: '00000000-0000-0000-0000-0000000000b1', s1: '00000000-0000-0000-0000-0000000000c1', s2: '00000000-0000-0000-0000-0000000000c2' };
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x = '') => { c ? pass++ : fail++; out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  → ' + x}`); };
const rejects = async (n, fn, re) => { try { await fn(); ok(n, false, 'expected an error'); } catch (e) { ok(n, !re || re.test(`${e.message} ${e.code}`), `${e.message} ${e.code}`); } };

const pg = new EmbeddedPostgres({ databaseDir: path.join(process.env.TMPDIR || '/tmp', 'ilogia-pgrst-' + process.pid), user: 'postgres', password: 'pw', port: 54330, persistent: false });
let rest, proxy, vite;
try {
  await pg.initialise(); await pg.start(); await pg.createDatabase('t'); const c = pg.getPgClient('t'); await c.connect();
  await c.query(fs.readFileSync(path.join(root, 'tests/sql/stubs.sql'), 'utf8'));
  for (const id of Object.values(U)) await c.query('insert into auth.users(id,email) values ($1,$2)', [id, id + '@t.test']);
  await c.query(`insert into profiles(id,is_teacher) values ($1,true),($2,false),($3,false),($4,false)`, [U.teacher, U.s1, U.s2, U.admin]);
  await c.query('insert into admins values ($1)', [U.admin]);
  await c.query(`insert into subjects values (1,'Math'),(2,'Arabic')`); await c.query(`insert into grades values (1,'G1'),(2,'G2')`);
  const dir = path.join(root, 'supabase/migrations'); for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await c.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  await c.query('grant usage on schema public to anon, authenticated');
  const ins = (t, i, o = {}) => c.query(`insert into library_resources (id,title,description,category_id,subject_id,grade_id,file_type,source,storage_bucket,storage_path,status,uploaded_by,allow_download,published_at)
     values (gen_random_uuid(),$1,$2,$3,$4,$5,'pdf','upload','library-resources',$6,$7,$8,$9, case when $7='published' then now() - ($10||' hours')::interval end) returning id`,
    [t, o.d ?? null, o.cat ?? 1, o.sub ?? 1, o.gr ?? 1, `u/${U.teacher}/${i}/file.pdf`, o.status ?? 'published', U.teacher, o.dl ?? false, String(i)]);
  const r1 = (await ins('الجبر والهندسة', 1, { d: 'ملخص الجبر', dl: true })).rows[0].id, r2 = (await ins('Arabic grammar', 2, { cat: 2, sub: 2, gr: 2 })).rows[0].id, rp = (await ins('Pending thing', 3, { status: 'pending' })).rows[0].id;
  for (let i = 0; i < 30; i++) await ins('Filler ' + i, 100 + i);
  await c.query(`update library_resources set views_count = 5 where id = $1`, [r1]);

  rest = spawn(BIN, [], { env: { PGRST_DB_URI: 'postgres://postgres:pw@localhost:54330/t', PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon', PGRST_JWT_SECRET: SECRET, PGRST_SERVER_PORT: '3040', PGRST_DB_EXTRA_SEARCH_PATH: 'public,extensions' }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 2500));
  proxy = http.createServer((req, res) => {   // mimic supabase.co: /rest/v1/* → PostgREST, /auth/v1/user → the JWT's user
    if (req.url.startsWith('/auth/v1/user')) { const t = (req.headers.authorization || '').split('.')[1]; const p = JSON.parse(Buffer.from(t || 'e30', 'base64url')); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ id: p.sub, email: p.email, aud: 'authenticated', user_metadata: {} })); }
    const up = http.request({ host: 'localhost', port: 3040, path: req.url.replace('/rest/v1', ''), method: req.method, headers: { ...req.headers, host: 'localhost:3040' } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    req.pipe(up); up.on('error', () => { res.writeHead(502); res.end(); });
  }).listen(3041);
  process.env.VITE_SUPABASE_URL = 'http://localhost:3041'; process.env.VITE_SUPABASE_KEY = 'anon-key';
  vite = await createServer({ root, configFile: false, cacheDir: path.join(process.env.TMPDIR || '/tmp', 'vite-cache'), server: { middlewareMode: true }, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true } });
  const api = await vite.ssrLoadModule('/src/lib/api.js'); const { sb } = await vite.ssrLoadModule('/src/lib/supabase.js');
  const as = async (who) => { const t = jwt(U[who]); const { error } = await sb.auth.setSession({ access_token: t, refresh_token: 'x' }); if (error) throw error; };

  // ── student
  await as('s1');
  const cats = await api.meta.categories(); ok('categories load (6 seeded)', cats.length === 6);
  const who = await api.whoami({ user: { id: U.s1, email: 'a@b', user_metadata: {} } }); ok('whoami: student is neither admin nor uploader', !who.isAdmin && !who.canUpload);
  const p1 = await api.listResources({ page: 1 }); ok('list: embeds category/subject/grade + exact count + page size', p1.count === 32 && p1.rows.length === 24 && p1.rows[0].category?.slug && p1.rows.every((r) => r.status === 'published'), JSON.stringify(p1.rows[0]).slice(0, 200));
  const p2 = await api.listResources({ page: 2 }); ok('list: page 2 has the rest', p2.rows.length === 8);
  ok('list: pending resources are invisible to students', ![...p1.rows, ...p2.rows].some((r) => r.id === rp));
  const s = await api.listResources({ q: 'الجبر' }); ok('search finds Arabic title (or + ilike)', s.count === 1 && s.rows[0].id === r1);
  const s2 = await api.listResources({ q: 'ملخص' }); ok('search matches the description too', s2.count === 1);
  const s3 = await api.listResources({ q: "x,y%(z)'" }); ok('hostile search text cannot break the or() filter', s3.count === 0);
  const f1 = await api.listResources({ subject: 2, grade: 2, category: 2, type: 'pdf' }); ok('combined filters', f1.count === 1 && f1.rows[0].id === r2);
  const byViews = await api.listResources({ sort: 'views' }); ok('sort by views', byViews.rows[0].id === r1);
  const byName = await api.listResources({ sort: 'name' }); ok('sort by name', byName.rows[0].title <= byName.rows[1].title);
  const f = await api.meta.facets(); ok('facets RPC', f.total === 32 && f.category['1'] === 31 && f.file_type.pdf === 32);
  const top = await api.mostViewed(); ok('most viewed only returns items with real views', top.length === 1 && top[0].id === r1);
  const one = await api.getResource(r1); ok('getResource with embeds', one.title === 'الجبر والهندسة' && one.subject.name === 'Math');
  ok('getResource of a pending item is null for students', (await api.getResource(rp)) === null);
  const rel = await api.related(one); ok('related resources exclude itself', rel.every((r) => r.id !== r1));
  await api.track(r1, 'view'); await api.track(r1, 'view'); await api.track(r1, 'read');
  ok('track: view counted once, read recorded', (await c.query('select views_count from library_resources where id=$1', [r1])).rows[0].views_count === 6);
  await api.bookmarks.add(r1); await api.bookmarks.add(r1);
  ok('bookmarks: add is idempotent', (await api.bookmarks.ids()).size === 1 && (await api.bookmarks.list()).length === 1 && (await api.bookmarks.list())[0].resource.title === 'الجبر والهندسة');
  await api.progress.save(r1, 7, 20); await api.progress.save(r1, 9, 20); const pr = await api.progress.get(r1);
  ok('progress: upsert keeps one row with the latest page + percent', pr.last_page === 9 && pr.percent === 45 && (await api.progress.list()).length === 1);
  const col = await api.collections.create('مراجعة الترم', 'x'); await api.collections.add(col.id, r1); await api.collections.add(col.id, r1);
  const cl = await api.collections.list(); ok('collections: create + item count', cl.length === 1 && cl[0].items[0].count === 1);
  ok('collections: items + containing', (await api.collections.items(col.id)).length === 1 && (await api.collections.containing(r1)).has(col.id));
  await api.collections.removeItem(col.id, r1); ok('collections: remove item', (await api.collections.items(col.id)).length === 0);
  await rejects('collections: duplicate names refused', () => api.collections.create('مراجعة الترم'), /23505|duplicate/);
  await api.report(r1, 'copyright', 'details'); await rejects('report: second open report refused', () => api.report(r1, 'other'), /23505|duplicate/);
  ok('history: lists own events with embedded resource', (await api.history()).some((h) => h.kind === 'view' && h.resource?.id === r1));
  await rejects('student cannot read admin stats', () => api.admin.stats(), /not_admin/);
  await rejects('student cannot approve', () => api.admin.review(rp, 'approve'), /not_admin/);
  await rejects('student cannot create a resource', () => api.uploads.create({ title: 'nope nope', category_id: 1, file_type: 'pdf', source: 'upload', storage_bucket: 'library-resources', storage_path: `u/${U.s1}/x/file.pdf` }), /42501|row-level/);
  // student 2 isolation
  await as('s2'); ok('another student sees none of s1’s bookmarks/progress/collections/reports', (await api.bookmarks.ids()).size === 0 && (await api.progress.list()).length === 0 && (await api.collections.list()).length === 0 && (await api.history()).length === 0);

  // ── teacher
  await as('teacher'); ok('whoami: teacher can upload', (await api.whoami({ user: { id: U.teacher, email: 'a@b', user_metadata: {} } })).canUpload === true);
  const id = crypto.randomUUID();
  const made = await api.uploads.create({ id, title: 'مذكرة جديدة', category_id: 2, subject_id: 1, grade_id: 1, source: 'upload', file_type: 'pdf', storage_bucket: 'library-resources', storage_path: `u/${U.teacher}/${id}/file.pdf`, original_filename: 'a.pdf', mime_type: 'application/pdf', file_size: 10, page_count: 3, allow_download: false, status: 'published' });
  ok('upload: even asking for "published", a teacher gets pending', made.status === 'pending');
  ok('upload: "my uploads" lists it', (await api.uploads.mine(U.teacher)).some((r) => r.id === id));
  await rejects('upload: link source needs https (constraint)', () => api.uploads.create({ title: 'bad link', category_id: 1, source: 'external', file_type: 'link', external_url: 'http://insecure.example' }), /23514|check/);

  // ── admin
  await as('admin'); const A = await api.whoami({ user: { id: U.admin, email: 'a@b', user_metadata: {} } }); ok('whoami: admin', A.isAdmin && A.canUpload);
  const q = await api.admin.list({ status: 'pending' }); ok('admin: queue lists the 2 pending resources', q.count === 2, q.count);
  await api.admin.review(id, 'approve'); ok('admin: approve publishes', (await c.query('select status,published_at is not null p from library_resources where id=$1', [id])).rows[0].p === true);
  await api.admin.review(rp, 'reject', 'blurry'); ok('admin: reject stores the reason', (await c.query('select reject_reason from library_resources where id=$1', [rp])).rows[0].reject_reason === 'blurry');
  await api.admin.update(r2, { title: 'Arabic grammar (2nd ed.)', allow_download: true }); ok('admin: edit metadata', (await api.getResource(r2)).title.includes('2nd'));
  const st = await api.admin.stats(); ok('admin: stats are computed server-side', st.by_status.published === 33 && st.total_views >= 6 && st.open_reports === 1 && st.daily.length === 30, JSON.stringify(st).slice(0, 200));
  const reps = await api.admin.reports('open'); ok('admin: reports list with resource', reps.length === 1 && reps[0].resource.id === r1);
  await api.admin.resolveReport(reps[0].id, 'resolved', 'checked', U.admin); ok('admin: resolve report', (await api.admin.reports('open')).length === 0);
  await api.admin.saveCategory({ slug: 'labs', name_ar: 'المعامل', name_en: 'Labs', icon: 'folder', sort_order: 70, is_active: true }); ok('admin: add category', (await api.admin.allCategories()).length === 7);
  await api.admin.remove({ id, source: 'upload' }); ok('admin: delete resource', (await c.query('select 1 from library_resources where id=$1', [id])).rowCount === 0);
  await as('s1'); ok('student sees the newly approved resource count change', (await api.listResources({})).count === 32);
  await c.end();
} catch (e) { ok('integration run crashed', false, e.stack || e.message); }
finally { try { rest?.kill(); proxy?.close(); await vite?.close(); await pg.stop(); } catch { /* ignore */ } }
console.log(out.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
