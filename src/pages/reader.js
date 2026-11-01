import * as api from '../lib/api.js';
import { html, raw, mount, $, toast, errorState, emptyState, friendlyError } from '../lib/ui.js';
import { icon } from '../lib/icons.js';
import { t, fmtNum, getLang } from '../lib/i18n.js';
import { READER_URL_TTL } from '../config.js';

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const MAX_PIXELS = 16_000_000;

export default async function reader(ctx) {
  const { el, params, alive } = ctx;
  let r;
  try { r = await api.getResource(params.id); } catch (e) { return ctx.error(e); }
  if (!alive()) return;
  if (!r || r.status !== 'published' || r.file_type !== 'pdf') return mount(el, html`<div class="page">${emptyState({ icon: 'ban', title: t('read.unavailable'), text: t('read.unavailableText'), action: `<a class="btn" href="#/resource/${r?.id || ''}">${t('common.back')}</a>` })}</div>`);

  mount(el, html`<div class="reader" data-reader>
    <header class="r-bar"><a class="icon-btn" href="#/resource/${r.id}" aria-label="${t('common.back')}">${raw(icon('arrow-r', 20, 'flip'))}</a><h1 title="${r.title}">${r.title}</h1>
      <div class="r-ctrl" role="toolbar" aria-label="${t('read.tools')}">
        <button class="icon-btn" data-prev aria-label="${t('pager.prev')}">${raw(icon('chev-r', 20, 'flip'))}</button>
        <label class="r-page"><span class="sr">${t('read.goto')}</span><input type="text" inputmode="numeric" pattern="[0-9]*" data-goto value="1" aria-label="${t('read.goto')}"><span data-total>/ …</span></label>
        <button class="icon-btn" data-next aria-label="${t('pager.next')}">${raw(icon('chev-l', 20, 'flip'))}</button>
        <span class="sep"></span>
        <button class="icon-btn" data-zout aria-label="${t('read.zoomOut')}">${raw(icon('zoom-out', 20))}</button><button class="btn ghost sm zoom-v" data-zreset aria-label="${t('read.fit')}">100%</button><button class="icon-btn" data-zin aria-label="${t('read.zoomIn')}">${raw(icon('zoom-in', 20))}</button>
        <button class="icon-btn" data-fit aria-label="${t('read.fitMode')}" title="${t('read.fitMode')}">${raw(icon('maximize', 20))}</button>
        <button class="icon-btn" data-fs aria-label="${t('read.fullscreen')}">${raw(icon('maximize', 20))}</button>
        ${r.allow_download ? html`<button class="icon-btn" data-dl aria-label="${t('res.download')}">${raw(icon('download', 20))}</button>` : ''}
      </div></header>
    <div class="r-stage" data-stage tabindex="0" aria-label="${t('read.page')}"><div class="r-loading" data-rload><span class="spinner"></span><p>${t('read.loading')}</p></div><canvas data-canvas hidden></canvas></div>
    <footer class="r-foot"><div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" data-pbar><i></i></div><span data-status class="meta"></span></footer></div>`);

  const root = $('[data-reader]', el), stage = $('[data-stage]', el), canvas = $('[data-canvas]', el), ctx2d = canvas.getContext('2d');
  const q = (s) => $(s, el);
  let doc = null, handle = null, page = 1, zoom = 1, fit = 'width', task = null, pending = null, rendering = false, saveTimer = null, savedPage = 0, dead = false, retried = false;
  const total = () => doc?.numPages || 0;

  const openDoc = async () => {
    if (handle) { try { await handle.destroy(); } catch { /* ignore */ } }
    const [{ openPdf }, url] = await Promise.all([import('../lib/pdf.js'), api.fileUrl(r, { ttl: READER_URL_TTL })]);
    handle = await openPdf({ url }); doc = handle.doc;
  };
  try {
    await openDoc();
    if (!alive()) { handle.destroy(); return; }
  } catch (e) {
    const pw = e?.name === 'PasswordException';
    return mount(el, html`<div class="page">${emptyState({ icon: 'alert', title: t(pw ? 'read.password' : 'read.failed'), text: pw ? t('read.passwordText') : friendlyError(e), action: `<a class="btn" href="#/resource/${r.id}">${t('common.back')}</a>` })}</div>`);
  }
  api.track(r.id, 'read');
  const prog = await api.progress.get(r.id).catch(() => null);
  if (!alive()) return;
  if (prog?.last_page > 1) { page = Math.min(prog.last_page, total()); toast(t('read.resumed', { n: fmtNum(page) }), 'info', 3000); }
  q('[data-total]').textContent = `/ ${fmtNum(total())}`;
  q('[data-rload]').remove(); canvas.hidden = false;

  async function draw() {
    if (rendering) { pending = true; return; }
    rendering = true;
    try {
      do {
        pending = false; const n = page;
        let pg;
        try { pg = await doc.getPage(n); }
        catch (err) { if (!retried) { retried = true; await openDoc(); pg = await doc.getPage(n); } else throw err; }   // signed URL may have expired mid-session
        const base = pg.getViewport({ scale: 1 });
        const pad = 24, w = Math.max(200, stage.clientWidth - pad * 2), h = Math.max(200, stage.clientHeight - pad * 2);
        const fitScale = fit === 'width' ? w / base.width : Math.min(w / base.width, h / base.height);
        const scale = fitScale * zoom;
        let dpr = Math.min(window.devicePixelRatio || 1, 2);
        const css = pg.getViewport({ scale });
        while (css.width * css.height * dpr * dpr > MAX_PIXELS && dpr > 0.5) dpr -= 0.25;
        const vp = pg.getViewport({ scale: scale * dpr });
        canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
        canvas.style.width = `${Math.floor(css.width)}px`; canvas.style.height = `${Math.floor(css.height)}px`;
        task = pg.render({ canvasContext: ctx2d, viewport: vp, canvas }); await task.promise.catch((e) => { if (e?.name !== 'RenderingCancelledException') throw e; });
        pg.cleanup();
        if (n < total()) doc.getPage(n + 1).catch(() => {});      // warm the next page (range request)
      } while (pending && !dead);
    } catch (e) { if (!dead) toast(friendlyError(e), 'error'); }
    finally { rendering = false; }
    ui();
  }
  function ui() {
    if (document.activeElement !== q('[data-goto]')) q('[data-goto]').value = String(page);   // never overwrite what the reader is typing
    q('[data-prev]').disabled = page <= 1; q('[data-next]').disabled = page >= total();
    q('[data-zreset]').textContent = `${Math.round(zoom * 100)}%`;
    const pc = Math.round((page / total()) * 100); const bar = q('[data-pbar]'); bar.setAttribute('aria-valuenow', pc); bar.firstElementChild.style.inlineSize = `${pc}%`;
    q('[data-status]').textContent = t('read.status', { p: fmtNum(page), n: fmtNum(total()), pc: fmtNum(pc) });
  }
  const flush = async () => { clearTimeout(saveTimer); if (page === savedPage || dead) return; const p = page; savedPage = p; try { await api.progress.save(r.id, p, total()); } catch { savedPage = 0; } };
  const schedule = () => { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 1500); };
  const goto = (n) => { n = Math.max(1, Math.min(total(), Math.round(+n) || page)); if (n !== page) { page = n; stage.scrollTop = 0; schedule(); } ui(); draw(); };
  const setZoom = (z) => { zoom = Math.max(0.5, Math.min(3, z)); ui(); draw(); };

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.matches('[data-prev]')) goto(page - 1); else if (b.matches('[data-next]')) goto(page + 1);
    else if (b.matches('[data-zin]')) setZoom(ZOOMS.find((z) => z > zoom + 0.01) ?? 3);
    else if (b.matches('[data-zout]')) setZoom([...ZOOMS].reverse().find((z) => z < zoom - 0.01) ?? 0.5);
    else if (b.matches('[data-zreset]')) setZoom(1);
    else if (b.matches('[data-fit]')) { fit = fit === 'width' ? 'page' : 'width'; zoom = 1; toast(t(fit === 'width' ? 'read.fitWidth' : 'read.fitPage'), 'info', 1500); ui(); draw(); }
    else if (b.matches('[data-fs]')) toggleFs();
    else if (b.matches('[data-dl]')) { try { const a = document.createElement('a'); a.href = await api.fileUrl(r, { download: true }); a.download = r.original_filename || ''; document.body.append(a); a.click(); a.remove(); api.track(r.id, 'download'); } catch (err) { toast(friendlyError(err), 'error'); } }
  });
  const gotoInput = q('[data-goto]');
  gotoInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { goto(gotoInput.value); stage.focus(); } e.stopPropagation(); });
  gotoInput.addEventListener('focus', () => gotoInput.select()); gotoInput.addEventListener('blur', () => { gotoInput.value = String(page); });

  const rtl = () => getLang() === 'ar';
  const onKey = (e) => {
    if (e.target.matches?.('input,textarea,select') || e.ctrlKey || e.metaKey || e.altKey) return;
    const next = rtl() ? 'ArrowLeft' : 'ArrowRight', prev = rtl() ? 'ArrowRight' : 'ArrowLeft';
    if (e.key === next || e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)) { e.preventDefault(); goto(page + 1); }
    else if (e.key === prev || e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) { e.preventDefault(); goto(page - 1); }
    else if (e.key === 'Home') { e.preventDefault(); goto(1); } else if (e.key === 'End') { e.preventDefault(); goto(total()); }
    else if (e.key === '+' || e.key === '=') setZoom(ZOOMS.find((z) => z > zoom + 0.01) ?? 3);
    else if (e.key === '-') setZoom([...ZOOMS].reverse().find((z) => z < zoom - 0.01) ?? 0.5);
    else if (e.key === 'f' || e.key === 'F') toggleFs();
  };
  function toggleFs() {
    const on = !root.classList.contains('is-fs'); root.classList.toggle('is-fs', on); document.body.classList.toggle('reader-fs', on);
    if (on) root.requestFullscreen?.().catch(() => {}); else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    q('[data-fs]').innerHTML = icon(on ? 'minimize' : 'maximize', 20); setTimeout(draw, 120);
  }
  const onFsChange = () => { if (!document.fullscreenElement && root.classList.contains('is-fs')) { root.classList.remove('is-fs'); document.body.classList.remove('reader-fs'); q('[data-fs]').innerHTML = icon('maximize', 20); draw(); } };
  const onResize = (() => { let h; return () => { clearTimeout(h); h = setTimeout(draw, 150); }; })();
  const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
  addEventListener('keydown', onKey); addEventListener('resize', onResize); addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', onHide); document.addEventListener('fullscreenchange', onFsChange);

  ui(); draw(); stage.focus({ preventScroll: true });
  return () => {
    dead = true; clearTimeout(saveTimer);
    removeEventListener('keydown', onKey); removeEventListener('resize', onResize); removeEventListener('pagehide', flush);
    document.removeEventListener('visibilitychange', onHide); document.removeEventListener('fullscreenchange', onFsChange);
    document.body.classList.remove('reader-fs'); if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    try { task?.cancel(); } catch { /* ignore */ } try { handle?.destroy(); } catch { /* ignore */ }
    if (page !== savedPage) api.progress.save(r.id, page, total()).catch(() => {});
  };
}
