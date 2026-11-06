import { createClient } from './vendor/supabase.esm.js';
// Same Supabase project as the main iLogia site. Only the public publishable key lives here; access is enforced by RLS / get_library_file().
const sb = createClient('https://zugwicbbfbefbbwugfxq.supabase.co', 'sb_publishable_34jNpaqwtFeYboTVgO-mYw_efc0T-Ew', { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'ilogia-library-auth' } });
const MAIN = 'https://ilogia-eg.com', PER = 24, COLS = 'id,title,unit,grade_id,subject_id,academic_year,type,is_free,grade:grades(name),subject:subjects(name,icon)';
const L = { ar: { home: 'الرئيسية', explore: 'استكشاف', my: 'مكتبتي', up: 'رفع وإدارة', hi: 'ماذا تريد أن تقرأ اليوم؟', q: 'ابحث بالعنوان أو الوحدة…', search: 'بحث', all: 'الكل', subj: 'المادة', grade: 'الصف', type: 'النوع', sort: 'الأحدث', name: 'الاسم', none: 'لا توجد مصادر مطابقة.', empty: 'المكتبة فارغة حاليًا. ستظهر المصادر هنا فور إضافتها.', open: 'فتح المصدر', read: 'قراءة', save: 'حفظ', saved: 'محفوظ', share: 'مشاركة', copied: 'تم نسخ الرابط', free: 'مجاني', paid: 'للمشتركين', back: 'رجوع', cont: 'أكمل القراءة', latest: 'أحدث المصادر', savedH: 'المحفوظات', lists: 'قوائمي', newList: 'قائمة جديدة', hist: 'آخر ما فتحته', prev: 'السابق', next: 'التالي', pg: 'صفحة', of: 'من', fs: 'ملء الشاشة', fit: 'ملاءمة العرض', zoomOut: 'تصغير', zoomIn: 'تكبير', err: 'تعذّر التحميل. تحقق من الاتصال وحاول مرة أخرى.', sub: 'هذا المصدر متاح للمشتركين فقط.', lang: 'English', upT: 'الرفع والإدارة يتمّان من لوحة iLogia الأساسية (صلاحيات المعلم/الأدمن).', go: 'افتح لوحة الإدارة', added: 'أُضيف إلى القائمة', ph: 'تذكّر آخر صفحة' }, en: { home: 'Home', explore: 'Explore', my: 'My Library', up: 'Upload & admin', hi: 'What would you like to read today?', q: 'Search title or unit…', search: 'Search', all: 'All', subj: 'Subject', grade: 'Grade', type: 'Type', sort: 'Newest', name: 'Name', none: 'No matching resources.', empty: 'The library is empty for now. Resources will appear here once added.', open: 'Open', read: 'Read', save: 'Save', saved: 'Saved', share: 'Share', copied: 'Link copied', free: 'Free', paid: 'Subscribers', back: 'Back', cont: 'Continue reading', latest: 'Latest', savedH: 'Saved', lists: 'My lists', newList: 'New list', hist: 'Recently opened', prev: 'Prev', next: 'Next', pg: 'Page', of: 'of', fs: 'Fullscreen', fit: 'Fit width', zoomOut: 'Zoom out', zoomIn: 'Zoom in', err: 'Could not load. Check your connection and retry.', sub: 'This resource is for subscribers only.', lang: 'العربية', upT: 'Uploading and moderation are done from the main iLogia dashboard (teacher/admin).', go: 'Open dashboard', added: 'Added to list', ph: 'Remembers your last page' } };
let lang = localStorage.getItem('lib-lang') || 'ar', user = null, cat = null;
const t = (k) => L[lang][k] || k, $ = (s, r = document) => r.querySelector(s), app = $('#app');
const esc = (v) => String(v ?? '').replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));
const store = (k, d) => { try { return JSON.parse(localStorage.getItem(`lib:${user?.id}:${k}`)) ?? d; } catch { return d; } };
const put = (k, v) => { try { localStorage.setItem(`lib:${user?.id}:${k}`, JSON.stringify(v)); } catch { /* storage full/blocked */ } };
const hash = () => { const [p, q = ''] = (location.hash.slice(1) || '/').split('?'); return { p, q: Object.fromEntries(new URLSearchParams(q)) }; };
const card = (r) => `<a class="res" href="#/item/${esc(r.id)}"><div class="cv" ${/pdf/i.test(r.type || '') ? `data-preview="${esc(r.id)}"` : ''} aria-hidden="true"><img class="cv-img" alt=""><span class="cv-label">${esc(r.subject?.name || r.type || '')}</span></div><div class="tx"><b>${esc(r.title)}</b><small>${esc([r.grade?.name, r.unit].filter(Boolean).join(' · '))}</small><span><span class="badge ${r.is_free ? '' : 'gold'}">${t(r.is_free ? 'free' : 'paid')}</span> <span class="badge">${esc(r.type || '')}</span></span></div></a>`;
const spin = '<div class="spin" role="status"></div>';
const fail = (e) => { console.error(e); return `<div class="state"><p>${t('err')}</p><button class="btn" onclick="location.reload()">↻</button></div>`; };
const previewCache = new Map();
function setupPreviews(container) {
  const targets = container.querySelectorAll('.cv[data-preview]');
  if (!targets.length || !('IntersectionObserver' in window)) return;
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      const { target } = entry, id = target.dataset.preview;
      let preview = previewCache.get(id);
      if (!preview) {
        preview = renderPreview(id);
        previewCache.set(id, preview);
        if (previewCache.size > 40) previewCache.delete(previewCache.keys().next().value);
      }
      preview.then((src) => {
        if (!target.isConnected) return;
        target.querySelector('.cv-img').src = src;
        target.classList.add('is-preview');
      }).catch((error) => {
        if (previewCache.get(id) === preview) previewCache.delete(id);
        console.warn(`Could not create PDF preview for ${id}`, error);
      });
    }
  }, { rootMargin: '180px' });
  targets.forEach((target) => observer.observe(target));
}
async function renderPreview(id) {
  const [lib, url] = await Promise.all([loadPdfjs(), signedUrl(id)]);
  const doc = await lib.getDocument({ url, rangeChunkSize: 262144, disableAutoFetch: true, isEvalSupported: false }).promise;
  try {
    const page = await doc.getPage(1), original = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(0.55, 320 / original.width) });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    return canvas.toDataURL('image/jpeg', 0.75);
  } finally {
    await doc.destroy();
  }
}

async function boot() {
  document.documentElement.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  const { data: { session } } = await sb.auth.getSession(); user = session?.user || null;
  if (!cat) try { const [g, s, i] = await Promise.all([sb.from('grades').select('*').order('sort_order'), sb.from('subjects').select('*').order('sort_order'), sb.from('library_items').select('type')]); cat = { g: g.data || [], s: s.data || [], types: [...new Set((i.data || []).map((x) => x.type).filter(Boolean))] }; } catch { cat = { g: [], s: [], types: [] }; }
  const { p } = hash(), on = (k) => (p === k || p.startsWith(k + '/') ? 'class="on"' : '');
  app.innerHTML = `<header class="top"><div class="in"><a href="#/" class="brand" style="display:flex;gap:8px;align-items:center;font:700 1.1rem var(--serif);color:var(--primary-d);text-decoration:none"><img src="logo-mark.png" width="36" height="36" alt="">iLogia Library</a><nav class="pillnav" aria-label="main"><a href="#/" ${p === '/' ? 'class="on"' : ''}>${t('home')}</a><a href="#/explore" ${on('/explore')}>${t('explore')}</a><a href="#/my" ${on('/my')}>${t('my')}</a></nav><div class="acts"><button class="btn g s" id="lg">${t('lang')}</button></div></div></header><main id="v">${spin}</main>`;
  $('#lg').onclick = () => { lang = lang === 'ar' ? 'en' : 'ar'; localStorage.setItem('lib-lang', lang); boot(); };
  const v = $('#v'), route = { '/': home, '/explore': explore, '/my': my, '/upload': upload }[p];
  try { scrollTo(0, 0); if (route) await route(v); else if (p.startsWith('/item/')) await item(v, p.slice(6)); else if (p.startsWith('/read/')) await reader(v, p.slice(6)); else v.innerHTML = `<div class="state"><h1>404</h1><a class="btn" href="#/">${t('home')}</a></div>`; } catch (e) { v.innerHTML = fail(e); }
}
const fetchItems = ({ q = '', subject, grade, type, sort = 'new', page = 1, limit = PER } = {}) => {
  let r = sb.from('library_items').select(COLS, { count: 'exact' });
  const s = q.replace(/[%,()\\_]/g, ' ').trim().slice(0, 80); if (s) r = r.or(`title.ilike.%${s}%,unit.ilike.%${s}%`);
  if (/^\d+$/.test(subject || '')) r = r.eq('subject_id', +subject); if (/^\d+$/.test(grade || '')) r = r.eq('grade_id', +grade); if (type) r = r.eq('type', type);
  r = sort === 'name' ? r.order('title') : r.order('id', { ascending: false }); return r.range((page - 1) * limit, page * limit - 1);
};
async function home(v) {
  const { data, error } = await fetchItems({ limit: 12 }); if (error) throw error;
  const seen = store('seen', []), prog = store('prog', {}), last = seen.find((id) => prog[id]);
  v.innerHTML = `<h1>${t('hi')}</h1><form class="search-panel home-search" id="hs" role="search"><div class="searchbox"><span class="search-icon" aria-hidden="true">⌕</span><input type="search" name="q" placeholder="${t('q')}" maxlength="80" aria-label="${t('q')}"><button class="btn search-submit" type="submit">${t('search')}</button></div></form><div class="chips" style="display:flex;gap:8px;flex-wrap:wrap">${cat.s.map((s) => `<a class="chip" href="#/explore?subject=${s.id}">${esc(s.name)}</a>`).join('')}</div>${last ? `<h2>${t('cont')}</h2><a class="btn" href="#/read/${esc(last)}">${t('cont')} (${t('pg')} ${prog[last]})</a>` : ''}<h2>${t('latest')}</h2>${data.length ? `<div class="shelf">${data.map(card).join('')}</div>` : `<div class="state">${t('empty')}</div>`}`;
  setupPreviews(v);
  $('#hs').onsubmit = (e) => { e.preventDefault(); location.hash = `#/explore?q=${encodeURIComponent(new FormData(e.target).get('q'))}`; };
}
async function explore(v) {
  const { q } = hash(); let view = localStorage.getItem('lib-view') || 'grid'; const page = Math.max(1, +q.page || 1);
  const opts = (a, cur, l) => `<option value="">${l}: ${t('all')}</option>${a.map((x) => `<option value="${esc(x.id ?? x)}" ${String(cur) === String(x.id ?? x) ? 'selected' : ''}>${esc(x.name ?? x)}</option>`).join('')}`;
  v.innerHTML = `<h1>${t('explore')}</h1><form class="search-panel" id="ef" role="search"><div class="searchbox"><span class="search-icon" aria-hidden="true">⌕</span><input type="search" name="q" value="${esc(q.q)}" placeholder="${t('q')}" maxlength="80" aria-label="${t('q')}"><button class="btn search-submit" type="submit">${t('search')}</button></div><div class="filter-row"><label><span>${t('subj')}</span><select name="subject">${opts(cat.s, q.subject, t('subj'))}</select></label><label><span>${t('grade')}</span><select name="grade">${opts(cat.g, q.grade, t('grade'))}</select></label><label><span>${t('type')}</span><select name="type">${opts(cat.types, q.type, t('type'))}</select></label><label><span>${t('sort')}</span><select name="sort"><option value="new">${t('sort')}</option><option value="name" ${q.sort === 'name' ? 'selected' : ''}>${t('name')}</option></select></label><button class="btn g view-toggle" type="button" id="vw" aria-label="grid/list">${view === 'grid' ? '☰' : '▦'}</button></div></form><div id="r">${spin}</div><div class="pg" id="pg"></div>`;
  const sync = (pg = 1) => { const f = new FormData($('#ef')), p = new URLSearchParams(); for (const [k, x] of f) if (x) p.set(k, x); if (pg > 1) p.set('page', pg); location.hash = `#/explore${p.size ? '?' + p : ''}`; };
  $('#ef').onchange = () => sync(); $('#ef').onsubmit = (e) => { e.preventDefault(); sync(); };
  $('#vw').onclick = () => { view = view === 'grid' ? 'list' : 'grid'; localStorage.setItem('lib-view', view); boot(); };
  const { data, count, error } = await fetchItems({ ...q, page }); if (error) throw error; const pages = Math.max(1, Math.ceil((count || 0) / PER));
  $('#r').innerHTML = data.length ? `<div class="shelf ${view === 'list' ? 'list' : ''}">${data.map(card).join('')}</div>` : `<div class="state">${count === 0 && !q.q && !q.subject && !q.grade && !q.type ? t('empty') : t('none')}</div>`;
  setupPreviews($('#r'));
  $('#pg').innerHTML = pages > 1 ? `<button class="btn g s" ${page < 2 ? 'disabled' : ''} data-p="${page - 1}">${t('prev')}</button><span>${t('pg')} ${page} ${t('of')} ${pages}</span><button class="btn g s" ${page >= pages ? 'disabled' : ''} data-p="${page + 1}">${t('next')}</button>` : '';
  $('#pg').onclick = (e) => { const b = e.target.closest('[data-p]'); if (b && !b.disabled) sync(+b.dataset.p); };
}
const signedUrl = async (id) => { const { data: path, error } = await sb.rpc('get_library_file', { p_item_id: id }); if (error) throw error; if (/^https:\/\//.test(path)) return path; const r = await sb.storage.from('library').createSignedUrl(path, 600); if (r.error) throw r.error; return r.data.signedUrl; };
async function item(v, id) {
  if (!/^[\w-]{1,64}$/.test(id)) throw new Error('bad id'); const { data: r, error } = await sb.from('library_items').select(COLS).eq('id', id).maybeSingle(); if (error) throw error;
  if (!r) { v.innerHTML = `<div class="state">${t('none')}<br><a class="btn" href="#/explore">${t('back')}</a></div>`; return; }
  const seen = [r.id, ...store('seen', []).filter((x) => x !== r.id)].slice(0, 30); put('seen', seen); const bm = store('bm', []), isBm = bm.includes(r.id), lists = store('lists', {});
  const pdf = /pdf/i.test(r.type || '');
  v.innerHTML = `<a class="btn g s item-back" href="#/explore">← ${t('back')}</a><section class="item-detail"><div class="item-preview" id="item-preview" aria-label="${esc(r.title)}"><div class="item-preview-fallback"><span>${esc(r.type || 'FILE')}</span></div></div><div class="item-info"><p class="item-kicker">${esc(r.subject?.name || r.type || '')}</p><h1>${esc(r.title)}</h1><p class="item-meta">${[r.subject?.name, r.grade?.name, r.unit, r.academic_year].filter(Boolean).map(esc).join(' · ')}</p><div class="item-badges"><span class="badge ${r.is_free ? '' : 'gold'}">${t(r.is_free ? 'free' : 'paid')}</span><span class="badge">${esc(r.type || '')}</span></div><div class="item-actions"><button class="btn" id="op">${t('open')}</button><button class="btn g" id="sv">${isBm ? '★ ' + t('saved') : '☆ ' + t('save')}</button><button class="btn g" id="sh">${t('share')}</button>${Object.keys(lists).length ? `<select id="al" aria-label="${t('lists')}"><option value="">＋ ${t('lists')}</option>${Object.keys(lists).map((n) => `<option>${esc(n)}</option>`).join('')}</select>` : ''}</div><div id="mm"></div></div></section>`;
  if (pdf) {
    let preview = previewCache.get(r.id);
    if (!preview) { preview = renderPreview(r.id); previewCache.set(r.id, preview); }
    preview.then((src) => { const panel = $('#item-preview'); if (panel) panel.innerHTML = `<img src="${src}" alt="${esc(r.title)}">`; }).catch((error) => console.warn(`Could not create PDF preview for ${r.id}`, error));
  }
  $('#op').onclick = async (e) => { e.target.disabled = true; try { if (pdf) { location.hash = `#/read/${r.id}`; return; } const u = await signedUrl(r.id); open(u, '_blank', 'noopener'); } catch (x) { $('#mm').innerHTML = `<p class="err" role="alert">${/subscription/i.test(x.message) ? t('sub') : t('err')}</p>`; } e.target.disabled = false; };
  $('#sv').onclick = () => { const b = store('bm', []); put('bm', b.includes(r.id) ? b.filter((x) => x !== r.id) : [...b, r.id]); item(v, id); };
  $('#sh').onclick = async () => { const u = location.href; try { if (navigator.share) await navigator.share({ title: r.title, url: u }); else { await navigator.clipboard.writeText(u); $('#mm').innerHTML = `<p>${t('copied')}</p>`; } } catch { /* cancelled */ } };
  $('#al')?.addEventListener('change', (e) => { const l = store('lists', {}); if (e.target.value && l[e.target.value] && !l[e.target.value].includes(r.id)) { l[e.target.value].push(r.id); put('lists', l); $('#mm').innerHTML = `<p>${t('added')}</p>`; } });
}
let pdfjs = null;
const loadPdfjs = async () => { if (pdfjs) return pdfjs; const B = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/'; await new Promise((ok, no) => { const s = document.createElement('script'); s.src = B + 'pdf.min.js'; s.onload = ok; s.onerror = no; document.head.append(s); }); const w = await (await fetch(B + 'pdf.worker.min.js')).text(); pdfjs = window.pdfjsLib; pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([w], { type: 'text/javascript' })); return pdfjs; };
async function reader(v, id) {
  if (!/^[\w-]{1,64}$/.test(id)) throw new Error('bad id'); const [lib, url] = await Promise.all([loadPdfjs(), signedUrl(id).catch((x) => { throw x; })]);
  const doc = await lib.getDocument({ url, rangeChunkSize: 262144, disableAutoFetch: true, isEvalSupported: false }).promise, prog = store('prog', {}); let page = Math.min(Math.max(1, +prog[id] || 1), doc.numPages), z = 1, fitWidth = true, busy = false, again = false;
  v.innerHTML = `<section class="rd"><div class="reader-toolbar"><a class="btn g s reader-back" href="#/item/${esc(id)}">← ${t('back')}</a><div class="reader-controls"><div class="page-controls"><button class="btn g s" id="pv" aria-label="${t('prev')}">‹</button><input id="gp" inputmode="numeric" aria-label="${t('pg')}"><span class="page-total">/ ${doc.numPages}</span><button class="btn g s" id="nx" aria-label="${t('next')}">›</button></div><div class="zoom-controls"><button class="btn g s" id="zo" aria-label="${t('zoomOut')}">−</button><button class="btn g s fit-button" id="fit">${t('fit')}</button><button class="btn g s" id="zi" aria-label="${t('zoomIn')}">+</button></div><button class="btn g s fullscreen-button" id="fs">${t('fs')}</button></div></div><div class="reader-stage"><canvas id="cv"></canvas></div></section>`;
  const draw = async () => { if (busy) { again = true; return; } busy = true; do { again = false; const pg = await doc.getPage(page), base = pg.getViewport({ scale: 1 }), dpr = Math.min(2, devicePixelRatio || 1), scale = fitWidth ? Math.min(1.5, Math.max(.25, ($('.reader-stage').clientWidth - 32) / base.width)) : z, vp = pg.getViewport({ scale: scale * dpr }), c = $('#cv'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height); c.style.width = `${Math.ceil(vp.width / dpr)}px`; c.style.height = `${Math.ceil(vp.height / dpr)}px`; await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise; } while (again); busy = false; if (document.activeElement !== $('#gp')) $('#gp').value = page; const p = store('prog', {}); p[id] = page; put('prog', p); };
  const go = (n) => { page = Math.min(doc.numPages, Math.max(1, n | 0)); $('#gp').value = page; draw(); };
  $('#pv').onclick = () => go(page - 1); $('#nx').onclick = () => go(page + 1); $('#zi').onclick = () => { fitWidth = false; z = Math.min(3, z + .25); draw(); }; $('#zo').onclick = () => { fitWidth = false; z = Math.max(.5, z - .25); draw(); }; $('#fit').onclick = () => { fitWidth = true; draw(); };
  $('#gp').onkeydown = (e) => { if (e.key === 'Enter') { go(+e.target.value || page); e.target.blur(); } }; $('#fs').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : $('.rd').requestFullscreen?.());
  let resizeTimer; const onResize = () => { if (!$('#cv')) { removeEventListener('resize', onResize); return; } if (fitWidth) { clearTimeout(resizeTimer); resizeTimer = setTimeout(draw, 120); } }; addEventListener('resize', onResize);
  addEventListener('keydown', function k(e) { if (!$('#cv')) return removeEventListener('keydown', k); if (e.target.tagName === 'INPUT') return; if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') go(page + ((e.key === 'ArrowRight') === (lang === 'en') ? 1 : -1)); }); draw();
}
async function my(v) {
  const bm = store('bm', []), seen = store('seen', []), prog = store('prog', {}), lists = store('lists', {}), ids = [...new Set([...bm, ...seen, ...Object.values(lists).flat()])].slice(0, 100);
  const { data = [], error } = ids.length ? await sb.from('library_items').select(COLS).in('id', ids) : { data: [] }; if (error) throw error; const by = Object.fromEntries(data.map((r) => [r.id, r])), sec = (h, a) => (a.length ? `<h2>${h}</h2><div class="shelf">${a.map((i) => by[i] && card(by[i])).join('')}</div>` : '');
  v.innerHTML = `<h1>${t('my')}</h1>${sec(t('cont'), seen.filter((i) => prog[i] && by[i]))}${sec(t('savedH'), bm.filter((i) => by[i]))}<h2>${t('lists')}</h2><form class="bar" id="nl"><input name="n" maxlength="40" placeholder="${t('newList')}" aria-label="${t('newList')}"><button class="btn s">＋</button></form>${Object.entries(lists).map(([n, a]) => sec(esc(n), a.filter((i) => by[i]))).join('')}${sec(t('hist'), seen.filter((i) => by[i]))}${!ids.length ? `<div class="state">${t('empty')}</div>` : ''}`;
  setupPreviews(v);
  $('#nl').onsubmit = (e) => { e.preventDefault(); const n = String(new FormData(e.target).get('n')).trim().slice(0, 40), l = store('lists', {}); if (n && !(n in l) && n !== '__proto__') { l[n] = []; put('lists', l); my(v); } };
}
const upload = async (v) => { v.innerHTML = `<h1>${t('up')}</h1><div class="card"><p>${t('upT')}</p><a class="btn" href="${MAIN}/admin.html" rel="noopener">${t('go')}</a></div>`; };
sb.auth.onAuthStateChange(() => setTimeout(boot, 0));
addEventListener('hashchange', boot); boot();
