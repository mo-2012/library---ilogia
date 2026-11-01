import { icon, TYPE_ICON } from './icons.js';
import { t, catName } from './i18n.js';

// ───────── safe HTML templating: every interpolated value is escaped unless wrapped by raw()/html`` ─────────
class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Safe(String(s ?? ''));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"'`]/g, (c) => ESC[c]);
const part = (v) => (v instanceof Safe ? v.s : Array.isArray(v) ? v.map(part).join('') : v == null || v === false ? '' : esc(v));
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += part(vals[i]) + strings[i + 1];
  return new Safe(out);
}
export const mount = (el, tpl) => { el.innerHTML = tpl instanceof Safe ? tpl.s : esc(tpl); return el; };
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const debounce = (fn, ms = 300) => { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); }; };

/** Only https URLs may be opened from user-supplied data. */
export const safeHttps = (u) => { try { const x = new URL(u); return x.protocol === 'https:' ? x.href : null; } catch { return null; } };

// ───────── toast ─────────
export function toast(msg, kind = 'info', ms = 4200) {
  let host = $('#toasts');
  if (!host) { host = document.createElement('div'); host.id = 'toasts'; host.setAttribute('role', 'status'); host.setAttribute('aria-live', 'polite'); document.body.append(host); }
  const el = document.createElement('div'); el.className = `toast toast--${kind}`;
  el.innerHTML = `${icon(kind === 'error' ? 'alert' : kind === 'ok' ? 'ok' : 'info', 18)}<span></span>`;
  el.querySelector('span').textContent = msg; host.append(el);
  setTimeout(() => { el.classList.add('toast--out'); setTimeout(() => el.remove(), 250); }, ms);
}

// ───────── modal ─────────
/** modal({title, body: Safe, actions:[{label, kind, value}]}) → resolves with action value or null on dismiss. `onMount(el)` wires inputs. */
export function modal({ title, body, actions = [], onMount, wide = false }) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const wrap = document.createElement('div'); wrap.className = 'modal-wrap';
    wrap.innerHTML = `<div class="modal ${wide ? 'modal--wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="m-title" tabindex="-1">
      <header><h2 id="m-title"></h2><button type="button" class="icon-btn" data-close aria-label="${esc(t('common.close'))}">${icon('x')}</button></header>
      <div class="modal-body">${body ? part(body) : ''}</div>
      <footer>${actions.map((a, i) => `<button type="button" class="btn ${esc(a.kind || '')}" data-i="${i}">${esc(a.label)}</button>`).join('')}</footer></div>`;
    wrap.querySelector('#m-title').textContent = title;
    const dlg = wrap.firstElementChild;
    const done = (v) => { document.removeEventListener('keydown', onKey, true); wrap.remove(); document.body.classList.remove('has-modal'); prev?.focus?.(); resolve(v); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); done(null); }
      if (e.key === 'Tab') { const f = $$('button,input,select,textarea,a[href]', dlg).filter((x) => !x.disabled && x.offsetParent !== null); if (!f.length) return;
        const a = f[0], z = f[f.length - 1]; if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } }
    };
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) done(null); });
    wrap.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) return done(null);
      const b = e.target.closest('footer [data-i]'); if (!b) return;
      const a = actions[+b.dataset.i];
      if (a.validate && !a.validate(wrap)) return;
      done(a.collect ? a.collect(wrap) : a.value ?? true);
    });
    document.addEventListener('keydown', onKey, true);
    document.body.append(wrap); document.body.classList.add('has-modal');
    onMount?.(wrap); (dlg.querySelector('[autofocus],input,select,textarea') || dlg).focus();
  });
}
export const confirmBox = (title, text, okLabel, danger = false) =>
  modal({ title, body: html`<p>${text}</p>`, actions: [{ label: t('common.cancel'), value: false, kind: 'ghost' }, { label: okLabel || t('common.confirm'), value: true, kind: danger ? 'danger' : 'primary' }] });

// ───────── states ─────────
export const skeletonGrid = (n = 8) => html`<div class="grid">${Array.from({ length: n }, () => html`<div class="card skel"><div class="skel-cover"></div><div class="skel-line"></div><div class="skel-line short"></div></div>`)}</div>`;
export const emptyState = ({ icon: ic = 'inbox', title, text, action }) => html`<div class="state state--empty">${raw(icon(ic, 34))}<h3>${title}</h3>${text ? html`<p>${text}</p>` : ''}${action ? raw(action) : ''}</div>`;
export function errorState(err, retryAttr = 'data-retry') {
  return html`<div class="state state--error" role="alert">${raw(icon('alert', 34))}<h3>${t('err.load')}</h3><p>${friendlyError(err)}</p><button class="btn" ${raw(retryAttr)}>${raw(icon('refresh', 16))}${t('common.retry')}</button></div>`;
}
/** Maps Supabase/network errors to a human sentence. Never leaks SQL details. */
export function friendlyError(e) {
  const m = String(e?.message || e || '');
  const c = e?.code || '';
  if (/Failed to fetch|NetworkError|TIMEOUT|network/i.test(m)) return t('err.network');
  if (c === 'PGRST205' || c === '42P01' || /library_(resources|categories)|schema cache/i.test(m)) return t('err.notReady');
  if (c === '42501' || /row-level security|permission denied|not_admin/i.test(m)) return t('err.denied');
  if (/Invalid login credentials/i.test(m)) return t('err.login');
  if (/Email not confirmed/i.test(m)) return t('err.unconfirmed');
  if (/already registered/i.test(m)) return t('err.exists');
  if (/rate limit/i.test(m)) return t('err.rate');
  if (/duplicate key|23505/.test(m + c)) return t('err.duplicate');
  if (/download_not_allowed/.test(m)) return t('err.noDownload');
  if (/reason_required/.test(m)) return t('err.reason');
  if (/collection_limit|bookmark_limit|items_limit/.test(m)) return t('err.limit');
  return t('err.generic');
}

// ───────── resource visuals ─────────
export const statusKey = { published: 'status.published', pending: 'status.pending', unavailable: 'status.unavailable', rejected: 'status.rejected', draft: 'status.draft' };
export const statusBadge = (s) => html`<span class="badge badge--${s}">${t(statusKey[s] || 'status.draft')}</span>`;
export const typeLabel = (ft) => t('type.' + ft);

const VARIANTS = ['navy', 'blue', 'gold', 'paper', 'steel', 'ink'];
const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
/** Cover: uploaded image when available, otherwise a typeset cover (spine, frame, title, category). */
export function cover(r, url) {
  const v = VARIANTS[hash(r.category?.slug || r.category_id) % VARIANTS.length];
  if (url) return html`<div class="cover cover--img"><img src="${url}" alt="" loading="lazy" decoding="async"><span class="cover-type">${raw(icon(TYPE_ICON[r.file_type] || 'file', 14))}${typeLabel(r.file_type)}</span></div>`;
  return html`<div class="cover cover--${v}" aria-hidden="true"><span class="cover-spine"></span><span class="cover-frame"></span>
    <span class="cover-kicker">${catName(r.category)}</span><span class="cover-title">${r.title}</span>
    <span class="cover-foot">${r.subject?.name || r.author || ''}</span>
    <span class="cover-type">${raw(icon(TYPE_ICON[r.file_type] || 'file', 14))}${typeLabel(r.file_type)}</span></div>`;
}
