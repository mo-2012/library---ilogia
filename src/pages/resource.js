import * as api from '../lib/api.js';
import { html, raw, mount, $, toast, modal, errorState, emptyState, friendlyError, cover, statusBadge, safeHttps, esc } from '../lib/ui.js';
import { icon, TYPE_ICON } from '../lib/icons.js';
import { t, catName, fmtDate, fmtSize, fmtNum } from '../lib/i18n.js';
import { resourceCard, resHref } from '../lib/cards.js';
import { state } from '../lib/state.js';

const INLINE = new Set(['video', 'audio', 'image']);

export default async function resourcePage({ el, params, user, alive }) {
  let r;
  try { r = await api.getResource(params.id); } catch (e) { return mount(el, errorState(e)), $('[data-retry]', el)?.addEventListener('click', () => resourcePage(arguments[0])); }
  if (!alive()) return;
  if (!r) return mount(el, html`<div class="page">${emptyState({ icon: 'ban', title: t('res.notFound'), text: t('res.notFoundText'), action: `<a class="btn" href="#/explore">${t('nav.explore')}</a>` })}</div>`);

  const published = r.status === 'published';
  const [rel, prog, covers] = await Promise.all([api.related(r).catch(() => []), r.file_type === 'pdf' ? api.progress.get(r.id).catch(() => null) : null, api.coverUrls([r])]);
  if (!alive()) return;
  const relCovers = await api.coverUrls(rel); if (!alive()) return;
  if (published) api.track(r.id, 'view');

  const canOpen = published && (r.source === 'external' || r.file_type === 'pdf' || INLINE.has(r.file_type) || r.file_type === 'text' || r.allow_download);
  const canDownload = published && r.allow_download && r.source !== 'external';
  const mine = r.uploaded_by === user.id;
  const rows = [
    [t('f.subject'), r.subject?.name], [t('f.grade'), r.grade?.name], [t('f.category'), catName(r.category)], [t('res.author'), r.author],
    [t('f.type'), t('type.' + r.file_type)], [t('res.size'), r.file_size ? fmtSize(r.file_size) : null], [t('res.pages'), r.page_count ? fmtNum(r.page_count) : null],
    [t('res.added'), fmtDate(r.published_at || r.created_at)], [t('res.views'), published ? fmtNum(r.views_count) : null], [t('res.downloads'), published && r.allow_download ? fmtNum(r.downloads_count) : null],
  ].filter(([, v]) => v);

  const render = () => {
    const saved = state.bookmarks.has(r.id);
    const openLabel = r.file_type === 'pdf' ? (prog && prog.last_page > 1 ? t('res.resume', { n: fmtNum(prog.last_page) }) : t('res.read')) : r.source === 'external' ? t('res.visit') : t('res.open');
    mount(el, html`<div class="page"><a class="back" href="#/explore">${raw(icon('arrow-r', 16, 'flip'))}${t('nav.explore')}</a>
      <article class="detail">
        <div class="detail-cover">${cover(r, covers[r.cover_path])}</div>
        <div class="detail-main">
          <div class="badges">${statusBadge(r.status)}<span class="badge badge--type">${raw(icon(TYPE_ICON[r.file_type] || 'file', 14))}${t('type.' + r.file_type)}</span>${r.allow_download ? '' : html`<span class="badge" title="${t('res.noDownloadHint')}">${raw(icon('lock', 13))}${t('res.readOnly')}</span>`}</div>
          <h1>${r.title}</h1>
          ${!published ? html`<div class="notice notice--${r.status === 'rejected' ? 'error' : 'info'}">${raw(icon(r.status === 'rejected' ? 'alert' : 'info', 18))}<span>${t('res.notice.' + r.status)}${r.reject_reason ? html` — ${r.reject_reason}` : ''}</span></div>` : ''}
          <div class="actions">
            ${canOpen ? html`<button class="btn primary lg" data-open>${raw(icon(r.file_type === 'pdf' ? 'book-open' : 'external', 18))}${openLabel}</button>` : html`<button class="btn lg" disabled>${raw(icon('ban', 18))}${published ? t('res.noPreview') : t('res.unavailable')}</button>`}
            ${canDownload ? html`<button class="btn lg" data-download>${raw(icon('download', 18))}${t('res.download')}</button>` : ''}
            ${published ? html`<button class="btn lg ${saved ? 'on' : ''}" data-bm="${r.id}" aria-pressed="${saved}">${raw(icon(saved ? 'bookmark-check' : 'bookmark', 18))}${saved ? t('res.unsave') : t('res.save')}</button>` : ''}
          </div>
          ${published ? html`<div class="actions actions--2"><button class="btn ghost" data-list>${raw(icon('folder-plus', 17))}${t('res.addToList')}</button>
              <button class="btn ghost" data-share>${raw(icon('share', 17))}${t('res.share')}</button>
              ${mine ? '' : html`<button class="btn ghost" data-report>${raw(icon('flag', 17))}${t('res.report')}</button>`}</div>` : ''}
          ${prog && r.file_type === 'pdf' && prog.percent > 0 ? html`<div class="bar" role="progressbar" aria-valuenow="${prog.percent}" aria-valuemin="0" aria-valuemax="100"><i style="inline-size:${prog.percent}%"></i></div><p class="meta">${t('prog.at', { p: fmtNum(prog.last_page), n: fmtNum(prog.page_count || 0) })}</p>` : ''}
          <div data-preview></div>
          ${r.description ? html`<section class="desc"><h2>${t('res.about')}</h2><p>${r.description}</p></section>` : ''}
          <dl class="facts">${rows.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>
        </div></article>
      ${rel.length ? html`<section class="block"><div class="block-head"><h2>${t('res.related')}</h2></div><div class="grid grid--sm">${rel.map((x) => resourceCard(x, relCovers))}</div></section>` : ''}</div>`);
  };
  render();
  const onBm = (ev) => { if (ev.detail.id === r.id) render(); };
  document.addEventListener('bookmarks-changed', onBm);

  const preview = async () => {
    const box = $('[data-preview]', el); mount(box, html`<div class="loading"><span class="spinner"></span></div>`);
    const url = await api.fileUrl(r);
    if (r.file_type === 'video') mount(box, html`<video class="player" controls preload="metadata" playsinline src="${url}"></video>`);
    else if (r.file_type === 'audio') mount(box, html`<audio class="player" controls preload="metadata" src="${url}"></audio>`);
    else mount(box, html`<img class="player" alt="${r.title}" src="${url}">`);
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    try {
      if (b.hasAttribute('data-open')) {
        if (r.file_type === 'pdf') { location.hash = `#/read/${r.id}`; return; }
        if (INLINE.has(r.file_type)) { await preview(); api.track(r.id, 'read'); return; }
        if (r.source === 'external') { const u = safeHttps(r.external_url); if (!u) throw new Error('bad_url'); window.open(u, '_blank', 'noopener,noreferrer'); api.track(r.id, 'read'); return; }
        const url = await api.fileUrl(r, { download: r.file_type !== 'text' }); window.open(url, '_blank', 'noopener,noreferrer'); api.track(r.id, 'read');
      } else if (b.hasAttribute('data-download')) {
        b.disabled = true; const url = await api.fileUrl(r, { download: true });
        const a = document.createElement('a'); a.href = url; a.rel = 'noopener'; a.download = r.original_filename || ''; document.body.append(a); a.click(); a.remove();
        api.track(r.id, 'download'); b.disabled = false;
      } else if (b.hasAttribute('data-share')) {
        const link = `${location.origin}${location.pathname}#/resource/${r.id}`;
        if (navigator.share) { try { await navigator.share({ title: r.title, url: link }); } catch { /* cancelled */ } }
        else { await navigator.clipboard.writeText(link); toast(t('res.copied'), 'ok'); }
      } else if (b.hasAttribute('data-list')) await listModal(r);
      else if (b.hasAttribute('data-report')) await reportModal(r);
    } catch (err) { b.disabled = false; toast(friendlyError(err), 'error'); }
  });
  return () => document.removeEventListener('bookmarks-changed', onBm);
}

async function listModal(r) {
  let cols, have;
  try { [cols, have] = await Promise.all([api.collections.list(), api.collections.containing(r.id)]); } catch (e) { return toast(friendlyError(e), 'error'); }
  const want = new Set(have);
  const body = () => html`<div class="checks" data-checks>${cols.length ? cols.map((c) => html`<label class="check"><input type="checkbox" value="${c.id}" ${want.has(c.id) ? raw('checked') : ''}><span>${c.name}</span></label>`) : html`<p class="meta">${t('list.none')}</p>`}</div>
    <div class="inline-form"><input name="newlist" maxlength="80" placeholder="${t('list.newPh')}" aria-label="${t('list.newPh')}"></div>`;
  const res = await modal({ title: t('res.addToList'), body: body(),
    actions: [{ label: t('common.cancel'), kind: 'ghost', value: null }, { label: t('common.save'), kind: 'primary', collect: (w) => ({ checked: [...w.querySelectorAll('[data-checks] input:checked')].map((i) => i.value), name: w.querySelector('[name=newlist]').value.trim() }) }] });
  if (!res) return;
  try {
    let ids = new Set(res.checked);
    if (res.name) { const c = await api.collections.create(res.name); ids.add(c.id); }
    await Promise.all([...ids].filter((id) => !have.has(id)).map((id) => api.collections.add(id, r.id)).concat([...have].filter((id) => !ids.has(id)).map((id) => api.collections.removeItem(id, r.id))));
    toast(t('list.updated'), 'ok');
  } catch (e) { toast(friendlyError(e), 'error'); }
}
async function reportModal(r) {
  const reasons = ['copyright', 'wrong_info', 'broken_file', 'inappropriate', 'other'];
  const v = await modal({ title: t('report.title'), body: html`<p class="meta">${r.title}</p><label class="field"><span>${t('report.reason')}</span><select name="reason">${reasons.map((x) => html`<option value="${x}">${t('report.r.' + x)}</option>`)}</select></label>
    <label class="field"><span>${t('report.details')}</span><textarea name="details" rows="4" maxlength="1000"></textarea></label>`,
    actions: [{ label: t('common.cancel'), kind: 'ghost', value: null }, { label: t('report.send'), kind: 'primary', collect: (w) => ({ reason: w.querySelector('[name=reason]').value, details: w.querySelector('[name=details]').value }) }] });
  if (!v) return;
  try { await api.report(r.id, v.reason, v.details); toast(t('report.sent'), 'ok'); } catch (e) { toast(/duplicate|23505/.test(String(e.message) + e.code) ? t('report.dup') : friendlyError(e), 'error'); }
}
