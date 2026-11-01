import ar from './strings.ar.js';
import en from './strings.en.js';

const DICT = { ar, en };
const KEY = 'ilogia-library-lang';
let lang = 'ar';
try { const s = localStorage.getItem(KEY); if (s === 'en' || s === 'ar') lang = s; } catch { /* storage may be blocked */ }

export const getLang = () => lang;
export const dir = () => (lang === 'ar' ? 'rtl' : 'ltr');
export function applyLang() {
  document.documentElement.lang = lang; document.documentElement.dir = dir();
  document.title = t('app.title');
}
export function setLang(l) {
  lang = l === 'en' ? 'en' : 'ar';
  try { localStorage.setItem(KEY, lang); } catch { /* ignore */ }
  applyLang();
}
/** t(KEY, {n: 3}) — falls back to Arabic, then to the key itself (a test fails the build if a key is missing). */
export function t(key, vars) {
  let s = DICT[lang][key] ?? DICT.ar[key] ?? key;
  if (vars) for (const k in vars) s = s.replaceAll(`{${k}}`, vars[k]);
  return s;
}
const loc = () => (lang === 'ar' ? 'ar-EG' : 'en-GB');
export const fmtNum = (n) => new Intl.NumberFormat(loc()).format(n ?? 0);
export function fmtDate(d, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!d) return '—'; return new Intl.DateTimeFormat(loc(), opts).format(new Date(d));
}
export function fmtSize(b) {
  if (b == null) return '—';
  const u = lang === 'ar' ? ['بايت', 'ك.ب', 'م.ب', 'ج.ب'] : ['B', 'KB', 'MB', 'GB'];
  let i = 0, v = b; while (v >= 1024 && i < 3) { v /= 1024; i++; }
  return `${new Intl.NumberFormat(loc(), { maximumFractionDigits: i ? 1 : 0 }).format(v)} ${u[i]}`;
}
export function timeAgo(d) {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(loc(), { numeric: 'auto' });
  if (s < 60) return rtf.format(0, 'second');
  if (s < 3600) return rtf.format(-Math.floor(s / 60), 'minute');
  if (s < 86400) return rtf.format(-Math.floor(s / 3600), 'hour');
  if (s < 86400 * 30) return rtf.format(-Math.floor(s / 86400), 'day');
  return fmtDate(d);
}
export const catName = (c) => (c ? (lang === 'ar' ? c.name_ar : c.name_en) : '');
