import * as api from '../lib/api.js';
import { html, raw, mount, $, errorState } from '../lib/ui.js';
import { icon } from '../lib/icons.js';
import { t, catName, fmtNum } from '../lib/i18n.js';
import { href } from '../lib/router.js';

export default async function categories({ el, state, alive }) {
  let facets;
  try { facets = await api.meta.facets(); } catch (e) { return mount(el, errorState(e)), $('[data-retry]', el)?.addEventListener('click', () => categories(arguments[0])); }
  if (!alive()) return;
  mount(el, html`<div class="page"><header class="page-head"><h1>${t('cat.title')}</h1><p>${t('cat.lead')}</p></header>
    <section class="block"><div class="block-head"><h2>${t('cat.byKind')}</h2></div>
      <div class="cats cats--big">${state.cats.map((c) => html`<a class="cat" href="${href('/explore', { category: c.id })}">${raw(icon(c.icon || 'folder', 26))}<span><b>${catName(c)}</b><small>${t('count.res', { n: fmtNum(facets.category[c.id] || 0) })}</small></span></a>`)}</div></section>
    <section class="block"><div class="block-head"><h2>${t('cat.bySubject')}</h2></div>
      ${state.subjects.length ? html`<div class="cats">${state.subjects.map((s) => html`<a class="cat cat--subject" href="${href('/explore', { subject: s.id })}"><span class="cat-dot" aria-hidden="true">${(s.name || '?').charAt(0)}</span><span><b>${s.name}</b><small>${t('count.res', { n: fmtNum(facets.subject[s.id] || 0) })}</small></span></a>`)}</div>` : html`<p class="meta">${t('cat.noSubjects')}</p>`}</section></div>`);
}
