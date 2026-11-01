import { html, raw, cover, statusBadge } from './ui.js';
import { icon } from './icons.js';
import { t, fmtDate, fmtSize, fmtNum } from './i18n.js';
import { state } from './state.js';

export const resHref = (r) => `#/resource/${r.id}`;

export const bmButton = (id) => {
  const on = state.bookmarks.has(id);
  return html`<button type="button" class="bm ${on ? 'on' : ''}" data-bm="${id}" aria-pressed="${on}" aria-label="${on ? t('res.unsave') : t('res.save')}" title="${on ? t('res.unsave') : t('res.save')}">${raw(icon(on ? 'bookmark-check' : 'bookmark', 18))}</button>`;
};

/** Grid card or list row. `covers` is the {path→signed url} map from api.coverUrls(). */
export function resourceCard(r, covers = {}, { view = 'grid', progress } = {}) {
  const meta = [r.subject?.name, r.grade?.name].filter(Boolean).join(' · ');
  const cv = cover(r, covers[r.cover_path]);
  if (view === 'list') {
    return html`<article class="row-card"><a class="row-cover" href="${resHref(r)}" tabindex="-1" aria-hidden="true">${cv}</a>
      <div class="row-main"><h3><a href="${resHref(r)}">${r.title}</a></h3>
        <p class="row-desc">${r.description || ''}</p>
        <p class="meta">${[meta, r.author, t('type.' + r.file_type), r.file_size ? fmtSize(r.file_size) : '', r.published_at ? fmtDate(r.published_at) : ''].filter(Boolean).join(' · ')}</p></div>
      ${bmButton(r.id)}</article>`;
  }
  return html`<article class="card res"><a class="res-cover" href="${resHref(r)}" tabindex="-1" aria-hidden="true">${cv}</a>${bmButton(r.id)}
    <div class="res-body"><h3 class="res-title"><a href="${resHref(r)}">${r.title}</a></h3>
      ${meta ? html`<p class="meta">${meta}</p>` : ''}
      ${progress != null ? html`<div class="bar" role="progressbar" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100"><i style="inline-size:${progress}%"></i></div><p class="meta">${t('prog.percent', { n: fmtNum(progress) })}</p>` : ''}
      ${r.status !== 'published' ? statusBadge(r.status) : ''}</div></article>`;
}
export const grid = (rows, covers, opts) => html`<div class="grid">${rows.map((r) => resourceCard(r, covers, opts))}</div>`;
