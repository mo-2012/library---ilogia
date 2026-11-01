// Sign-in / sign-up / password reset. Used by the student app and by the admin app.
import { auth } from '../lib/api.js';
import { html, raw, mount, $, friendlyError, toast } from '../lib/ui.js';
import { icon } from '../lib/icons.js';
import { t, getLang, setLang } from '../lib/i18n.js';

export function renderAuth(el, { admin = false, onLangChange } = {}) {
  let mode = 'in', busy = false, msg = null; const vals = { name: '', email: '' };
  const view = () => {
    const title = mode === 'in' ? t('auth.signin') : mode === 'up' ? t('auth.signup') : t('auth.reset');
    mount(el, html`<div class="auth">
      <section class="auth-art"><div class="brand brand--big"><img src="/favicon.svg" alt="" width="44" height="44"><span>iLogia <b>Library</b></span></div>
        <h1>${admin ? t('auth.adminTitle') : t('auth.artTitle')}</h1><p>${admin ? t('auth.adminText') : t('auth.artText')}</p>
        <div class="auth-shelf" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div></section>
      <section class="auth-form"><button class="btn ghost sm lang-btn" data-lang type="button">${raw(icon('languages', 16))}${getLang() === 'ar' ? 'English' : 'العربية'}</button>
        <form novalidate autocomplete="on"><h2>${title}</h2>
          ${msg ? html`<div class="notice notice--${msg.kind}" role="alert">${raw(icon(msg.kind === 'ok' ? 'ok' : 'alert', 18))}<span>${msg.text}</span></div>` : ''}
          ${mode === 'up' ? html`<label class="field"><span>${t('auth.name')}</span><input name="name" autocomplete="name" required minlength="3" maxlength="80" value="${vals.name}"></label>` : ''}
          <label class="field"><span>${t('auth.email')}</span><input name="email" type="email" autocomplete="email" inputmode="email" required dir="ltr" value="${vals.email}"></label>
          ${mode !== 'reset' ? html`<label class="field"><span>${t('auth.password')}</span><input name="password" type="password" autocomplete="${mode === 'in' ? 'current-password' : 'new-password'}" required minlength="8" dir="ltr"></label>` : ''}
          <button class="btn primary block" type="submit" ${busy ? raw('disabled aria-busy="true"') : ''}>${busy ? t('common.wait') : title}</button>
          ${mode === 'in' ? html`<button type="button" class="link" data-mode="reset">${t('auth.forgot')}</button>` : ''}
        </form>
        ${mode !== 'reset' ? html`<div class="or"><span>${t('auth.or')}</span></div><button class="btn block google" type="button" data-google>${raw(icon('globe', 18))}${t('auth.google')}</button>` : ''}
        <p class="auth-switch">${mode === 'in' ? html`${t('auth.noAccount')} <button class="link" data-mode="up" type="button">${t('auth.signup')}</button>` : html`${t('auth.haveAccount')} <button class="link" data-mode="in" type="button">${t('auth.signin')}</button>`}</p>
        <p class="auth-note">${raw(icon('lock', 14))} ${t('auth.note')}</p></section></div>`);
    $('input', el)?.focus();
  };
  el.onclick = async (e) => {
    if (e.target.closest('[data-lang]')) { setLang(getLang() === 'ar' ? 'en' : 'ar'); onLangChange?.(); msg = null; return view(); }
    const m = e.target.closest('[data-mode]'); if (m) { mode = m.dataset.mode; msg = null; return view(); }
    if (e.target.closest('[data-google]')) { try { await auth.google(); } catch (err) { msg = { kind: 'error', text: friendlyError(err) }; view(); } }
  };
  el.oninput = (e) => { if (e.target.name in vals) vals[e.target.name] = e.target.value; };
  el.onsubmit = async (e) => {
    e.preventDefault(); if (busy) return;
    const f = new FormData(e.target), email = String(f.get('email') || '').trim(), password = String(f.get('password') || ''), name = String(f.get('name') || '').trim();
    vals.email = email; vals.name = name;
    if (!/^\S+@\S+\.\S+$/.test(email)) { msg = { kind: 'error', text: t('auth.badEmail') }; return view(); }
    if (mode === 'up' && name.length < 3) { msg = { kind: 'error', text: t('auth.badName') }; return view(); }
    if (mode !== 'reset' && password.length < 8) { msg = { kind: 'error', text: t('auth.badPassword') }; return view(); }
    busy = true; msg = null; view();
    try {
      if (mode === 'in') await auth.signIn(email, password);
      else if (mode === 'up') { await auth.signUp(name, email, password); msg = { kind: 'ok', text: t('auth.checkMail') }; mode = 'in'; }
      else { await auth.reset(email); msg = { kind: 'ok', text: t('auth.resetSent') }; mode = 'in'; }
    } catch (err) { msg = { kind: 'error', text: friendlyError(err) }; }
    busy = false; if (el.isConnected && $('.auth', el)) view();
  };
  view();
  return () => { el.onclick = null; el.onsubmit = null; el.oninput = null; };
}
