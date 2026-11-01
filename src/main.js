import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import '@fontsource/noto-naskh-arabic/600.css';
import '@fontsource/noto-naskh-arabic/700.css';
import './styles/main.css';
import { auth, whoami, bookmarks, meta } from './lib/api.js';
import * as api from './lib/api.js';
import { state } from './lib/state.js';
import { applyLang, getLang, setLang, t } from './lib/i18n.js';
import { html, raw, mount, $, $$, toast, modal, errorState, friendlyError } from './lib/ui.js';
import { icon } from './lib/icons.js';
import { createRouter, parseHash, href, go } from './lib/router.js';
import { renderAuth } from './pages/auth.js';
import { MAIN_SITE } from './config.js';

applyLang();
const app = $('#app');

const routes = [
  { re: /^\/?$/, nav: 'home', load: () => import('./pages/home.js') },
  { re: /^\/explore$/, nav: 'explore', load: () => import('./pages/explore.js') },
  { re: /^\/categories$/, nav: 'categories', load: () => import('./pages/categories.js') },
  { re: /^\/resource\/(?<id>[0-9a-f-]{36})$/i, nav: 'explore', load: () => import('./pages/resource.js') },
  { re: /^\/read\/(?<id>[0-9a-f-]{36})$/i, nav: 'explore', reader: true, load: () => import('./pages/reader.js') },
  { re: /^\/my$/, nav: 'my', load: () => import('./pages/mylibrary.js') },
  { re: /^\/upload$/, nav: 'upload', load: () => import('./pages/upload.js') },
];

let router = null, unsubAuth = null, cleanupAuth = null, booted = false;

// ───────── shell ─────────
function navItem(key, ic, label, target) {
  return html`<a class="nav-item" href="${target}" data-nav="${key}">${raw(icon(ic, 19))}<span>${label}</span></a>`;
}
function shell() {
  const u = state.user;
  mount(app, html`<div class="app">
    <aside class="side" id="side" aria-label="${t('nav.main')}">
      <a class="brand" href="#/"><img src="/favicon.svg" alt="" width="36" height="36"><span>iLogia <b>Library</b></span></a>
      <nav>
        ${navItem('home', 'home', t('nav.home'), '#/')}
        ${navItem('explore', 'search', t('nav.explore'), '#/explore')}
        ${navItem('categories', 'layers', t('nav.categories'), '#/categories')}
        ${navItem('my', 'library', t('nav.my'), '#/my')}
        ${u.canUpload ? navItem('upload', 'upload', t('nav.upload'), '#/upload') : ''}
        ${u.isAdmin ? html`<a class="nav-item nav-item--admin" href="/admin/">${raw(icon('shield', 19))}<span>${t('nav.admin')}</span></a>` : ''}
      </nav>
      <div class="side-foot">
        <a class="side-link" href="${MAIN_SITE}" rel="noopener">${raw(icon('arrow-up-right', 16))}${t('nav.mainSite')}</a>
        <div class="who"><span class="avatar" aria-hidden="true">${(u.name || '?').trim().charAt(0).toUpperCase()}</span><span class="who-t"><b>${u.name}</b><small dir="ltr">${u.email}</small></span>
          <button class="icon-btn light" data-logout aria-label="${t('nav.logout')}" title="${t('nav.logout')}">${raw(icon('logout', 18))}</button></div>
      </div>
    </aside>
    <div class="main-col">
      <header class="top"><button class="icon-btn only-mobile" data-menu aria-label="${t('nav.menu')}" aria-expanded="false" aria-controls="side">${raw(icon('menu', 22))}</button>
        <form class="top-search" role="search" data-search>${raw(icon('search', 18))}<input type="search" name="q" placeholder="${t('search.placeholder')}" aria-label="${t('search.placeholder')}" maxlength="80" autocomplete="off"></form>
        <button class="btn ghost sm" data-lang type="button">${raw(icon('languages', 16))}<span class="hide-sm">${getLang() === 'ar' ? 'English' : 'العربية'}</span></button></header>
      <main id="view" tabindex="-1" aria-live="polite"></main>
    </div><div class="scrim" data-scrim></div></div>`);
}
const setMenu = (open) => { $('.app')?.classList.toggle('menu-open', open); $('[data-menu]')?.setAttribute('aria-expanded', String(open)); };

app.addEventListener('click', async (e) => {
  if (e.target.closest('[data-menu]')) return setMenu(!$('.app')?.classList.contains('menu-open'));
  if (e.target.closest('[data-scrim]') || e.target.closest('.nav-item')) setMenu(false);
  if (e.target.closest('[data-lang]') && state.user) { setLang(getLang() === 'ar' ? 'en' : 'ar'); shell(); router.run(); return; }
  if (e.target.closest('[data-logout]')) { await auth.signOut(); return; }
  const bm = e.target.closest('[data-bm]');
  if (bm) { e.preventDefault(); await toggleBookmark(bm.dataset.bm); }
});
app.addEventListener('submit', (e) => {
  const f = e.target.closest('[data-search]'); if (!f) return; e.preventDefault();
  const q = String(new FormData(f).get('q') || '').trim(); go(href('/explore', { q }));
});
addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });

async function toggleBookmark(id) {
  const was = state.bookmarks.has(id);
  const paint = (on) => $$(`[data-bm="${id}"]`).forEach((b) => { b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); const l = on ? t('res.unsave') : t('res.save'); b.setAttribute('aria-label', l); b.title = l;
    if (!b.classList.contains('bm') ) return; b.innerHTML = icon(on ? 'bookmark-check' : 'bookmark', 18); });
  was ? state.bookmarks.delete(id) : state.bookmarks.add(id); paint(!was);
  try { was ? await bookmarks.remove(id) : await bookmarks.add(id); toast(was ? t('res.removed') : t('res.saved'), 'ok', 2200);
    document.dispatchEvent(new CustomEvent('bookmarks-changed', { detail: { id, on: !was } })); }
  catch (err) { was ? state.bookmarks.add(id) : state.bookmarks.delete(id); paint(was); toast(friendlyError(err), 'error'); }
}

// ───────── boot ─────────
async function startSignedIn(session) {
  try {
    state.user = await whoami(session);
    const [cats, subjects, grades, ids] = await Promise.all([meta.categories(), meta.subjects(), meta.grades(), bookmarks.ids().catch(() => new Set())]);
    Object.assign(state, { cats, subjects, grades, bookmarks: ids });
  } catch (e) {
    console.error('[boot]', e);
    mount(app, html`<div class="boot">${errorState(e)}</div>`); $('[data-retry]')?.addEventListener('click', () => location.reload()); return;
  }
  cleanupAuth?.(); cleanupAuth = null; shell();
  router = createRouter(routes, (route, ctx) => {
    const view = $('#view');
    $$('.nav-item').forEach((a) => a.classList.toggle('active', a.dataset.nav === route?.nav));
    $('.app').classList.toggle('app--reader', !!route?.reader);
    setMenu(false);
    const host = document.createElement('div'); host.className = 'route'; view.replaceChildren(host);   // fresh node per route → listeners die with it
    ctx.el = host; ctx.user = state.user; ctx.state = state; ctx.api = api;
    ctx.error = (e) => { mount(host, errorState(e)); host.querySelector('[data-retry]')?.addEventListener('click', () => router.run()); };
    if (!route) mount(host, html`<div class="state"><h3>${t('err.404')}</h3><a class="btn primary" href="#/">${t('nav.home')}</a></div>`);
    else { mount(host, html`<div class="loading"><span class="spinner"></span></div>`); scrollTo(0, 0); }
    if (route && ctx.alive()) queueMicrotask(() => view.focus({ preventScroll: true }));
  });
  booted = true; router.run();
}
function showAuth() {
  booted = false; state.user = null; state.bookmarks = new Set(); meta.reset(); cleanupAuth?.();
  cleanupAuth = renderAuth(app, { onLangChange: () => applyLang() });
}
async function boot() {
  const session = await auth.session();
  unsubAuth?.data?.subscription?.unsubscribe();
  unsubAuth = auth.onChange(async (ev, s) => {
    if (ev === 'PASSWORD_RECOVERY') return promptNewPassword();
    if (ev === 'SIGNED_OUT') return showAuth();
    if (ev === 'SIGNED_IN' && s && !booted) return startSignedIn(s);
  });
  session ? await startSignedIn(session) : showAuth();
}
async function promptNewPassword() {
  const v = await modal({ title: t('auth.newPassword'), body: html`<label class="field"><span>${t('auth.password')}</span><input name="np" type="password" minlength="8" autocomplete="new-password" dir="ltr" autofocus></label>`,
    actions: [{ label: t('common.cancel'), kind: 'ghost', value: null }, { label: t('common.save'), kind: 'primary', collect: (w) => w.querySelector('[name=np]').value, validate: (w) => w.querySelector('[name=np]').value.length >= 8 }] });
  if (!v) return; try { await auth.setPassword(v); toast(t('auth.passwordUpdated'), 'ok'); } catch (e) { toast(friendlyError(e), 'error'); }
}
boot();
