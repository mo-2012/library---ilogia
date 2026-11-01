import * as api from '../lib/api.js';
import { html, raw, mount, $, $$, toast, confirmBox, emptyState, errorState, friendlyError, statusBadge, cover, safeHttps } from '../lib/ui.js';
import { icon } from '../lib/icons.js';
import { t, catName, fmtSize, fmtDate, fmtNum } from '../lib/i18n.js';
import { validateFile, uploadFile, pdfPageCount, safeFileName, ACCEPT, ACCEPT_COVER } from '../lib/upload.js';
import { BUCKET, MAX_FILE_BYTES } from '../config.js';
import { resHref } from '../lib/cards.js';

export default async function uploadPage({ el, user, state, alive }) {
  if (!user.canUpload) return mount(el, html`<div class="page">${emptyState({ icon: 'lock', title: t('up.noAccess'), text: t('up.noAccessText'), action: `<a class="btn" href="#/">${t('nav.home')}</a>` })}</div>`);

  const f = { source: 'upload', title: '', description: '', author: '', category_id: '', subject_id: '', grade_id: '', allow_download: false, rights: false, external_url: '', publish: false };
  let file = null, fileInfo = null, coverFile = null, coverInfo = null, coverPreview = null, errors = {}, step = 'form', job = null, uploadState = { pct: 0, status: 'uploading', retry: 0 };
  const mineBox = () => $('[data-mine]', el);

  const field = (name, label, control, hint) => html`<label class="field ${errors[name] ? 'has-error' : ''}"><span>${label}</span>${control}${hint ? html`<small>${hint}</small>` : ''}${errors[name] ? html`<em class="err" role="alert">${t(errors[name].key, errors[name].vars)}</em>` : ''}</label>`;
  const opts = (items, cur, label) => items.map((i) => html`<option value="${i.id}" ${String(cur) === String(i.id) ? raw('selected') : ''}>${label(i)}</option>`);

  const formView = () => mount($('[data-step]', el), html`<form class="form" data-form novalidate>
    <fieldset class="seg-field"><legend>${t('up.source')}</legend><div class="seg"><button type="button" data-source="upload" class="${f.source === 'upload' ? 'on' : ''}" aria-pressed="${f.source === 'upload'}">${raw(icon('upload', 16))}${t('up.srcFile')}</button>
      <button type="button" data-source="external" class="${f.source === 'external' ? 'on' : ''}" aria-pressed="${f.source === 'external'}">${raw(icon('link', 16))}${t('up.srcLink')}</button></div></fieldset>
    ${f.source === 'upload' ? html`<div class="drop ${errors.file ? 'has-error' : ''}" data-drop tabindex="0" role="button" aria-label="${t('up.chooseFile')}">${raw(icon('upload', 28))}
        ${file ? html`<p><b>${safeFileName(file.name)}</b><br><small>${fmtSize(file.size)} · ${t('type.' + fileInfo.fileType)}</small></p>` : html`<p><b>${t('up.drop')}</b><br><small>${t('up.dropHint', { max: Math.round(MAX_FILE_BYTES / 1048576) })}</small></p>`}
        <input type="file" data-file accept="${ACCEPT}" hidden></div>${errors.file ? html`<em class="err" role="alert">${t(errors.file.key, errors.file.vars)}</em>` : ''}`
      : field('external_url', t('up.url'), html`<input name="external_url" type="url" inputmode="url" dir="ltr" placeholder="https://" value="${f.external_url}" maxlength="2000">`, t('up.urlHint'))}
    <div class="two">${field('title', t('up.title'), html`<input name="title" value="${f.title}" maxlength="200" required>`)}${field('author', t('up.author'), html`<input name="author" value="${f.author}" maxlength="200">`)}</div>
    ${field('description', t('up.desc'), html`<textarea name="description" rows="4" maxlength="4000">${f.description}</textarea>`)}
    <div class="three">${field('category_id', t('f.category'), html`<select name="category_id" required><option value="">${t('up.choose')}</option>${opts(state.cats, f.category_id, catName)}</select>`)}
      ${field('subject_id', t('f.subject'), html`<select name="subject_id"><option value="">${t('up.none')}</option>${opts(state.subjects, f.subject_id, (s) => s.name)}</select>`)}
      ${field('grade_id', t('f.grade'), html`<select name="grade_id"><option value="">${t('up.none')}</option>${opts(state.grades, f.grade_id, (g) => g.name)}</select>`)}</div>
    <div class="cover-pick"><div class="cover-prev">${coverPreview ? html`<img src="${coverPreview}" alt="">` : html`<span>${raw(icon('image', 22))}</span>`}</div>
      <div><b>${t('up.cover')}</b><p class="meta">${t('up.coverHint')}</p><button type="button" class="btn sm" data-pick-cover>${coverFile ? t('up.coverChange') : t('up.coverChoose')}</button>${coverFile ? html` <button type="button" class="btn sm ghost" data-clear-cover>${t('common.remove')}</button>` : ''}
        <input type="file" data-cover accept="${ACCEPT_COVER}" hidden>${errors.cover ? html`<em class="err" role="alert">${t(errors.cover.key, errors.cover.vars)}</em>` : ''}</div></div>
    <label class="check"><input type="checkbox" name="allow_download" ${f.allow_download ? raw('checked') : ''}><span><b>${t('up.allowDl')}</b><small>${t('up.allowDlHint')}</small></span></label>
    ${user.isAdmin ? html`<label class="check"><input type="checkbox" name="publish" ${f.publish ? raw('checked') : ''}><span><b>${t('up.publishNow')}</b><small>${t('up.publishNowHint')}</small></span></label>` : ''}
    <label class="check ${errors.rights ? 'has-error' : ''}"><input type="checkbox" name="rights" ${f.rights ? raw('checked') : ''}><span><b>${t('up.rights')}</b>${errors.rights ? html`<em class="err" role="alert">${t(errors.rights.key)}</em>` : ''}</span></label>
    <div class="form-actions"><button class="btn primary lg" type="submit">${t('up.review')}${raw(icon('chev-l', 18, 'flip'))}</button></div></form>`);

  const reviewView = () => {
    const cat = state.cats.find((c) => String(c.id) === String(f.category_id)), sub = state.subjects.find((s) => String(s.id) === String(f.subject_id)), gr = state.grades.find((g) => String(g.id) === String(f.grade_id));
    const fake = { title: f.title, category: cat, subject: sub, author: f.author, file_type: f.source === 'upload' ? fileInfo.fileType : 'link' };
    const rows = [[t('f.category'), catName(cat)], [t('f.subject'), sub?.name], [t('f.grade'), gr?.name], [t('res.author'), f.author], [t('f.type'), t('type.' + fake.file_type)],
      [t('up.file'), file ? `${safeFileName(file.name)} · ${fmtSize(file.size)}` : null], [t('up.url'), f.source === 'external' ? f.external_url : null],
      [t('res.download'), f.allow_download ? t('common.yes') : t('common.no')], [t('up.after'), user.isAdmin && f.publish ? t('up.afterPublish') : t('up.afterReview')]].filter(([, v]) => v);
    mount($('[data-step]', el), html`<div class="review"><div class="review-cover">${cover(fake, coverPreview)}</div><div><h2>${t('up.reviewTitle')}</h2><h3>${f.title}</h3>${f.description ? html`<p>${f.description}</p>` : ''}
      <dl class="facts">${rows.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>
      <div class="form-actions"><button class="btn lg" data-edit>${raw(icon('arrow-r', 18, 'flip'))}${t('up.edit')}</button><button class="btn primary lg" data-submit>${raw(icon('upload', 18))}${user.isAdmin && f.publish ? t('up.publish') : t('up.submit')}</button></div></div></div>`);
  };
  const uploadingView = () => {
    const s = uploadState; const label = s.status === 'offline' ? t('up.offline') : s.status === 'retrying' ? t('up.retrying', { n: s.retry }) : t('up.uploading');
    mount($('[data-step]', el), html`<div class="uploading" role="status" aria-live="polite">${raw(icon(s.status === 'offline' ? 'offline' : 'upload', 30))}<h2>${label}</h2>
      <div class="bar bar--lg" role="progressbar" aria-valuenow="${Math.round(s.pct * 100)}" aria-valuemin="0" aria-valuemax="100"><i style="inline-size:${Math.round(s.pct * 100)}%"></i></div><p class="meta">${fmtNum(Math.round(s.pct * 100))}%</p>
      <button class="btn" data-cancel>${t('common.cancel')}</button></div>`);
  };
  const doneView = (status) => mount($('[data-step]', el), html`<div class="state state--ok">${raw(icon('ok', 40))}<h2>${status === 'published' ? t('up.donePublished') : t('up.donePending')}</h2><p>${status === 'published' ? t('up.donePublishedText') : t('up.donePendingText')}</p>
    <div class="form-actions center"><button class="btn primary" data-again>${raw(icon('plus', 18))}${t('up.another')}</button></div></div>`);

  function collect(form) {
    const fd = new FormData(form);
    for (const k of ['title', 'description', 'author', 'category_id', 'subject_id', 'grade_id', 'external_url']) if (fd.has(k)) f[k] = String(fd.get(k)).trim();
    f.allow_download = fd.has('allow_download'); f.rights = fd.has('rights'); f.publish = fd.has('publish');
  }
  function validate() {
    errors = {};
    if (f.title.length < 3) errors.title = { key: 'val.title' };
    if (!f.category_id) errors.category_id = { key: 'val.category' };
    if (f.source === 'upload') { if (!file) errors.file = { key: 'val.required' }; else if (fileInfo && !fileInfo.ok) errors.file = { key: fileInfo.error, vars: fileInfo.vars }; }
    else if (!safeHttps(f.external_url)) errors.external_url = { key: 'val.url' };
    if (coverFile && coverInfo && !coverInfo.ok) errors.cover = { key: coverInfo.error, vars: coverInfo.vars };
    if (!f.rights) errors.rights = { key: 'val.rights' };
    return !Object.keys(errors).length;
  }
  async function takeFile(fl) {
    if (!fl) return; fileInfo = await validateFile(fl); file = fl; errors.file = fileInfo.ok ? undefined : { key: fileInfo.error, vars: fileInfo.vars };
    if (!fileInfo.ok) { file = null; } else if (!f.title) f.title = safeFileName(fl.name).replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 200);
    formView();
  }
  async function submit() {
    const id = crypto.randomUUID(); const base = `u/${user.id}/${id}`; const uploaded = [];
    step = 'uploading'; uploadState = { pct: 0, status: 'uploading', retry: 0 }; uploadingView();
    try {
      const row = { id, title: f.title, description: f.description || null, author: f.author || null, category_id: +f.category_id, subject_id: f.subject_id ? +f.subject_id : null, grade_id: f.grade_id ? +f.grade_id : null,
        allow_download: f.allow_download, status: user.isAdmin && f.publish ? 'published' : 'pending' };
      if (f.source === 'upload') {
        const pages = fileInfo.fileType === 'pdf' ? await pdfPageCount(file) : null;
        const path = `${base}/file.${fileInfo.ext}`;
        job = uploadFile({ path, file, mime: fileInfo.mime, onProgress: (p) => { uploadState.pct = p * (coverFile ? 0.95 : 1); uploadingView(); }, onStatus: (s, n) => { if (uploadState.status !== s || n) { uploadState.status = s; uploadState.retry = n || 0; uploadingView(); } } });
        await job.promise; uploaded.push(path);
        Object.assign(row, { source: 'upload', file_type: fileInfo.fileType, storage_bucket: BUCKET, storage_path: path, original_filename: safeFileName(file.name), mime_type: fileInfo.mime, file_size: file.size, page_count: pages });
      } else Object.assign(row, { source: 'external', file_type: 'link', external_url: safeHttps(f.external_url) });
      if (coverFile && coverInfo?.ok) {
        const cpath = `${base}/cover.${coverInfo.ext}`; job = uploadFile({ path: cpath, file: coverFile, mime: coverInfo.mime }); await job.promise; uploaded.push(cpath); row.cover_path = cpath;
      }
      uploadState.pct = 1; uploadingView();
      const res = await api.uploads.create(row);
      await refreshMine(); step = 'done'; doneView(res.status);
    } catch (e) {
      if (uploaded.length) api.uploads.removeFiles(uploaded).catch(() => {});      // never leave orphan files behind
      if (job?.aborted) { toast(t('up.cancelled'), 'info'); } else { toast(friendlyError(e), 'error', 7000); }
      step = 'review'; reviewView();
    } finally { job = null; }
  }

  async function refreshMine() {
    const box = mineBox(); if (!box) return;
    try {
      const rows = await api.uploads.mine(user.id); if (!alive()) return;
      mount(box, rows.length ? html`<ul class="mine">${rows.map((r) => html`<li><div class="grow"><a href="${resHref(r)}"><b>${r.title}</b></a><small>${t('type.' + r.file_type)} · ${r.file_size ? fmtSize(r.file_size) + ' · ' : ''}${fmtDate(r.created_at)}</small>
          ${r.status === 'rejected' && r.reject_reason ? html`<em class="err">${t('up.rejectedWhy')}: ${r.reject_reason}</em>` : ''}</div>${statusBadge(r.status)}
          ${r.status !== 'published' ? html`<button class="icon-btn" data-del="${r.id}" aria-label="${t('common.delete')}" title="${t('common.delete')}">${raw(icon('trash', 17))}</button>` : ''}</li>`)}</ul>` : html`<p class="meta">${t('up.mineEmpty')}</p>`);
      box._rows = rows;
    } catch (e) { mount(box, errorState(e)); $('[data-retry]', box)?.addEventListener('click', refreshMine); }
  }

  mount(el, html`<div class="page"><header class="page-head"><h1>${t('up.title.page')}</h1><p>${t('up.lead')}</p></header>
    <div class="up-grid"><section class="card-pane" data-step></section><aside class="card-pane"><h2>${t('up.mine')}</h2><div data-mine><div class="loading"><span class="spinner"></span></div></div></aside></div></div>`);
  formView(); refreshMine();

  el.addEventListener('click', async (e) => {
    const src = e.target.closest('[data-source]'); if (src) { collect($('[data-form]', el)); f.source = src.dataset.source; errors = {}; return formView(); }
    if (e.target.closest('[data-drop]')) return $('[data-file]', el).click();
    if (e.target.closest('[data-pick-cover]')) return $('[data-cover]', el).click();
    if (e.target.closest('[data-clear-cover]')) { collect($('[data-form]', el)); coverFile = coverInfo = null; if (coverPreview) URL.revokeObjectURL(coverPreview); coverPreview = null; return formView(); }
    if (e.target.closest('[data-edit]')) { step = 'form'; return formView(); }
    if (e.target.closest('[data-submit]')) return submit();
    if (e.target.closest('[data-cancel]')) return job?.abort();
    if (e.target.closest('[data-again]')) { Object.assign(f, { title: '', description: '', author: '', external_url: '', rights: false, publish: false }); file = fileInfo = coverFile = coverInfo = null; coverPreview = null; errors = {}; step = 'form'; return formView(); }
    const d = e.target.closest('[data-del]');
    if (d && await confirmBox(t('up.delTitle'), t('up.delText'), t('common.delete'), true)) {
      try { const r = mineBox()._rows.find((x) => x.id === d.dataset.del); await api.uploads.remove(r); toast(t('up.deleted'), 'ok'); refreshMine(); } catch (err) { toast(friendlyError(err), 'error'); }
    }
  });
  el.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-drop]')) { e.preventDefault(); $('[data-file]', el).click(); } });
  el.addEventListener('change', async (e) => {
    if (e.target.matches('[data-file]')) { collect($('[data-form]', el)); await takeFile(e.target.files[0]); }
    if (e.target.matches('[data-cover]')) {
      collect($('[data-form]', el)); const c = e.target.files[0]; if (!c) return; coverInfo = await validateFile(c, { cover: true });
      if (coverPreview) URL.revokeObjectURL(coverPreview);
      if (coverInfo.ok) { coverFile = c; coverPreview = URL.createObjectURL(c); errors.cover = undefined; } else { coverFile = null; coverPreview = null; errors.cover = { key: coverInfo.error, vars: coverInfo.vars }; }
      formView();
    }
  });
  el.addEventListener('dragover', (e) => { if (e.target.closest('[data-drop]')) { e.preventDefault(); e.target.closest('[data-drop]').classList.add('over'); } });
  el.addEventListener('dragleave', (e) => e.target.closest?.('[data-drop]')?.classList.remove('over'));
  el.addEventListener('drop', async (e) => { const d = e.target.closest('[data-drop]'); if (!d) return; e.preventDefault(); d.classList.remove('over'); collect($('[data-form]', el)); await takeFile(e.dataTransfer.files[0]); });
  el.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-form]'); if (!form) return; e.preventDefault(); collect(form);
    if (!validate()) { formView(); $('.has-error input,.has-error select,.has-error.drop', el)?.focus(); return; }
    step = 'review'; reviewView();
  });
  const warn = (e) => { if (step === 'uploading') { e.preventDefault(); e.returnValue = ''; } };
  addEventListener('beforeunload', warn);
  return () => { removeEventListener('beforeunload', warn); job?.abort(); if (coverPreview) URL.revokeObjectURL(coverPreview); };
}
