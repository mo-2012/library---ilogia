import * as api from '../lib/api.js';
import { html, raw, mount, $, $$, skeletonGrid, emptyState, errorState, debounce } from '../lib/ui.js';
import { icon } from '../lib/icons.js';
import { t, catName, fmtNum } from '../lib/i18n.js';
import { setQuery, href } from '../lib/router.js';
import { resourceCard } from '../lib/cards.js';
import { PAGE_SIZE } from '../config.js';

const TYPES = ['pdf', 'doc', 'ppt', 'xls', 'video', 'audio', 'image', 'epub', 'text', 'link', 'other'];
const SORTS = ['new', 'views', 'name'];
const num = (v) => (v && /^\d+$/.test(v) ? +v : undefined);

export default async function explore({ el, query, state, alive }) {
  let view = 'grid'; try { view = localStorage.getItem('ilogia-view') === 'list' ? 'list' : 'grid'; } catch { /* ignore */ }
  const f = { q: (query.q || '').slice(0, 80), category: num(query.category), subject: num(query.subject), grade: num(query.grade),
    type: TYPES.includes(query.type) ? query.type : '', sort: SORTS.includes(query.sort) ? query.sort : 'new', page: Math.max(1, num(query.page) || 1) };
  let facets = { category: {}, subject: {}, grade: {}, file_type: {} };
  try { facets = await api.meta.facets(); } catch { /* counts are optional */ }
  if (!alive()) return;

  const opt = (items, cur, label, count) => items.map((i) => html`<option value="${i.id}" ${String(cur) === String(i.id) ? raw('selected') : ''}>${label(i)}${count(i) != null ? ` (${fmtNum(count(i))})` : ''}</option>`);
  mount(el, html`<div class="page"><header class="page-head"><h1>${t('explore.title')}</h1></header>
    <form class="filters" role="search" data-filters>
      <label class="field grow"><span class="sr">${t('search.placeholder')}</span><div class="input-ic">${raw(icon('search', 18))}<input type="search" name="q" value="${f.q}" placeholder="${t('explore.searchPh')}" maxlength="80" autocomplete="off"></div></label>
      <label class="field"><span>${t('f.subject')}</span><select name="subject"><option value="">${t('f.all')}</option>${opt(state.subjects.filter((s) => facets.subject[s.id] || String(f.subject) === String(s.id)), f.subject, (s) => s.name, (s) => facets.subject[s.id] || 0)}</select></label>
      <label class="field"><span>${t('f.grade')}</span><select name="grade"><option value="">${t('f.all')}</option>${opt(state.grades.filter((g) => facets.grade[g.id] || String(f.grade) === String(g.id)), f.grade, (g) => g.name, (g) => facets.grade[g.id] || 0)}</select></label>
      <label class="field"><span>${t('f.type')}</span><select name="type"><option value="">${t('f.all')}</option>${TYPES.filter((x) => facets.file_type[x] || f.type === x).map((x) => html`<option value="${x}" ${f.type === x ? raw('selected') : ''}>${t('type.' + x)} (${fmtNum(facets.file_type[x] || 0)})</option>`)}</select></label>
      <label class="field"><span>${t('f.sort')}</span><select name="sort">${SORTS.map((x) => html`<option value="${x}" ${f.sort === x ? raw('selected') : ''}>${t('sort.' + x)}</option>`)}</select></label>
    </form>
    <div class="chips" role="group" aria-label="${t('f.category')}"><button class="chip ${!f.category ? 'on' : ''}" data-cat="">${t('f.all')}</button>
      ${state.cats.map((c) => html`<button class="chip ${f.category === c.id ? 'on' : ''}" data-cat="${c.id}" aria-pressed="${f.category === c.id}">${catName(c)} <small>${fmtNum(facets.category[c.id] || 0)}</small></button>`)}</div>
    <div class="results-bar"><p data-count aria-live="polite"></p><div class="seg" role="group" aria-label="${t('f.view')}">
      <button data-view="grid" class="${view === 'grid' ? 'on' : ''}" aria-pressed="${view === 'grid'}" title="${t('f.grid')}">${raw(icon('grid', 18))}</button>
      <button data-view="list" class="${view === 'list' ? 'on' : ''}" aria-pressed="${view === 'list'}" title="${t('f.list')}">${raw(icon('rows', 18))}</button></div></div>
    <div data-results aria-busy="true"></div><nav class="pager" data-pager aria-label="${t('pager.label')}"></nav></div>`);

  const sync = () => setQuery('/explore', { q: f.q, category: f.category, subject: f.subject, grade: f.grade, type: f.type, sort: f.sort === 'new' ? '' : f.sort, page: f.page > 1 ? f.page : '' });
  let reqId = 0;
  async function load() {
    const my = ++reqId; const box = $('[data-results]', el); box.setAttribute('aria-busy', 'true'); mount(box, skeletonGrid(8));
    try {
      const { rows, count } = await api.listResources({ ...f });
      if (my !== reqId || !alive()) return;
      const covers = await api.coverUrls(rows); if (my !== reqId || !alive()) return;
      $('[data-count]', el).textContent = t('explore.count', { n: fmtNum(count) });
      if (!rows.length) {
        const filtered = f.q || f.category || f.subject || f.grade || f.type;
        mount(box, emptyState({ icon: 'search', title: t(filtered ? 'explore.noneTitle' : 'explore.emptyTitle'), text: t(filtered ? 'explore.noneText' : 'explore.emptyText'),
          action: filtered ? `<button class="btn" data-clear>${t('f.clear')}</button>` : '' }));
      } else mount(box, view === 'list' ? html`<div class="rows">${rows.map((r) => resourceCard(r, covers, { view }))}</div>` : html`<div class="grid">${rows.map((r) => resourceCard(r, covers, { view }))}</div>`);
      const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
      mount($('[data-pager]', el), pages > 1 ? html`<button class="btn sm" data-page="${f.page - 1}" ${f.page <= 1 ? raw('disabled') : ''}>${raw(icon('chev-r', 16, 'flip'))}${t('pager.prev')}</button><span>${t('pager.of', { n: fmtNum(f.page), total: fmtNum(pages) })}</span><button class="btn sm" data-page="${f.page + 1}" ${f.page >= pages ? raw('disabled') : ''}>${t('pager.next')}${raw(icon('chev-l', 16, 'flip'))}</button>` : '');
    } catch (e) { if (my === reqId && alive()) { mount(box, errorState(e)); $('[data-retry]', box)?.addEventListener('click', load); } }
    finally { box.setAttribute('aria-busy', 'false'); }
  }
  const apply = (patch) => { Object.assign(f, patch, patch.page ? {} : { page: 1 }); sync(); load(); };
  const form = $('[data-filters]', el);
  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('input', debounce((e) => { if (e.target.name === 'q') apply({ q: e.target.value.trim().slice(0, 80) }); }, 350));
  form.addEventListener('change', (e) => { const n = e.target.name; if (n && n !== 'q') apply({ [n]: ['subject', 'grade'].includes(n) ? num(e.target.value) : e.target.value }); });
  el.addEventListener('click', (e) => {
    const c = e.target.closest('[data-cat]'); if (c) { apply({ category: num(c.dataset.cat) }); $$('[data-cat]', el).forEach((b) => { const on = (num(b.dataset.cat) ?? undefined) === f.category; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); }
    const v = e.target.closest('[data-view]'); if (v) { view = v.dataset.view; try { localStorage.setItem('ilogia-view', view); } catch { /* ignore */ } $$('[data-view]', el).forEach((b) => { b.classList.toggle('on', b === v); b.setAttribute('aria-pressed', String(b === v)); }); load(); }
    const p = e.target.closest('[data-page]'); if (p && !p.disabled) { apply({ page: +p.dataset.page }); scrollTo({ top: 0 }); }
    if (e.target.closest('[data-clear]')) location.hash = '#/explore';
  });
  load();
}
