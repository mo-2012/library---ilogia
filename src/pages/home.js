import * as api from '../lib/api.js';
import { html, raw, mount, $, $$, skeletonGrid, emptyState, errorState, friendlyError } from '../lib/ui.js';
import { icon } from '../lib/icons.js';
import { t, catName, fmtNum } from '../lib/i18n.js';
import { href, go } from '../lib/router.js';
import { resourceCard, resHref } from '../lib/cards.js';

const section = (id, title, body, more) => html`<section class="block" aria-labelledby="${id}"><div class="block-head"><h2 id="${id}">${title}</h2>${more ? html`<a class="more" href="${more}">${t('common.all')}${raw(icon('chev-l', 16, 'flip'))}</a>` : ''}</div>${body}</section>`;

export default async function home({ el, user, state, alive }) {
  const name = (user.name || '').split(' ')[0];
  mount(el, html`<div class="page">
    <header class="hero"><div class="hero-text"><h1>${t('home.hello', { name })}</h1><p>${t('home.lead')}</p>
      <form class="hero-search" role="search" data-hsearch>${raw(icon('search', 22))}<input type="search" name="q" placeholder="${t('home.searchPh')}" aria-label="${t('home.searchPh')}" maxlength="80" autocomplete="off"><button class="btn gold" type="submit">${t('search.go')}</button></form>
      <div class="chips" data-subjects></div></div></header>
    <div data-shelf>${skeletonGrid(6)}</div><div data-rest></div></div>`);
  $('[data-hsearch]', el).addEventListener('submit', (e) => { e.preventDefault(); go(href('/explore', { q: String(new FormData(e.target).get('q') || '').trim() })); });

  try {
    const [facets, newest, top, prog, saved] = await Promise.all([api.meta.facets(), api.latest(8), api.mostViewed(6), api.progress.list(8).catch(() => []), api.bookmarks.list(6).catch(() => [])]);
    if (!alive()) return;
    const inProgress = prog.filter((p) => p.resource && p.resource.status === 'published' && p.percent < 100).slice(0, 4);
    const savedRows = saved.map((x) => x.resource).filter(Boolean);
    const covers = await api.coverUrls([...newest, ...top, ...inProgress.map((p) => p.resource), ...savedRows]);
    if (!alive()) return;

    // subject chips with real counts
    const subs = state.subjects.filter((s) => facets.subject[s.id]);
    $('[data-subjects]', el).innerHTML = subs.map((s) => `<a class="chip" href="${href('/explore', { subject: s.id })}">${esc(s.name)} <small>${fmtNum(facets.subject[s.id])}</small></a>`).join('');

    if (!facets.total) {
      mount($('[data-shelf]', el), emptyState({ icon: 'library', title: t('home.emptyTitle'), text: user.canUpload ? t('home.emptyUploader') : t('home.emptyStudent'),
        action: user.canUpload ? `<a class="btn primary" href="#/upload">${t('nav.upload')}</a>` : '' }));
      return;
    }
    mount($('[data-shelf]', el), section('s-new', t('home.latest'), html`<div class="shelf" role="list">${newest.map((r) => html`<div role="listitem">${resourceCard(r, covers)}</div>`)}</div><div class="shelf-board" aria-hidden="true"></div>`, '#/explore'));
    const cats = state.cats.map((c) => html`<a class="cat" href="${href('/explore', { category: c.id })}">${raw(icon(c.icon || 'folder', 22))}<span><b>${catName(c)}</b><small>${t('count.res', { n: fmtNum(facets.category[c.id] || 0) })}</small></span></a>`);
    const rest = [];
    if (inProgress.length) rest.push(section('s-cont', t('home.continue'), html`<div class="grid grid--sm">${inProgress.map((p) => resourceCard(p.resource, covers, { progress: p.percent }))}</div>`, '#/my?tab=continue'));
    rest.push(section('s-cats', t('home.categories'), html`<div class="cats">${cats}</div>`, '#/categories'));
    if (top.length) rest.push(section('s-top', t('home.top'), html`<div class="grid grid--sm">${top.map((r) => resourceCard(r, covers))}</div>`));
    if (savedRows.length) rest.push(section('s-saved', t('home.saved'), html`<div class="grid grid--sm">${savedRows.map((r) => resourceCard(r, covers))}</div>`, '#/my?tab=saved'));
    mount($('[data-rest]', el), html`${rest}`);
  } catch (e) {
    if (!alive()) return;
    mount($('[data-shelf]', el), errorState(e)); $('[data-retry]', el)?.addEventListener('click', () => home(arguments[0]));
  }
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
