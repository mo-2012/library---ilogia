import * as tus from 'tus-js-client';
import { sb } from './supabase.js';
import { SUPABASE_URL, BUCKET, MAX_FILE_BYTES, MAX_COVER_BYTES } from '../config.js';

// Allow-list (never a block-list): extension → file type, accepted MIME types, and a magic-number check on the first bytes.
const startsWith = (b, ...sig) => sig.every((v, i) => v === null || b[i] === v);
const SIG = {
  pdf: (b) => startsWith(b, 0x25, 0x50, 0x44, 0x46, 0x2d),
  zip: (b) => startsWith(b, 0x50, 0x4b, 0x03, 0x04),
  ole: (b) => startsWith(b, 0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1),
  png: (b) => startsWith(b, 0x89, 0x50, 0x4e, 0x47),
  jpg: (b) => startsWith(b, 0xff, 0xd8, 0xff),
  webp: (b) => startsWith(b, 0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50),
  mp4: (b) => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70,
  webm: (b) => startsWith(b, 0x1a, 0x45, 0xdf, 0xa3),
  mp3: (b) => (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0),
  text: (b) => !b.includes(0),                     // plain text must not contain NUL bytes
};
const OFFICE = 'application/vnd.openxmlformats-officedocument.';
export const ALLOWED = {
  pdf:  { type: 'pdf',   mime: ['application/pdf'], sig: 'pdf' },
  doc:  { type: 'doc',   mime: ['application/msword'], sig: 'ole' },
  docx: { type: 'doc',   mime: [OFFICE + 'wordprocessingml.document'], sig: 'zip' },
  ppt:  { type: 'ppt',   mime: ['application/vnd.ms-powerpoint'], sig: 'ole' },
  pptx: { type: 'ppt',   mime: [OFFICE + 'presentationml.presentation'], sig: 'zip' },
  xls:  { type: 'xls',   mime: ['application/vnd.ms-excel'], sig: 'ole' },
  xlsx: { type: 'xls',   mime: [OFFICE + 'spreadsheetml.sheet'], sig: 'zip' },
  epub: { type: 'epub',  mime: ['application/epub+zip'], sig: 'zip' },
  txt:  { type: 'text',  mime: ['text/plain'], sig: 'text' },
  mp4:  { type: 'video', mime: ['video/mp4'], sig: 'mp4' },
  webm: { type: 'video', mime: ['video/webm'], sig: 'webm' },
  mp3:  { type: 'audio', mime: ['audio/mpeg'], sig: 'mp3' },
  m4a:  { type: 'audio', mime: ['audio/mp4'], sig: 'mp4' },
  png:  { type: 'image', mime: ['image/png'], sig: 'png' },
  jpg:  { type: 'image', mime: ['image/jpeg'], sig: 'jpg' },
  jpeg: { type: 'image', mime: ['image/jpeg'], sig: 'jpg' },
  webp: { type: 'image', mime: ['image/webp'], sig: 'webp' },
};
export const COVER_EXT = ['png', 'jpg', 'jpeg', 'webp'];
export const ACCEPT = Object.keys(ALLOWED).map((e) => '.' + e).join(',');
export const ACCEPT_COVER = COVER_EXT.map((e) => '.' + e).join(',');

export const extOf = (name) => { const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(name || '').trim()); return m ? m[1].toLowerCase() : ''; };
/** Display-safe file name: no path parts, no control or bidi-override characters, bounded length. */
export const safeFileName = (name) => String(name || 'file').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, '').replace(/^\.+/, '').trim().slice(0, 200) || 'file';

/** Returns { ok:true, ext, fileType, mime } or { ok:false, error:<i18n key>, vars }. */
export async function validateFile(file, { cover = false } = {}) {
  if (!file) return { ok: false, error: 'val.required' };
  const ext = extOf(file.name), rule = ALLOWED[ext];
  if (!rule || (cover && !COVER_EXT.includes(ext))) return { ok: false, error: cover ? 'val.coverType' : 'val.type' };
  const limit = cover ? MAX_COVER_BYTES : MAX_FILE_BYTES;
  if (file.size === 0) return { ok: false, error: 'val.empty' };
  if (file.size > limit) return { ok: false, error: cover ? 'val.coverSize' : 'val.size', vars: { max: Math.round(limit / 1048576) } };
  if (file.type && !rule.mime.includes(file.type) && !(ext === 'txt' && file.type.startsWith('text/'))) return { ok: false, error: 'val.mime' };
  const head = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  if (!SIG[rule.sig](head)) return { ok: false, error: 'val.content' };
  return { ok: true, ext, fileType: rule.type, mime: rule.mime[0] };
}

/** Resumable (TUS) upload with progress; survives dropped connections and resumes where it stopped. Returns { abort() , promise }. */
export function uploadFile({ path, file, mime, onProgress, onStatus }) {
  let upload, aborted = false;
  const promise = (async () => {
    const getToken = async () => { const { data } = await sb.auth.getSession(); if (!data.session) throw new Error('not_authenticated'); return data.session.access_token; };
    await getToken();
    await new Promise((resolve, reject) => {
      upload = new tus.Upload(file, {
        endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
        retryDelays: [0, 1500, 4000, 8000, 15000, 30000, 60000],
        headers: { 'x-upsert': 'false' },
        onBeforeRequest: async (req) => { req.setHeader('Authorization', `Bearer ${await getToken()}`); },   // fresh token on every chunk
        uploadDataDuringCreation: true, removeFingerprintOnSuccess: true, chunkSize: 6 * 1024 * 1024,
        metadata: { bucketName: BUCKET, objectName: path, contentType: mime, cacheControl: '3600' },
        onShouldRetry: (err, retryAttempt) => { const s = err?.originalResponse?.getStatus?.(); onStatus?.('retrying', retryAttempt + 1); return !(s && s >= 400 && s < 500 && s !== 409 && s !== 429 && s !== 408); },
        onError: (e) => reject(e),
        onProgress: (sent, total) => { onStatus?.('uploading'); onProgress?.(sent / total); },
        onSuccess: () => resolve(),
      });
      upload.start();
    });
  })();
  const onOffline = () => onStatus?.('offline'); const onOnline = () => onStatus?.('uploading');
  addEventListener('offline', onOffline); addEventListener('online', onOnline);
  promise.finally(() => { removeEventListener('offline', onOffline); removeEventListener('online', onOnline); }).catch(() => {});
  return { promise, abort: () => { aborted = true; upload?.abort(true); }, get aborted() { return aborted; } };
}

/** PDF page count in the browser (used to enable reading progress %). Returns null on any failure. */
export async function pdfPageCount(file) {
  try {
    const { openPdf } = await import('./pdf.js'); const h = await openPdf({ data: new Uint8Array(await file.arrayBuffer()) }); const n = h.doc.numPages; await h.destroy(); return n;
  } catch (e) { console.warn('[upload] page count unavailable', e); return null; }
}
