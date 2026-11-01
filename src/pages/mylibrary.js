import * as api from '../lib/api.js';
import { html, raw, mount, $, $$, toast, modal, confirmBox, errorState, emptyState, skeletonGrid, friendlyError } from '../lib/ui.js';
import { icon } from '../lib/icons.js';
import { t, fmtNum, fmtDate, timeAgo } from '../lib/i18n.js';
import { setQuery } from '../lib/router.js';
import { resourceCard, resHref } from '../lib/cards.js';
import { state } from '../lib/state.js';

const TABS = ['saved', 'continue', 'lists', 'history'];

export default async function mylibrary({ el, query, alive }) {
  let tab = TABS.includes(query.tab) ? query.tab : 'saved', openList = query.list || null;
  const frame = () => mount(el, html`<div class="page"><header class="page-head"><h1>${t('my.title')}</h1></header>
    <div class="tabs" role="tablist">${TABS.map((k) => html`<button role="tab" class="tab ${tab === k ? 'on' : ''}" aria-selected="${tab === k}" data-tab="${k}">${raw(icon({ saved: 'bookmark', continue: 'book-open', lists: 'folder', history: 'history' }[k], 17))}${t('my.' + k)}</button>`)}</div>
    <div data-panel role="tabpanel"></div></div>`);
  frame();
  const panel = () => $('[data-panel]', el);
  const guard = (fn) => async () => { try { await fn(); } catch (e) { if (alive()) { mount(panel(), errorState(e)); $('[data-retry]', el)?.addEventListener('click', show); } } };

  const rowsOf = async (items) => { const rs = items.filter(Boolean); return [rs, await api.coverUrls(rs)]; };

  const views = {
    async saved() {
      const list = await api.bookmarks.list(); const [rs, covers] = await rowsOf(list.map((x) => x.resource)); if (!alive()) return;
      mount(panel(), rs.length ? html`<div class="grid">${rs.map((r) => resourceCard(r, covers))}</div>` : emptyState({ icon: 'bookmark', title: t('my.savedEmpty'), text: t('my.savedEmptyText'), action: `<a class="btn primary" href="#/explore">${t('nav.explore')}</a>` }));
    },
    async continue() {
      const list = await api.progress.list(); const items = list.filter((p) => p.resource); const covers = await api.coverUrls(items.map((p) => p.resource)); if (!alive()) return;
      mount(panel(), items.length ? html`<div class="grid">${items.map((p) => resourceCard(p.resource, covers, { progress: p.percent }))}</div>` : emptyState({ icon: 'book-open', title: t('my.contEmpty'), text: t('my.contEmptyText'), action: `<a class="btn primary" href="#/explore">${t('nav.explore')}</a>` }));
    },
    async history() {
      const ev = await api.history(); const rs = ev.filter((x) => x.resource); const covers = await api.coverUrls(rs.map((x) => x.resource)); if (!alive()) return;
      mount(panel(), rs.length ? html`<ul class="history">${rs.map((x) => html`<li><span class="kind kind--${x.kind}">${raw(icon(x.kind === 'download' ? 'download' : x.kind === 'read' ? 'book-open' : 'eye', 16))}${t('hist.' + x.kind)}</span>
        <a href="${resHref(x.resource)}">${x.resource.title}</a><time datetime="${x.created_at}" title="${fmtDate(x.created_at, { dateStyle: 'medium', timeStyle: 'short' })}">${timeAgo(x.created_at)}</time></li>`)}</ul>` : emptyState({ icon: 'history', title: t('my.histEmpty'), text: t('my.histEmptyText') }));
    },
    async lists() {
      if (openList) return views.listDetail(openList);
      const cols = await api.collections.list(); if (!alive()) return;
      mount(panel(), html`<div class="list-head"><p class="meta">${t('my.listsLead')}</p><button class="btn primary" data-newlist>${raw(icon('folder-plus', 18))}${t('list.new')}</button></div>
        ${cols.length ? html`<div class="cats">${cols.map((c) => html`<a class="cat" href="#/my?tab=lists&list=${c.id}" data-open-list="${c.id}">${raw(icon('folder-open', 24))}<span><b>${c.name}</b><small>${t('count.res', { n: fmtNum(c.items?.[0]?.count || 0) })}</small></span></a>`)}</div>`
          : emptyState({ icon: 'folder', title: t('my.listsEmpty'), text: t('my.listsEmptyText') })}`);
    },
    async listDetail(id) {
      const [cols, items] = await Promise.all([api.collections.list(), api.collections.items(id)]); if (!alive()) return;
      const c = cols.find((x) => x.id === id);
      if (!c) { openList = null; return views.lists(); }
      const rs = items.map((x) => x.resource).filter(Boolean); const covers = await api.coverUrls(rs);
      mount(panel(), html`<div class="list-head"><button class="btn ghost sm" data-back-lists>${raw(icon('arrow-r', 16, 'flip'))}${t('my.lists')}</button>
          <div class="grow"><h2>${c.name}</h2>${c.description ? html`<p class="meta">${c.description}</p>` : ''}</div>
          <button class="btn sm" data-rename="${c.id}">${raw(icon('edit', 16))}${t('list.rename')}</button><button class="btn sm danger" data-del-list="${c.id}">${raw(icon('trash', 16))}${t('common.delete')}</button></div>
        ${rs.length ? html`<div class="grid">${rs.map((r) => html`<div class="with-remove">${resourceCard(r, covers)}<button class="btn sm ghost rm" data-rm-item="${r.id}" data-col="${c.id}">${raw(icon('x', 14))}${t('list.removeItem')}</button></div>`)}</div>` : emptyState({ icon: 'folder-open', title: t('list.empty'), text: t('list.emptyText'), action: `<a class="btn" href="#/explore">${t('nav.explore')}</a>` })}`);
    },
  };
  const show = async () => { mount(panel(), skeletonGrid(4)); await guard(() => views[tab]())(); };
  show();

  el.addEventListener('bookmarks-sync', show);
  const onBm = (ev) => { if (tab === 'saved' && !ev.detail.on) show(); };
  document.addEventListener('bookmarks-changed', onBm);

  el.addEventListener('click', async (e) => {
    const tb = e.target.closest('[data-tab]');
    if (tb) { tab = tb.dataset.tab; openList = null; setQuery('/my', { tab }); frame(); show(); return; }
    const ol = e.target.closest('[data-open-list]'); if (ol) { e.preventDefault(); openList = ol.dataset.openList; setQuery('/my', { tab: 'lists', list: openList }); show(); return; }
    if (e.target.closest('[data-back-lists]')) { openList = null; setQuery('/my', { tab: 'lists' }); show(); return; }
    try {
      if (e.target.closest('[data-newlist]')) {
        const v = await modal({ title: t('list.new'), body: html`<label class="field"><span>${t('list.name')}</span><input name="n" maxlength="80" required autofocus></label><label class="field"><span>${t('list.desc')}</span><input name="d" maxlength="300"></label>`,
          actions: [{ label: t('common.cancel'), kind: 'ghost', value: null }, { label: t('common.create'), kind: 'primary', validate: (w) => !!w.querySelector('[name=n]').value.trim(), collect: (w) => ({ n: w.querySelector('[name=n]').value, d: w.querySelector('[name=d]').value }) }] });
        if (v) { await api.collections.create(v.n, v.d); toast(t('list.created'), 'ok'); show(); }
      }
      const rn = e.target.closest('[data-rename]');
      if (rn) { const cols = await api.collections.list(); const c = cols.find((x) => x.id === rn.dataset.rename);
        const v = await modal({ title: t('list.rename'), body: html`<label class="field"><span>${t('list.name')}</span><input name="n" maxlength="80" value="${c.name}" autofocus></label><label class="field"><span>${t('list.desc')}</span><input name="d" maxlength="300" value="${c.description || ''}"></label>`,
          actions: [{ label: t('common.cancel'), kind: 'ghost', value: null }, { label: t('common.save'), kind: 'primary', validate: (w) => !!w.querySelector('[name=n]').value.trim(), collect: (w) => ({ n: w.querySelector('[name=n]').value, d: w.querySelector('[name=d]').value }) }] });
        if (v) { await api.collections.update(c.id, { name: v.n.trim(), description: v.d.trim() || null }); show(); } }
      const dl = e.target.closest('[data-del-list]');
      if (dl && await confirmBox(t('list.deleteTitle'), t('list.deleteText'), t('common.delete'), true)) { await api.collections.remove(dl.dataset.delList); openList = null; setQuery('/my', { tab: 'lists' }); toast(t('list.deleted'), 'ok'); show(); }
      const ri = e.target.closest('[data-rm-item]'); if (ri) { await api.collections.removeItem(ri.dataset.col, ri.dataset.rmItem); show(); }
    } catch (err) { toast(/duplicate|23505/.test(String(err.message) + err.code) ? t('list.dup') : friendlyError(err), 'error'); }
  });
  return () => document.removeEventListener('bookmarks-changed', onBm);
}
