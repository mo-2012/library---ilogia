// Data layer. Every call goes straight to Supabase; permissions are enforced there (RLS + RPC), not here.
import { sb } from './supabase.js';
import { BUCKET, LEGACY_BUCKET, PAGE_SIZE, SIGNED_URL_TTL, COVER_URL_TTL } from '../config.js';

const ok = ({ data, error }) => { if (error) throw error; return data; };
const LIST_COLS = 'id,title,description,author,category_id,subject_id,grade_id,file_type,page_count,file_size,cover_path,status,allow_download,views_count,downloads_count,published_at,created_at,source,category:library_categories(slug,name_ar,name_en,icon),subject:subjects(name,icon),grade:grades(name)';

// ───────── auth ─────────
export const auth = {
  session: async () => (await sb.auth.getSession()).data.session,
  signIn: (email, password) => sb.auth.signInWithPassword({ email, password }).then(ok),
  signUp: (name, email, password) => sb.auth.signUp({ email, password, options: { data: { full_name: name }, emailRedirectTo: location.origin + location.pathname } }).then(ok),
  google: () => sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } }).then(ok),
  reset: (email) => sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }).then(ok),
  setPassword: (password) => sb.auth.updateUser({ password }).then(ok),
  signOut: () => sb.auth.signOut(),
  onChange: (cb) => sb.auth.onAuthStateChange((ev, session) => setTimeout(() => cb(ev, session), 0)),   // never await supabase inside the callback
};

/** Who is this user, as decided by the SERVER (is_admin / library_can_upload are RPCs). */
export async function whoami(session) {
  const u = session.user;
  const [adm, up] = await Promise.all([sb.rpc('is_admin'), sb.rpc('library_can_upload')]);
  return { id: u.id, email: u.email, name: u.user_metadata?.full_name || u.user_metadata?.name || u.email?.split('@')[0] || '',
    isAdmin: adm.data === true, canUpload: up.data === true || adm.data === true };
}

// ───────── catalogue metadata (cached per session) ─────────
const memo = {};
const once = (k, fn) => (memo[k] ??= fn().catch((e) => { delete memo[k]; throw e; }));
export const meta = {
  categories: () => once('cats', () => sb.from('library_categories').select('*').order('sort_order').then(ok)),
  subjects: () => once('subs', () => sb.from('subjects').select('id,name,icon,sort_order').order('sort_order').then(ok)),
  grades: () => once('grades', () => sb.from('grades').select('id,name,stage,sort_order').order('sort_order').then(ok)),
  facets: () => sb.rpc('library_facets').then(ok),
  reset: () => { for (const k in memo) delete memo[k]; },
};

// ───────── resources ─────────
const clean = (s) => String(s).replace(/[%*,()\\_]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);   // keeps PostgREST or() filters intact
export async function listResources({ q = '', category, subject, grade, type, sort = 'new', page = 1, size = PAGE_SIZE } = {}) {
  let query = sb.from('library_resources').select(LIST_COLS, { count: 'exact' }).eq('status', 'published');
  const term = clean(q);
  if (term) query = query.or(`title.ilike.%${term}%,description.ilike.%${term}%,author.ilike.%${term}%`);
  if (category) query = query.eq('category_id', category);
  if (subject) query = query.eq('subject_id', subject);
  if (grade) query = query.eq('grade_id', grade);
  if (type) query = query.eq('file_type', type);
  if (sort === 'name') query = query.order('title', { ascending: true });
  else if (sort === 'views') query = query.order('views_count', { ascending: false }).order('published_at', { ascending: false });
  else query = query.order('published_at', { ascending: false, nullsFirst: false });
  const from = (page - 1) * size;
  const { data, error, count } = await query.range(from, from + size - 1);
  if (error) throw error;
  return { rows: data, count: count ?? 0 };
}
export const latest = (n = 8) => listResources({ size: n }).then((r) => r.rows);
export const mostViewed = (n = 6) => sb.from('library_resources').select(LIST_COLS).eq('status', 'published').gt('views_count', 0)
  .order('views_count', { ascending: false }).limit(n).then(ok);
export const getResource = (id) => sb.from('library_resources').select(LIST_COLS + ',description,original_filename,mime_type,external_url,storage_bucket,storage_path,legacy_item_id,reject_reason,uploaded_by,reviewed_at')
  .eq('id', id).maybeSingle().then(ok);
export const related = (r, n = 5) => (r.subject_id
  ? sb.from('library_resources').select(LIST_COLS).eq('status', 'published').eq('subject_id', r.subject_id).neq('id', r.id).order('views_count', { ascending: false }).limit(n).then(ok)
  : Promise.resolve([]));

// ───────── files (Signed URLs; private bucket) ─────────
const signedCache = new Map();
/** Batch-signs cover images for a list of resources; returns {path → url}. */
export async function coverUrls(rows) {
  const need = [...new Set(rows.map((r) => r.cover_path).filter(Boolean))].filter((p) => !(signedCache.get(p)?.exp > Date.now()));
  if (need.length) {
    const { data } = await sb.storage.from(BUCKET).createSignedUrls(need, COVER_URL_TTL);
    for (const x of data || []) if (x.signedUrl) signedCache.set(x.path, { url: x.signedUrl, exp: Date.now() + (COVER_URL_TTL - 120) * 1000 });
  }
  return Object.fromEntries(rows.filter((r) => r.cover_path && signedCache.get(r.cover_path)).map((r) => [r.cover_path, signedCache.get(r.cover_path).url]));
}
/** Signed URL for the resource file. `download` → forces a save dialog with the original file name. Legacy rows keep the existing paywall RPC. */
export async function fileUrl(r, { download = false, ttl = SIGNED_URL_TTL } = {}) {
  if (r.source === 'external') return r.external_url;
  let bucket = BUCKET, path = r.storage_path;
  if (r.source === 'legacy') {
    path = ok(await sb.rpc('get_library_file', { p_item_id: r.legacy_item_id })); bucket = LEGACY_BUCKET;
    if (/^https?:\/\//.test(path)) return path;
  }
  const opt = download ? { download: r.original_filename || true } : undefined;
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, ttl, opt);
  if (error) throw error; return data.signedUrl;
}
export const track = (id, kind) => sb.rpc('library_track', { p_resource_id: id, p_kind: kind }).then(() => {}, () => {});   // analytics must never break reading

// ───────── bookmarks ─────────
export const bookmarks = {
  ids: async () => new Set((await sb.from('library_bookmarks').select('resource_id').limit(2000).then(ok)).map((x) => x.resource_id)),
  list: (n = 200) => sb.from('library_bookmarks').select('created_at,resource:library_resources(' + LIST_COLS + ')').order('created_at', { ascending: false }).limit(n).then(ok),
  add: (id) => sb.from('library_bookmarks').upsert({ resource_id: id }, { onConflict: 'user_id,resource_id', ignoreDuplicates: true }).then(ok),
  remove: (id) => sb.from('library_bookmarks').delete().eq('resource_id', id).then(ok),
};

// ───────── reading progress ─────────
export const progress = {
  get: (id) => sb.from('library_reading_progress').select('last_page,page_count,percent,updated_at').eq('resource_id', id).maybeSingle().then(ok),
  save: (id, page, count) => sb.from('library_reading_progress').upsert(
    { resource_id: id, last_page: page, page_count: count, percent: Math.min(100, Math.round((page / Math.max(1, count)) * 100)) }, { onConflict: 'user_id,resource_id' }).then(ok),
  list: (n = 30) => sb.from('library_reading_progress').select('last_page,page_count,percent,updated_at,resource:library_resources(' + LIST_COLS + ')').order('updated_at', { ascending: false }).limit(n).then(ok),
};

// ───────── collections ─────────
export const collections = {
  list: () => sb.from('library_collections').select('id,name,description,created_at,items:library_collection_items(count)').order('created_at', { ascending: false }).then(ok),
  create: (name, description) => sb.from('library_collections').insert({ name: name.trim(), description: description?.trim() || null }).select('id').single().then(ok),
  update: (id, patch) => sb.from('library_collections').update(patch).eq('id', id).then(ok),
  remove: (id) => sb.from('library_collections').delete().eq('id', id).then(ok),
  items: (id) => sb.from('library_collection_items').select('added_at,resource:library_resources(' + LIST_COLS + ')').eq('collection_id', id).order('added_at', { ascending: false }).then(ok),
  add: (cid, rid) => sb.from('library_collection_items').upsert({ collection_id: cid, resource_id: rid }, { onConflict: 'collection_id,resource_id', ignoreDuplicates: true }).then(ok),
  removeItem: (cid, rid) => sb.from('library_collection_items').delete().eq('collection_id', cid).eq('resource_id', rid).then(ok),
  containing: (rid) => sb.from('library_collection_items').select('collection_id').eq('resource_id', rid).then(ok).then((x) => new Set(x.map((i) => i.collection_id))),
};

export const history = (n = 80) => sb.from('library_events').select('id,kind,created_at,resource:library_resources(' + LIST_COLS + ')').order('created_at', { ascending: false }).limit(n).then(ok);
export const report = (resource_id, reason, details) => sb.from('library_reports').insert({ resource_id, reason, details: details?.trim() || null }).then(ok);

// ───────── uploads (uploader's own rows) ─────────
export const uploads = {
  mine: (uid) => sb.from('library_resources').select(LIST_COLS + ',reject_reason').eq('uploaded_by', uid).order('created_at', { ascending: false }).then(ok),
  create: (row) => sb.from('library_resources').insert(row).select('id,status').single().then(ok),
  remove: async (r) => {
    ok(await sb.from('library_resources').delete().eq('id', r.id));
    const paths = [r.storage_path, r.cover_path].filter(Boolean);
    if (paths.length && r.source === 'upload') await sb.storage.from(BUCKET).remove(paths);   // best effort; policy forbids touching published files
  },
  removeFiles: (paths) => sb.storage.from(BUCKET).remove(paths.filter(Boolean)),
};

// ───────── admin ─────────
export const admin = {
  stats: () => sb.rpc('library_admin_stats').then(ok),
  list: ({ status, q = '', page = 1, size = 20 } = {}) => {
    let query = sb.from('library_resources').select(LIST_COLS + ',reject_reason,uploaded_by,storage_path,source', { count: 'exact' });
    if (status) query = query.eq('status', status);
    const term = clean(q); if (term) query = query.or(`title.ilike.%${term}%,author.ilike.%${term}%`);
    return query.order('created_at', { ascending: false }).range((page - 1) * size, page * size - 1).then(({ data, error, count }) => { if (error) throw error; return { rows: data, count: count ?? 0 }; });
  },
  review: (id, action, reason) => sb.rpc('library_review_resource', { p_id: id, p_action: action, p_reason: reason ?? null }).then(ok),
  update: (id, patch) => sb.from('library_resources').update(patch).eq('id', id).then(ok),
  remove: async (r) => {
    ok(await sb.from('library_resources').delete().eq('id', r.id));
    const paths = [r.storage_path, r.cover_path].filter(Boolean);
    if (paths.length && r.source === 'upload') await sb.storage.from(BUCKET).remove(paths);
  },
  saveCategory: (c) => (c.id ? sb.from('library_categories').update({ slug: c.slug, name_ar: c.name_ar, name_en: c.name_en, icon: c.icon, sort_order: c.sort_order, is_active: c.is_active }).eq('id', c.id).then(ok)
    : sb.from('library_categories').insert({ slug: c.slug, name_ar: c.name_ar, name_en: c.name_en, icon: c.icon || null, sort_order: c.sort_order ?? 0, is_active: c.is_active ?? true }).then(ok)),
  allCategories: () => sb.from('library_categories').select('*').order('sort_order').then(ok),
  reports: (status = 'open') => sb.from('library_reports').select('id,reason,details,status,created_at,resolution_note,resource:library_resources(id,title,status)').eq('status', status).order('created_at', { ascending: false }).limit(200).then(ok),
  resolveReport: (id, status, note, uid) => sb.from('library_reports').update({ status, resolution_note: note || null, resolved_by: uid, resolved_at: new Date().toISOString() }).eq('id', id).then(ok),
};
