// Minimal hash router: "#/explore?q=math" → { path:'/explore', query:{q:'math'} }. Pages are lazy-loaded modules.
export function parseHash(h = location.hash) {
  const raw = h.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(qs)) };
}
export const href = (path, query = {}) => {
  const q = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== '' && v != null && v !== false)).toString();
  return '#' + path + (q ? '?' + q : '');
};
export const go = (h, { replace = false } = {}) => { if (replace) history.replaceState(null, '', h); else location.hash = h; if (replace) dispatchEvent(new HashChangeEvent('hashchange')); };
/** Updates the URL without re-rendering (used for filters / tabs that re-render themselves). */
export const setQuery = (path, query) => history.replaceState(null, '', href(path, query));

let listener = null;
export function createRouter(routes, onRoute) {
  let token = 0, cleanup = null;
  async function run() {
    const my = ++token; const { path, query } = parseHash();
    let match = null, params = {};
    for (const r of routes) { const m = r.re.exec(path); if (m) { match = r; params = m.groups || {}; break; } }
    if (typeof cleanup === 'function') { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
    const ctx = { path, params, query, alive: () => my === token };
    onRoute(match, ctx);
    if (!match) return;
    try { const mod = await match.load(); if (my !== token) return; const c = await mod.default(ctx); if (my === token) cleanup = c; else if (typeof c === 'function') c(); }
    catch (e) { if (my === token) { console.error('[route]', e); ctx.error?.(e); } }
  }
  if (listener) removeEventListener('hashchange', listener);
  listener = run; addEventListener('hashchange', run);
  return { run };
}
