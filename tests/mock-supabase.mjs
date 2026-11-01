// A tiny in-memory stand-in for Supabase (Auth, PostgREST, Storage, TUS) used ONLY by the browser tests.
// Everything here is test fixture data; none of it ships in dist/.
import fs from 'node:fs'; import path from 'node:path';
const HOST = 'zugwicbbfbefbbwugfxq.supabase.co';
const fx = (f) => fs.readFileSync(path.join(import.meta.dirname, 'fixtures', f));
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
export const USERS = { student: { id: '00000000-0000-0000-0000-0000000000c1', email: 'student@test.local', name: 'منى أحمد' },
  teacher: { id: '00000000-0000-0000-0000-0000000000b1', email: 'teacher@test.local', name: 'Teacher One' }, admin: { id: '00000000-0000-0000-0000-0000000000a1', email: 'admin@test.local', name: 'Admin One' } };
const uid = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export function makeDb() {
  const cats = [['books', 'الكتب', 'Books', 'book-open'], ['notes', 'المذكرات', 'Study notes', 'notebook'], ['summaries', 'الملخصات', 'Summaries', 'layers'], ['worksheets', 'أوراق العمل', 'Worksheets', 'clipboard'], ['references', 'المراجع', 'References', 'library'], ['extras', 'المصادر الإضافية', 'Extra resources', 'sparkles']]
    .map(([slug, name_ar, name_en, icon], i) => ({ id: i + 1, slug, name_ar, name_en, icon, sort_order: (i + 1) * 10, is_active: true }));
  const base = (n, o) => ({ id: uid(n), title: 'Resource ' + n, description: null, author: null, category_id: 1, subject_id: 1, grade_id: 1, source: 'upload', file_type: 'pdf', storage_bucket: 'library-resources', storage_path: `u/${USERS.teacher.id}/${uid(n)}/file.pdf`,
    original_filename: 'file.pdf', mime_type: 'application/pdf', file_size: 28984, page_count: 12, external_url: null, cover_path: null, allow_download: false, status: 'published', uploaded_by: USERS.teacher.id,
    views_count: 0, downloads_count: 0, published_at: new Date(Date.now() - n * 3600e3).toISOString(), created_at: new Date(Date.now() - n * 3600e3).toISOString(), reject_reason: null, ...o });
  const resources = [
    base(1, { title: 'الجبر والهندسة — ملخص الوحدة الأولى', description: 'ملخص شامل لقوانين الجبر مع أمثلة محلولة.\nيصلح للمراجعة قبل الامتحان.', author: 'أ. سامي', views_count: 42, downloads_count: 3, allow_download: true, cover_path: `u/${USERS.teacher.id}/${uid(1)}/cover.png` }),
    base(2, { title: 'قواعد النحو المبسّط', category_id: 2, subject_id: 2, grade_id: 2, views_count: 7 }),
    base(3, { title: '<img src=x onerror="window.__xss=1"> عنوان خبيث', description: '<script>window.__xss=1</script>', category_id: 3 }),
    base(4, { title: 'فيديو شرح المعادلات', file_type: 'video', mime_type: 'video/mp4', storage_path: `u/${USERS.teacher.id}/${uid(4)}/file.mp4`, page_count: null, category_id: 5 }),
    base(5, { title: 'Pending upload', status: 'pending', published_at: null }),
    base(6, { title: 'Rejected upload', status: 'rejected', reject_reason: 'الصورة غير واضحة', published_at: null }),
    ...Array.from({ length: 26 }, (_, i) => base(10 + i, { title: `Filler resource ${i + 1}`, category_id: 1 })),
  ];
  return { cats, subjects: [{ id: 1, name: 'الرياضيات', icon: null, sort_order: 1 }, { id: 2, name: 'اللغة العربية', icon: null, sort_order: 2 }], grades: [{ id: 1, name: 'الصف الأول', stage: 'x', sort_order: 1 }, { id: 2, name: 'الصف الثاني', stage: 'x', sort_order: 2 }],
    resources, bookmarks: [], progress: [], collections: [], items: [], events: [], reports: [], calls: [], uploads: [] };
}

export async function installMock(context, db, who) {
  const me = USERS[who];
  const isAdmin = who === 'admin', canUpload = who === 'admin' || who === 'teacher';
  const embed = (r) => ({ ...r, category: db.cats.find((c) => c.id === r.category_id) || null, subject: db.subjects.find((s) => s.id === r.subject_id) || null, grade: db.grades.find((g) => g.id === r.grade_id) || null });
  const visible = (r) => r.status === 'published' || r.uploaded_by === me.id || isAdmin;
  const match = (row, [col, expr]) => {
    const i = expr.indexOf('.'), op = expr.slice(0, i), val = expr.slice(i + 1), v = row[col];
    if (op === 'eq') return String(v) === val; if (op === 'neq') return String(v) !== val; if (op === 'gt') return Number(v) > Number(val); if (op === 'in') return val.replace(/[()]/g, '').split(',').includes(String(v));
    return true;
  };
  const orMatch = (row, expr) => expr.replace(/^\(|\)$/g, '').split(',').some((p) => { const [col, op, ...rest] = p.split('.'); const pat = rest.join('.').replace(/%/g, '').toLowerCase(); return String(row[col] ?? '').toLowerCase().includes(pat); });
  const reserved = new Set(['select', 'order', 'limit', 'offset', 'or', 'on_conflict', 'columns']);

  await context.route(`https://${HOST}/**`, async (route) => {
    const req = route.request(); const url = new URL(req.url()); const p = url.pathname; const method = req.method();
    const reply = (status, body, headers = {}) => route.fulfill({ status, headers: { ...CORS, ...headers }, body: body == null ? '' : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body), contentType: headers['content-type'] || (typeof body === 'object' && !Buffer.isBuffer(body) ? 'application/json' : undefined) });
    if (method === 'OPTIONS') return reply(204, '');
    let body = null; try { body = req.postDataJSON(); } catch { /* binary or empty */ }
    db.calls.push(`${method} ${p}${url.search.slice(0, 80)}`);

    // ── auth
    if (p === '/auth/v1/token') return reply(200, { access_token: 'fake', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user: { id: me.id, email: me.email, user_metadata: { full_name: me.name }, aud: 'authenticated' } });
    if (p === '/auth/v1/user') return reply(200, { id: me.id, email: me.email, user_metadata: { full_name: me.name } });
    if (p === '/auth/v1/logout') return reply(204, '');
    // ── rpc
    if (p.startsWith('/rest/v1/rpc/')) {
      const fn = p.split('/').pop();
      if (fn === 'is_admin') return reply(200, isAdmin); if (fn === 'library_can_upload') return reply(200, canUpload);
      if (fn === 'library_facets') { const pub = db.resources.filter((r) => r.status === 'published'); const cnt = (k) => pub.reduce((a, r) => (r[k] != null && (a[r[k]] = (a[r[k]] || 0) + 1), a), {}); return reply(200, { total: pub.length, category: cnt('category_id'), subject: cnt('subject_id'), grade: cnt('grade_id'), file_type: cnt('file_type') }); }
      if (fn === 'library_track') { db.events.push({ id: db.events.length + 1, kind: body.p_kind, resource_id: body.p_resource_id, created_at: new Date().toISOString() }); return reply(200, null); }
      if (fn === 'library_review_resource') { const r = db.resources.find((x) => x.id === body.p_id); if (!isAdmin) return reply(400, { message: 'not_admin' }); r.status = { approve: 'published', restore: 'published', reject: 'rejected', unpublish: 'unavailable' }[body.p_action]; r.reject_reason = body.p_reason || null; return reply(200, null); }
      if (fn === 'library_admin_stats') { if (!isAdmin) return reply(400, { message: 'not_admin' }); const by = {}; db.resources.forEach((r) => (by[r.status] = (by[r.status] || 0) + 1));
        return reply(200, { by_status: by, open_reports: db.reports.filter((r) => r.status === 'open').length, total_views: 49, total_downloads: 3, active_users_30d: 2, bookmarks: db.bookmarks.length, daily: Array.from({ length: 30 }, (_, i) => ({ day: new Date(Date.now() - (29 - i) * 864e5).toISOString().slice(0, 10), view: i % 5, read: i % 3, download: i % 7 === 0 ? 1 : 0 })), top_viewed: [{ id: db.resources[0].id, title: db.resources[0].title, views_count: 42, downloads_count: 3 }] }); }
      return reply(404, { message: 'unknown rpc ' + fn });
    }
    // ── storage
    if (p.startsWith('/storage/v1/object/sign/')) {
      const rest = p.replace('/storage/v1/object/sign/', ''); const bucket = rest.split('/')[0];
      if (method === 'POST') { if (body?.paths) return reply(200, body.paths.map((pp) => ({ path: pp, error: null, signedURL: `/object/sign/${bucket}/${pp}?token=t` }))); return reply(200, { signedURL: `/object/sign/${rest}?token=t` }); }
      const file = rest.endsWith('.png') ? fx('cover.png') : fx('sample.pdf'); const type = rest.endsWith('.png') ? 'image/png' : 'application/pdf';
      const range = req.headers()['range']; if (range) { const m = /bytes=(\d+)-(\d*)/.exec(range); const s = +m[1], e = Math.min(file.length - 1, m[2] ? +m[2] : file.length - 1);
        return reply(206, file.subarray(s, e + 1), { 'content-type': type, 'content-range': `bytes ${s}-${e}/${file.length}`, 'accept-ranges': 'bytes' }); }
      return reply(200, file, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': String(file.length) });
    }
    if (p.startsWith('/storage/v1/upload/resumable')) {
      if (method === 'POST') { const md = Object.fromEntries((req.headers()['upload-metadata'] || '').split(',').map((kv) => { const [k, v] = kv.trim().split(' '); return [k, Buffer.from(v || '', 'base64').toString()]; }));
        db.uploads.push(md); const sent = (req.postDataBuffer() || Buffer.alloc(0)).length; return reply(201, '', { location: `https://${HOST}/storage/v1/upload/resumable/abc`, 'tus-resumable': '1.0.0', 'upload-offset': String(sent) }); }
      if (method === 'PATCH') { const n = Number(req.headers()['upload-offset'] || 0) + (req.postDataBuffer()?.length || 0); return reply(204, '', { 'tus-resumable': '1.0.0', 'upload-offset': String(n) }); }
      return reply(204, '', { 'tus-resumable': '1.0.0' });
    }
    if (p.startsWith('/storage/v1/object/') && method === 'DELETE') return reply(200, []);
    // ── PostgREST tables
    if (p.startsWith('/rest/v1/')) {
      const table = p.split('/')[3]; const accept = req.headers()['accept'] || ''; const prefer = req.headers()['prefer'] || '';
      const pairs = [...url.searchParams.entries()];
      const filters = pairs.filter(([k]) => !reserved.has(k)); const or = pairs.find(([k]) => k === 'or')?.[1];
      const order = pairs.find(([k]) => k === 'order')?.[1]; const limit = +(pairs.find(([k]) => k === 'limit')?.[1] || 1000), offset = +(pairs.find(([k]) => k === 'offset')?.[1] || 0);
      const store = { library_categories: db.cats, subjects: db.subjects, grades: db.grades, library_resources: db.resources, library_bookmarks: db.bookmarks, library_reading_progress: db.progress, library_collections: db.collections, library_collection_items: db.items, library_events: db.events, library_reports: db.reports }[table];
      if (!store) return reply(404, { message: 'unknown table ' + table, code: 'PGRST205' });
      const shape = (r) => {
        if (table === 'library_resources') return embed(r);
        if (table === 'library_collections') return { ...r, items: [{ count: db.items.filter((i) => i.collection_id === r.id).length }] };
        if (r.resource_id && table !== 'library_collection_items' || table === 'library_collection_items') { const res = db.resources.find((x) => x.id === r.resource_id); return { ...r, resource: res ? embed(res) : null }; }
        return r;
      };
      if (method === 'GET') {
        let rows = store.filter((r) => filters.every((f) => match(r, f)) && (!or || orMatch(r, or)) && (table !== 'library_resources' || visible(r)));
        if (order) { const [col, dir] = order.split(',')[0].split('.'); rows = [...rows].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === 'desc' ? -1 : 1)); }
        const total = rows.length; rows = rows.slice(offset, offset + limit).map(shape);
        const headers = { 'content-range': `${offset}-${offset + rows.length - 1}/${total}` };
        if (accept.includes('pgrst.object')) return rows.length === 1 ? reply(200, rows[0], headers) : reply(406, { code: 'PGRST116', message: 'no rows' });
        return reply(200, rows, headers);
      }
      if (method === 'POST') {
        const rowsIn = Array.isArray(body) ? body : [body]; const out = [];
        for (const b of rowsIn) {
          let row = { ...b };
          if (table === 'library_bookmarks') { row = { user_id: me.id, created_at: new Date().toISOString(), ...b }; if (store.some((x) => x.resource_id === row.resource_id)) continue; }
          if (table === 'library_reading_progress') { row = { user_id: me.id, updated_at: new Date().toISOString(), ...b }; const i = store.findIndex((x) => x.resource_id === row.resource_id); if (i >= 0) { store[i] = row; out.push(row); continue; } }
          if (table === 'library_collections') row = { id: uid(900 + store.length), created_at: new Date().toISOString(), description: null, ...b };
          if (table === 'library_collection_items') { row = { added_at: new Date().toISOString(), ...b }; if (store.some((x) => x.collection_id === row.collection_id && x.resource_id === row.resource_id)) continue; }
          if (table === 'library_resources') row = { views_count: 0, downloads_count: 0, created_at: new Date().toISOString(), published_at: b.status === 'published' ? new Date().toISOString() : null, uploaded_by: me.id, status: canUpload && b.status === 'published' && !isAdmin ? 'pending' : b.status, reject_reason: null, ...b };
          if (table === 'library_reports') { row = { id: uid(800 + store.length), status: 'open', created_at: new Date().toISOString(), ...b }; }
          store.push(row); out.push(row);
        }
        if (prefer.includes('return=representation') || accept.includes('pgrst.object')) return accept.includes('pgrst.object') ? reply(201, out[0] ?? {}) : reply(201, out);
        return reply(201, '');
      }
      if (method === 'PATCH') { const rows = store.filter((r) => filters.every((f) => match(r, f))); rows.forEach((r) => Object.assign(r, body)); return reply(200, prefer.includes('return=representation') ? rows : ''); }
      if (method === 'DELETE') { for (let i = store.length - 1; i >= 0; i--) if (filters.every((f) => match(store[i], f))) store.splice(i, 1); return reply(204, ''); }
    }
    return reply(404, { message: 'not mocked: ' + p });
  });
  return { me };
}
