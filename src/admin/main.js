// Admin dashboard — a separate entry (admin/index.html) so students never download this code.
// Access is decided by the SERVER: whoami() calls the is_admin() RPC and every action below is re-checked by RLS / RPC.
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import '@fontsource/noto-naskh-arabic/700.css';
import '../styles/main.css';
import * as api from '../lib/api.js';
import { auth, whoami, meta } from '../lib/api.js';
import { applyLang, getLang, setLang, t, fmtNum, fmtDate, fmtSize, catName, timeAgo } from '../lib/i18n.js';
import { html, raw, mount, $, $$, toast, modal, confirmBox, emptyState, errorState, friendlyError, statusBadge, safeHttps, skeletonGrid } from '../lib/ui.js';
import { icon, TYPE_ICON } from '../lib/icons.js';
import { createRouter } from '../lib/router.js';
import { renderAuth } from '../pages/auth.js';
import { state } from '../lib/state.js';

applyLang();
const app = $('#app');
let me = null, router = null, cleanupAuth = null, counts = { pending: 0, reports: 0 };
const LIB = '/';

const routes = [
  { re: /^\/?$/, nav: 'overview', load: async () => ({ default: overview }) },
  { re: /^\/queue$/, nav: 'queue', load: async () => ({ default: queue }) },
  { re: /^\/resources$/, nav: 'resources', load: async () => ({ default: resources }) },
  { re: /^\/categories$/, nav: 'categories', load: async () => ({ default: categories }) },
  { re: /^\/reports$/, nav: 'reports', load: async () => ({ default: reports }) },
];

const navItem = (k, ic, label, badge) => html`<a class="nav-item" href="#/${k === 'overview' ? '' : k}" data-nav="${k}">${raw(icon(ic, 19))}<span>${label}</span>${badge ? html`<b class="count" data-count="${k}">${fmtNum(badge)}</b>` : html`<b class="count" data-count="${k}" hidden></b>`}</a>`;
function shell() {
  mount(app, html`<div class="app app--admin"><aside class="side" id="side">
      <a class="brand" href="#/"><img src="/favicon.svg" alt="" width="36" height="36"><span>iLogia <b>${t('adm.brand')}</b></span></a>
      <nav>${navItem('overview', 'gauge', t('adm.overview'))}${navItem('queue', 'inbox', t('adm.queue'), counts.pending)}${navItem('resources', 'library', t('adm.resources'))}${navItem('categories', 'layers', t('adm.categories'))}${navItem('reports', 'flag', t('adm.reports'), counts.reports)}</nav>
      <div class="side-foot"><a class="side-link" href="${LIB}">${raw(icon('arrow-up-right', 16))}${t('adm.toLibrary')}</a>
        <div class="who"><span class="avatar" aria-hidden="true">${(me.name || '?').charAt(0).toUpperCase()}</span><span class="who-t"><b>${me.name}</b><small dir="ltr">${me.email}</small></span>
          <button class="icon-btn light" data-logout aria-label="${t('nav.logout')}">${raw(icon('logout', 18))}</button></div></div></aside>
    <div class="main-col"><header class="top"><button class="icon-btn only-mobile" data-menu aria-label="${t('nav.menu')}">${raw(icon('menu', 22))}</button><div class="grow"></div>
      <button class="btn ghost sm" data-lang>${raw(icon('languages', 16))}<span class="hide-sm">${getLang() === 'ar' ? 'English' : 'العربية'}</span></button></header>
      <main id="view" tabindex="-1"></main></div><div class="scrim" data-scrim></div></div>`);
}
async function refreshCounts() {
  try {
    const [p, r] = await Promise.all([api.admin.list({ status: 'pending', size: 1 }), api.admin.reports('open')]);
    counts = { pending: p.count, reports: r.length };
    for (const k of ['queue', 'reports']) { const b = $(`[data-count="${k === 'queue' ? 'queue' : 'reports'}"]`); const n = k === 'queue' ? counts.pending : counts.reports; if (b) { b.hidden = !n; b.textContent = fmtNum(n); } }
  } catch { /* badges are cosmetic */ }
}
app.addEventListener('click', async (e) => {
  if (e.target.closest('[data-menu]')) $('.app')?.classList.toggle('menu-open');
  if (e.target.closest('[data-scrim]') || e.target.closest('.nav-item')) $('.app')?.classList.remove('menu-open');
  if (e.target.closest('[data-lang]') && me) { setLang(getLang() === 'ar' ? 'en' : 'ar'); shell(); router.run(); refreshCounts(); }
  if (e.target.closest('[data-logout]')) await auth.signOut();
});

// ───────── pages ─────────
const tile = (ic, label, value, tone = '') => html`<div class="tile ${tone}">${raw(icon(ic, 20))}<b>${fmtNum(value)}</b><span>${label}</span></div>`;

async function overview({ el, alive }) {
  mount(el, html`<div class="page"><header class="page-head"><h1>${t('adm.overview')}</h1><p>${t('adm.overviewLead')}</p></header><div class="loading"><span class="spinner"></span></div></div>`);
  let s; try { s = await api.admin.stats(); } catch (e) { return ctxError(el, e, () => overview(arguments[0])); }
  if (!alive()) return;
  const st = s.by_status || {};
  const days = s.daily || []; const max = Math.max(1, ...days.map((d) => d.view + d.read + d.download));
  const W = 720, H = 190, pad = 8, bw = (W - pad * 2) / Math.max(1, days.length);
  const bars = days.map((d, i) => { const x = pad + i * bw + 2; let y = H - 24; const seg = (n, cls) => { const h = (n / max) * (H - 44); y -= h; return h > 0 ? `<rect class="${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${h.toFixed(1)}" rx="2"/>` : ''; };
    return `<g><title>${new Date(d.day).toLocaleDateString(getLang() === 'ar' ? 'ar-EG' : 'en-GB')}: ${d.view} / ${d.read} / ${d.download}</title>${seg(d.view, 'c-view')}${seg(d.read, 'c-read')}${seg(d.download, 'c-dl')}</g>`; }).join('');
  const any = days.some((d) => d.view + d.read + d.download > 0);
  mount(el, html`<div class="page"><header class="page-head"><h1>${t('adm.overview')}</h1><p>${t('adm.overviewLead')}</p></header>
    <div class="tiles">${tile('book-open', t('status.published'), st.published || 0)}${tile('inbox', t('status.pending'), st.pending || 0, (st.pending || 0) ? 'tone-gold' : '')}${tile('flag', t('adm.openReports'), s.open_reports, s.open_reports ? 'tone-red' : '')}
      ${tile('eye', t('adm.totalViews'), s.total_views)}${tile('download', t('adm.totalDownloads'), s.total_downloads)}${tile('users', t('adm.activeUsers'), s.active_users_30d)}${tile('bookmark', t('adm.bookmarks'), s.bookmarks)}${tile('ban', t('adm.hidden'), (st.rejected || 0) + (st.unavailable || 0))}</div>
    <section class="panel"><div class="block-head"><h2>${t('adm.activity30')}</h2><div class="legend"><span><i class="c-view"></i>${t('hist.view')}</span><span><i class="c-read"></i>${t('hist.read')}</span><span><i class="c-dl"></i>${t('hist.download')}</span></div></div>
      ${any ? html`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${t('adm.activity30')}"><line x1="0" x2="${W}" y1="${H - 24}" y2="${H - 24}" class="axis"/>${raw(bars)}<text x="${pad}" y="${H - 6}" class="tick">${fmtDate(days[0].day, { day: 'numeric', month: 'short' })}</text><text x="${W - pad}" y="${H - 6}" class="tick" text-anchor="end">${fmtDate(days.at(-1).day, { day: 'numeric', month: 'short' })}</text></svg>` : emptyState({ icon: 'chart', title: t('adm.noActivity'), text: t('adm.noActivityText') })}</section>
    <section class="panel"><div class="block-head"><h2>${t('adm.topViewed')}</h2></div>${(s.top_viewed || []).length ? html`<ol class="top-list">${s.top_viewed.map((r) => html`<li><a href="${LIB}#/resource/${r.id}">${r.title}</a><span>${raw(icon('eye', 14))}${fmtNum(r.views_count)}</span><span>${raw(icon('download', 14))}${fmtNum(r.downloads_count)}</span></li>`)}</ol>` : html`<p class="meta">${t('adm.noViews')}</p>`}</section></div>`);
}
const ctxError = (el, e, retry) => { mount(el, html`<div class="page">${errorState(e)}</div>`); $('[data-retry]', el)?.addEventListener('click', retry); };

async function queue({ el, alive }) {
  const run = async () => {
    mount(el, html`<div class="page"><header class="page-head"><h1>${t('adm.queue')}</h1><p>${t('adm.queueLead')}</p></header><div data-list>${skeletonGrid(3)}</div></div>`);
    let res; try { res = await api.admin.list({ status: 'pending', size: 50 }); } catch (e) { return ctxError(el, e, run); }
    if (!alive()) return; const covers = await api.coverUrls(res.rows);
    const box = $('[data-list]', el);
    mount(box, res.rows.length ? html`<ul class="queue">${res.rows.map((r) => html`<li class="q-item" data-id="${r.id}"><div class="q-cover">${rawCover(r, covers)}</div>
      <div class="q-main"><h3>${r.title}</h3><p class="meta">${[t('type.' + r.file_type), r.file_size ? fmtSize(r.file_size) : '', r.page_count ? t('res.pagesN', { n: fmtNum(r.page_count) }) : '', catName(r.category), r.subject?.name, r.grade?.name].filter(Boolean).join(' · ')}</p>
        ${r.description ? html`<p class="q-desc">${r.description}</p>` : ''}<p class="meta">${t('adm.submitted')} ${timeAgo(r.created_at)} · ${r.allow_download ? t('adm.dlOn') : t('adm.dlOff')}</p></div>
      <div class="q-actions"><button class="btn sm" data-preview="${r.id}">${raw(icon('eye', 16))}${t('adm.previewFile')}</button><button class="btn sm primary" data-approve="${r.id}">${raw(icon('check', 16))}${t('adm.approve')}</button><button class="btn sm danger" data-reject="${r.id}">${raw(icon('x', 16))}${t('adm.reject')}</button></div></li>`)}</ul>`
      : emptyState({ icon: 'ok', title: t('adm.queueEmpty'), text: t('adm.queueEmptyText') }));
    el.onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return; const id = b.dataset.preview || b.dataset.approve || b.dataset.reject; const r = res.rows.find((x) => x.id === id); if (!r) return;
      try {
        if (b.dataset.preview) { const u = await api.fileUrl(r); const ok = safeHttps(u); if (ok) window.open(ok, '_blank', 'noopener,noreferrer'); }
        else if (b.dataset.approve) { b.disabled = true; await api.admin.review(id, 'approve'); toast(t('adm.approved'), 'ok'); await run(); refreshCounts(); }
        else if (b.dataset.reject) {
          const reason = await modal({ title: t('adm.rejectTitle'), body: html`<p class="meta">${r.title}</p><label class="field"><span>${t('adm.rejectReason')}</span><textarea name="why" rows="3" maxlength="500" autofocus></textarea></label>`,
            actions: [{ label: t('common.cancel'), kind: 'ghost', value: null }, { label: t('adm.reject'), kind: 'danger', validate: (w) => !!w.querySelector('[name=why]').value.trim(), collect: (w) => w.querySelector('[name=why]').value.trim() }] });
          if (reason) { await api.admin.review(id, 'reject', reason); toast(t('adm.rejected'), 'ok'); await run(); refreshCounts(); }
        }
      } catch (err) { b.disabled = false; toast(friendlyError(err), 'error'); }
    };
  };
  await run();
}
import { cover as coverFn } from '../lib/ui.js';
const rawCover = (r, covers) => coverFn(r, covers[r.cover_path]);

async function resources({ el, alive }) {
  const f = { status: '', q: '', page: 1 }; const SIZE = 20;
  mount(el, html`<div class="page"><header class="page-head"><h1>${t('adm.resources')}</h1></header>
    <form class="filters" data-f><label class="field grow"><span class="sr">${t('search.go')}</span><div class="input-ic">${raw(icon('search', 18))}<input type="search" name="q" placeholder="${t('adm.searchPh')}" maxlength="80"></div></label>
      <label class="field"><span>${t('adm.status')}</span><select name="status"><option value="">${t('f.all')}</option>${['published', 'pending', 'rejected', 'unavailable', 'draft'].map((s) => html`<option value="${s}">${t('status.' + s)}</option>`)}</select></label></form>
    <div data-table></div><nav class="pager" data-pager></nav></div>`);
  let rows = [];
  const load = async () => {
    const box = $('[data-table]', el); mount(box, html`<div class="loading"><span class="spinner"></span></div>`);
    try {
      const res = await api.admin.list({ ...f, size: SIZE }); if (!alive()) return; rows = res.rows;
      mount(box, rows.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>${t('up.title')}</th><th>${t('adm.status')}</th><th>${t('f.type')}</th><th>${t('res.views')}</th><th>${t('res.added')}</th><th><span class="sr">${t('adm.actions')}</span></th></tr></thead><tbody>
        ${rows.map((r) => html`<tr><td><a href="${LIB}#/resource/${r.id}"><b>${r.title}</b></a><small>${[catName(r.category), r.subject?.name].filter(Boolean).join(' · ')}</small>${r.reject_reason ? html`<small class="err">${r.reject_reason}</small>` : ''}</td><td>${statusBadge(r.status)}</td><td>${t('type.' + r.file_type)}</td><td>${fmtNum(r.views_count)}</td><td>${fmtDate(r.created_at)}</td>
          <td class="acts"><button class="icon-btn" data-edit="${r.id}" title="${t('common.edit')}" aria-label="${t('common.edit')}">${raw(icon('edit', 17))}</button>
            ${r.status === 'published' ? html`<button class="icon-btn" data-unpub="${r.id}" title="${t('adm.unpublish')}" aria-label="${t('adm.unpublish')}">${raw(icon('ban', 17))}</button>` : r.status === 'unavailable' || r.status === 'rejected' ? html`<button class="icon-btn" data-restore="${r.id}" title="${t('adm.restore')}" aria-label="${t('adm.restore')}">${raw(icon('undo', 17))}</button>` : html`<button class="icon-btn" data-approve="${r.id}" title="${t('adm.approve')}" aria-label="${t('adm.approve')}">${raw(icon('check', 17))}</button>`}
            <button class="icon-btn danger" data-del="${r.id}" title="${t('common.delete')}" aria-label="${t('common.delete')}">${raw(icon('trash', 17))}</button></td></tr>`)}</tbody></table></div>` : emptyState({ icon: 'search', title: t('adm.noResources') }));
      const pages = Math.max(1, Math.ceil(res.count / SIZE));
      mount($('[data-pager]', el), pages > 1 ? html`<button class="btn sm" data-page="${f.page - 1}" ${f.page <= 1 ? raw('disabled') : ''}>${t('pager.prev')}</button><span>${t('pager.of', { n: fmtNum(f.page), total: fmtNum(pages) })}</span><button class="btn sm" data-page="${f.page + 1}" ${f.page >= pages ? raw('disabled') : ''}>${t('pager.next')}</button>` : '');
    } catch (e) { ctxError(box, e, load); }
  };
  const form = $('[data-f]', el); form.addEventListener('submit', (e) => e.preventDefault());
  let h; form.addEventListener('input', (e) => { if (e.target.name === 'q') { clearTimeout(h); h = setTimeout(() => { f.q = e.target.value.trim(); f.page = 1; load(); }, 350); } });
  form.addEventListener('change', (e) => { if (e.target.name === 'status') { f.status = e.target.value; f.page = 1; load(); } });
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.page) { f.page = +b.dataset.page; return load(); }
    const id = b.dataset.edit || b.dataset.unpub || b.dataset.restore || b.dataset.approve || b.dataset.del; const r = rows.find((x) => x.id === id); if (!r) return;
    try {
      if (b.dataset.edit) { if (await editModal(r)) { toast(t('common.saved'), 'ok'); load(); } }
      else if (b.dataset.unpub) { await api.admin.review(id, 'unpublish'); toast(t('adm.unpublished'), 'ok'); load(); }
      else if (b.dataset.restore || b.dataset.approve) { await api.admin.review(id, b.dataset.restore ? 'restore' : 'approve'); toast(t('adm.approved'), 'ok'); load(); refreshCounts(); }
      else if (b.dataset.del && await confirmBox(t('adm.delTitle'), t('adm.delText', { title: r.title }), t('common.delete'), true)) { await api.admin.remove(r); toast(t('up.deleted'), 'ok'); load(); }
    } catch (err) { toast(friendlyError(err), 'error'); }
  });
  load();
}
async function editModal(r) {
  const opts = (items, cur, label) => items.map((i) => html`<option value="${i.id}" ${String(cur) === String(i.id) ? raw('selected') : ''}>${label(i)}</option>`);
  const [cats, subs, grades] = await Promise.all([api.admin.allCategories(), meta.subjects(), meta.grades()]);
  const v = await modal({ title: t('common.edit'), wide: true, body: html`<div class="form">
    <label class="field"><span>${t('up.title')}</span><input name="title" value="${r.title}" maxlength="200"></label>
    <label class="field"><span>${t('up.author')}</span><input name="author" value="${r.author || ''}" maxlength="200"></label>
    <label class="field"><span>${t('up.desc')}</span><textarea name="description" rows="4" maxlength="4000">${r.description || ''}</textarea></label>
    <div class="three"><label class="field"><span>${t('f.category')}</span><select name="category_id">${opts(cats, r.category_id, catName)}</select></label>
      <label class="field"><span>${t('f.subject')}</span><select name="subject_id"><option value="">${t('up.none')}</option>${opts(subs, r.subject_id, (s) => s.name)}</select></label>
      <label class="field"><span>${t('f.grade')}</span><select name="grade_id"><option value="">${t('up.none')}</option>${opts(grades, r.grade_id, (g) => g.name)}</select></label></div>
    <label class="check"><input type="checkbox" name="allow_download" ${r.allow_download ? raw('checked') : ''}><span><b>${t('up.allowDl')}</b></span></label></div>`,
    actions: [{ label: t('common.cancel'), kind: 'ghost', value: null }, { label: t('common.save'), kind: 'primary', validate: (w) => w.querySelector('[name=title]').value.trim().length >= 3,
      collect: (w) => { const g = (n) => w.querySelector(`[name=${n}]`); return { title: g('title').value.trim(), author: g('author').value.trim() || null, description: g('description').value.trim() || null, category_id: +g('category_id').value, subject_id: g('subject_id').value ? +g('subject_id').value : null, grade_id: g('grade_id').value ? +g('grade_id').value : null, allow_download: g('allow_download').checked }; } }] });
  if (!v) return false; await api.admin.update(r.id, v); return true;
}

async function categories({ el, alive }) {
  const run = async () => {
    let rows; try { rows = await api.admin.allCategories(); } catch (e) { return ctxError(el, e, run); }
    if (!alive()) return;
    mount(el, html`<div class="page"><header class="page-head"><h1>${t('adm.categories')}</h1><p>${t('adm.catLead')}</p></header><div class="list-head"><span></span><button class="btn primary" data-new>${raw(icon('plus', 18))}${t('adm.catNew')}</button></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>${t('adm.catName')}</th><th>slug</th><th>${t('adm.catOrder')}</th><th>${t('adm.status')}</th><th></th></tr></thead><tbody>${rows.map((c) => html`<tr><td><b>${c.name_ar}</b><small>${c.name_en}</small></td><td dir="ltr"><code>${c.slug}</code></td><td>${fmtNum(c.sort_order)}</td><td>${c.is_active ? html`<span class="badge badge--published">${t('adm.active')}</span>` : html`<span class="badge">${t('adm.inactive')}</span>`}</td><td class="acts"><button class="icon-btn" data-edit="${c.id}" aria-label="${t('common.edit')}">${raw(icon('edit', 17))}</button></td></tr>`)}</tbody></table></div></div>`);
    el.onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return; const c = b.dataset.edit ? rows.find((x) => String(x.id) === b.dataset.edit) : { is_active: true, sort_order: (rows.at(-1)?.sort_order || 0) + 10, slug: '', name_ar: '', name_en: '', icon: 'folder' };
      if (!c) return;
      const ICONS = ['book-open', 'notebook', 'layers', 'clipboard', 'library', 'sparkles', 'folder', 'file-text', 'video', 'tag'];
      const v = await modal({ title: b.dataset.edit ? t('common.edit') : t('adm.catNew'), body: html`<div class="form"><label class="field"><span>${t('adm.catNameAr')}</span><input name="name_ar" value="${c.name_ar}" maxlength="80"></label><label class="field"><span>${t('adm.catNameEn')}</span><input name="name_en" value="${c.name_en}" maxlength="80" dir="ltr"></label>
        <label class="field"><span>slug</span><input name="slug" value="${c.slug}" maxlength="40" dir="ltr" pattern="[a-z0-9-]+" ${c.id ? raw('readonly') : ''}></label>
        <div class="two"><label class="field"><span>${t('adm.catIcon')}</span><select name="icon">${ICONS.map((i) => html`<option ${c.icon === i ? raw('selected') : ''}>${i}</option>`)}</select></label><label class="field"><span>${t('adm.catOrder')}</span><input name="sort_order" type="number" value="${c.sort_order}"></label></div>
        <label class="check"><input type="checkbox" name="is_active" ${c.is_active ? raw('checked') : ''}><span><b>${t('adm.active')}</b></span></label></div>`,
        actions: [{ label: t('common.cancel'), kind: 'ghost', value: null }, { label: t('common.save'), kind: 'primary', validate: (w) => /^[a-z0-9-]{2,40}$/.test(w.querySelector('[name=slug]').value) && w.querySelector('[name=name_ar]').value.trim() && w.querySelector('[name=name_en]').value.trim(),
          collect: (w) => { const g = (n) => w.querySelector(`[name=${n}]`); return { id: c.id, slug: g('slug').value, name_ar: g('name_ar').value.trim(), name_en: g('name_en').value.trim(), icon: g('icon').value, sort_order: +g('sort_order').value || 0, is_active: g('is_active').checked }; } }] });
      if (!v) return; try { await api.admin.saveCategory(v); meta.reset(); toast(t('common.saved'), 'ok'); run(); } catch (err) { toast(friendlyError(err), 'error'); }
    };
  };
  await run();
}

async function reports({ el, alive }) {
  let status = 'open';
  const run = async () => {
    mount(el, html`<div class="page"><header class="page-head"><h1>${t('adm.reports')}</h1></header><div class="tabs">${['open', 'resolved', 'dismissed'].map((s) => html`<button class="tab ${status === s ? 'on' : ''}" data-st="${s}">${t('adm.rep.' + s)}</button>`)}</div><div data-list class="loading"><span class="spinner"></span></div></div>`);
    let rows; try { rows = await api.admin.reports(status); } catch (e) { return ctxError($('[data-list]', el), e, run); }
    if (!alive()) return;
    mount($('[data-list]', el), rows.length ? html`<ul class="queue">${rows.map((x) => html`<li class="q-item"><div class="q-main"><h3>${x.resource ? x.resource.title : '—'} ${x.resource ? statusBadge(x.resource.status) : ''}</h3>
      <p><span class="badge badge--warn">${t('report.r.' + x.reason)}</span> <small>${timeAgo(x.created_at)}</small></p>${x.details ? html`<p class="q-desc">${x.details}</p>` : ''}${x.resolution_note ? html`<p class="meta">${t('adm.note')}: ${x.resolution_note}</p>` : ''}</div>
      <div class="q-actions">${x.resource ? html`<a class="btn sm" href="${LIB}#/resource/${x.resource.id}" target="_blank" rel="noopener">${raw(icon('external', 16))}${t('res.open')}</a>` : ''}
        ${status === 'open' ? html`<button class="btn sm primary" data-res="${x.id}">${raw(icon('check', 16))}${t('adm.resolve')}</button>${x.resource?.status === 'published' ? html`<button class="btn sm danger" data-takedown="${x.id}">${raw(icon('ban', 16))}${t('adm.takedown')}</button>` : ''}<button class="btn sm ghost" data-dis="${x.id}">${t('adm.dismiss')}</button>` : ''}</div></li>`)}</ul>` : emptyState({ icon: 'ok', title: t('adm.noReports') }));
    el.onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.st) { status = b.dataset.st; return run(); }
      const id = b.dataset.res || b.dataset.takedown || b.dataset.dis; const x = rows.find((r) => r.id === id); if (!x) return;
      try {
        const note = await modal({ title: b.dataset.dis ? t('adm.dismiss') : b.dataset.takedown ? t('adm.takedown') : t('adm.resolve'), body: html`<label class="field"><span>${t('adm.note')}</span><textarea name="n" rows="3" maxlength="500" autofocus></textarea></label>`,
          actions: [{ label: t('common.cancel'), kind: 'ghost', value: null }, { label: t('common.confirm'), kind: 'primary', collect: (w) => w.querySelector('[name=n]').value.trim() }] });
        if (note === null) return;
        if (b.dataset.takedown) await api.admin.review(x.resource.id, 'unpublish');
        await api.admin.resolveReport(id, b.dataset.dis ? 'dismissed' : 'resolved', note, me.id); toast(t('common.saved'), 'ok'); run(); refreshCounts();
      } catch (err) { toast(friendlyError(err), 'error'); }
    };
  };
  await run();
}

// ───────── boot ─────────
async function enter(session) {
  try { me = await whoami(session); } catch (e) { mount(app, html`<div class="boot">${errorState(e)}</div>`); return $('[data-retry]')?.addEventListener('click', () => location.reload()); }
  if (!me.isAdmin) {
    return mount(app, html`<div class="boot"><div class="state">${raw(icon('lock', 36))}<h3>${t('adm.noAccess')}</h3><p>${t('adm.noAccessText')}</p><div class="form-actions center"><a class="btn" href="${LIB}">${t('adm.toLibrary')}</a><button class="btn ghost" data-out>${t('nav.logout')}</button></div></div></div>`), $('[data-out]')?.addEventListener('click', () => auth.signOut());
  }
  try { const [c, s, g] = await Promise.all([meta.categories(), meta.subjects(), meta.grades()]); Object.assign(state, { cats: c, subjects: s, grades: g }); } catch (e) { /* pages handle their own errors */ }
  cleanupAuth?.(); cleanupAuth = null; shell(); refreshCounts();
  router = createRouter(routes, (route, ctx) => {
    const view = $('#view'); const host = document.createElement('div'); host.className = 'route'; view.replaceChildren(host); ctx.el = host;
    $$('.nav-item').forEach((a) => a.classList.toggle('active', a.dataset.nav === route?.nav)); scrollTo(0, 0);
    ctx.error = (e) => ctxError(host, e, () => router.run());
  });
  router.run();
}
async function boot() {
  const session = await auth.session();
  auth.onChange((ev, s) => { if (ev === 'SIGNED_OUT') { me = null; cleanupAuth = renderAuth(app, { admin: true, onLangChange: applyLang }); } else if (ev === 'SIGNED_IN' && s && !me) enter(s); });
  if (session) await enter(session); else cleanupAuth = renderAuth(app, { admin: true, onLangChange: applyLang });
}
boot();
