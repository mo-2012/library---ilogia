// Executes the migrations against a throw-away local PostgreSQL (embedded-postgres) with Supabase stand-ins,
// then checks Row Level Security / permissions behaviour. Run as a non-root user:  node tests/sql/run.mjs
import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const dataDir = process.env.PG_DATA_DIR || path.join(process.env.TMPDIR || '/tmp', 'ilogia-pg-' + process.pid);
const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'pw', port: 54329, persistent: false });

const U = { admin: '00000000-0000-0000-0000-0000000000a1', teacher: '00000000-0000-0000-0000-0000000000b1',
  teacher2: '00000000-0000-0000-0000-0000000000b2', s1: '00000000-0000-0000-0000-0000000000c1', s2: '00000000-0000-0000-0000-0000000000c2' };
let passed = 0, failed = 0;
const results = [];
function record(name, ok, extra = '') { (ok ? passed++ : failed++); results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  → ' + extra}`); }

let c;
async function as(who, fn) {            // run `fn` as an API role with a JWT subject
  await c.query('reset role');
  await c.query(`select set_config('request.jwt.claim.sub', $1, false)`, [who ? U[who] : '']);
  await c.query(who ? 'set role authenticated' : 'set role anon');
  try { return await fn(); } finally { await c.query('reset role'); }
}
const ok = async (name, fn) => { try { const v = await fn(); record(name, true); return v; } catch (e) { record(name, false, e.message); } };
const denied = async (name, fn, re) => { try { await fn(); record(name, false, 'expected an error but it succeeded'); } catch (e) { record(name, !re || re.test(e.message), 'wrong error: ' + e.message); } };
const q = (sql, p) => c.query(sql, p);

try {
  await pg.initialise(); await pg.start(); await pg.createDatabase('t');
  c = pg.getPgClient('t'); await c.connect();
  await q(fs.readFileSync(path.join(here, 'stubs.sql'), 'utf8'));
  for (const id of Object.values(U)) await q('insert into auth.users(id,email) values ($1,$2)', [id, id + '@t.test']);
  await q(`insert into public.profiles(id,is_teacher) values ($1,true),($2,true),($3,false),($4,false),($5,false)`, [U.teacher, U.teacher2, U.s1, U.s2, U.admin]);
  await q('insert into public.admins values ($1)', [U.admin]);
  await q(`insert into public.subjects values (1,'Math'),(2,'Science')`); await q(`insert into public.grades values (1,'G1')`);

  const dir = path.join(root, 'supabase/migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  for (const pass of [1, 2]) {          // twice → proves idempotency
    for (const f of files) { try { await q(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { record(`apply ${f} (run ${pass})`, false, e.message); throw e; } }
    record(`migrations apply cleanly (run ${pass})`, true);
  }
  const cat = (await q(`select id from library_categories where slug='books'`)).rows[0].id;
  const catCount = (await q('select count(*)::int n from library_categories')).rows[0].n;
  record('six categories seeded, no sample resources', catCount === 6 && (await q('select count(*)::int n from library_resources')).rows[0].n === 0);

  const newRes = (extra = {}) => ({ title: 'Test resource', cat, sp: 'u/' + U.teacher + '/x/file.pdf', ...extra });
  const insertRes = (who, v = {}) => as(who, () => q(
    `insert into library_resources (title, category_id, file_type, storage_bucket, storage_path, status, uploaded_by, views_count)
     values ($1,$2,'pdf','library-resources',$3,$4,$5,$6) returning id,status,uploaded_by,views_count`,
    [v.title || 'Test resource', cat, v.sp || `u/${U[who]}/r/file.pdf`, v.status || 'pending', v.uploaded_by || U[who], v.views || 0]));

  await denied('student without upload rights cannot insert a resource', () => insertRes('s1'), /row-level security/);
  await denied('anonymous cannot read resources', () => as(null, () => q('select * from library_resources')), /permission denied/);
  const r1 = (await ok('teacher can submit a resource', () => insertRes('teacher')))?.rows[0];
  record('teacher resource is pending', r1?.status === 'pending');
  const spoof = (await ok('teacher cannot self-publish or spoof owner/counters', () => insertRes('teacher', { status: 'published', uploaded_by: U.admin, views: 999, sp: `u/${U.teacher}/r2/file.pdf` })))?.rows[0];
  record('  → forced to pending, own id, 0 views', spoof?.status === 'pending' && spoof.uploaded_by === U.teacher && spoof.views_count === 0);
  await denied('bad storage path (..) rejected by constraint', () => insertRes('teacher', { sp: 'u/x/../y.pdf' }), /check constraint/);

  const seen = async who => (await as(who, () => q('select id from library_resources'))).rows.length;
  record('student sees nothing while resources are pending', (await seen('s1')) === 0);
  record('uploader sees own pending resources', (await seen('teacher')) === 2);
  record('other teacher cannot see them', (await seen('teacher2')) === 0);
  await denied('student cannot approve (RPC)', () => as('s1', () => q(`select library_review_resource($1,'approve')`, [r1.id])), /not_admin/);
  await denied('teacher cannot approve own resource (RPC)', () => as('teacher', () => q(`select library_review_resource($1,'approve')`, [r1.id])), /not_admin/);
  await as('teacher', () => q(`update library_resources set status='published' where id=$1`, [r1.id]));
  record('teacher direct UPDATE to published is neutralised by the guard', (await q('select status from library_resources where id=$1', [r1.id])).rows[0].status === 'pending');
  await denied('reject needs a reason', () => as('admin', () => q(`select library_review_resource($1,'reject','')`, [r1.id])), /reason_required/);
  await ok('admin rejects with reason', () => as('admin', () => q(`select library_review_resource($1,'reject','blurry scan')`, [r1.id])));
  await as('teacher', () => q(`update library_resources set title='Fixed scan' where id=$1`, [r1.id]));
  const re = (await q('select status,reject_reason from library_resources where id=$1', [r1.id])).rows[0];
  record('editing a rejected resource resubmits it as pending', re.status === 'pending' && re.reject_reason === null);
  await ok('admin approves', () => as('admin', () => q(`select library_review_resource($1,'approve')`, [r1.id])));
  record('student now sees the published resource', (await seen('s1')) === 1);
  const upd = await as('teacher', () => q(`update library_resources set title='Hacked' where id=$1`, [r1.id]));
  record('owner cannot edit a published resource', upd.rowCount === 0);
  const del = await as('teacher', () => q(`delete from library_resources where id=$1`, [r1.id]));
  record('owner cannot delete a published resource', del.rowCount === 0);
  const cnt = await as('admin', () => q(`update library_resources set views_count=500 where id=$1 returning views_count`, [r1.id]));
  record('even admins cannot forge counters from the API', cnt.rows[0].views_count === 0);

  // tracking & counters
  await ok('student tracks a view', () => as('s1', () => q(`select library_track($1,'view')`, [r1.id])));
  await ok('same-user repeat view is de-duplicated', () => as('s1', () => q(`select library_track($1,'view')`, [r1.id])));
  await ok('second student view counts', () => as('s2', () => q(`select library_track($1,'view')`, [r1.id])));
  record('views_count = 2', (await q('select views_count from library_resources where id=$1', [r1.id])).rows[0].views_count === 2);
  await denied('download blocked while allow_download = false', () => as('s1', () => q(`select library_track($1,'download')`, [r1.id])), /download_not_allowed/);
  await q('update library_resources set allow_download=true where id=$1', [r1.id]);
  await ok('download tracked when allowed', () => as('s1', () => q(`select library_track($1,'download')`, [r1.id])));
  await denied('direct insert into events is impossible', () => as('s1', () => q(`insert into library_events(user_id,resource_id,kind) values ($1,$2,'view')`, [U.s1, r1.id])), /permission denied/);
  record('events are private to their user', (await as('s2', () => q('select * from library_events'))).rows.every(r => r.user_id === U.s2));
  await denied('tracking an unpublished resource fails', () => as('s1', () => q(`select library_track($1,'view')`, [spoof.id])), /resource_not_available/);

  // bookmarks / progress / collections / reports isolation
  await ok('s1 bookmarks', () => as('s1', () => q('insert into library_bookmarks(resource_id) values ($1)', [r1.id])));
  record('s2 cannot see s1 bookmarks', (await as('s2', () => q('select * from library_bookmarks'))).rows.length === 0);
  await denied('s2 cannot bookmark as s1', () => as('s2', () => q('insert into library_bookmarks(user_id,resource_id) values ($1,$2)', [U.s1, r1.id])), /row-level security/);
  await ok('s1 saves reading progress', () => as('s1', () => q('insert into library_reading_progress(resource_id,last_page,page_count,percent) values ($1,7,20,35)', [r1.id])));
  record('s2 cannot read s1 progress', (await as('s2', () => q('select * from library_reading_progress'))).rows.length === 0);
  const col = (await as('s1', () => q(`insert into library_collections(name) values ('Exam week') returning id`))).rows[0].id;
  await denied('duplicate collection name (case-insensitive) rejected', () => as('s1', () => q(`insert into library_collections(name) values ('exam WEEK')`)), /duplicate key/);
  await denied('s2 cannot add items to s1 collection', () => as('s2', () => q('insert into library_collection_items values ($1,$2)', [col, r1.id])), /row-level security/);
  await ok('s1 adds an item to own collection', () => as('s1', () => q('insert into library_collection_items values ($1,$2)', [col, r1.id])));
  record('s2 cannot read s1 collections or items', (await as('s2', () => q('select 1 from library_collections union all select 1 from library_collection_items'))).rows.length === 0);
  await ok('s1 reports a resource', () => as('s1', () => q(`insert into library_reports(resource_id,reason,details) values ($1,'copyright','x')`, [r1.id])));
  await denied('report cannot be created pre-resolved', () => as('s2', () => q(`insert into library_reports(resource_id,reason,status,resolved_by) values ($1,'other','resolved',$2)`, [r1.id, U.s2])), /row-level security/);
  await denied('same user cannot file two open reports', () => as('s1', () => q(`insert into library_reports(resource_id,reason) values ($1,'other')`, [r1.id])), /duplicate key/);
  record('s2 cannot read s1 reports', (await as('s2', () => q('select * from library_reports'))).rows.length === 0);
  const ru = await as('s1', () => q(`update library_reports set status='dismissed'`));
  record('reporter cannot resolve own report', ru.rowCount === 0);
  record('admin sees all reports', (await as('admin', () => q('select * from library_reports'))).rows.length === 1);

  // categories
  await denied('student cannot create a category', () => as('s1', () => q(`insert into library_categories(slug,name_ar,name_en) values ('hack','x','x')`)), /row-level security/);
  await ok('admin can create a category', () => as('admin', () => q(`insert into library_categories(slug,name_ar,name_en) values ('labs','المعامل','Labs')`)));

  // facets & stats
  const f = (await as('s1', () => q('select library_facets() f'))).rows[0].f;
  record('facets count published resources', f.total === 1 && f.category[cat] === 1 && f.file_type.pdf === 1);
  await denied('admin stats refused for students', () => as('s1', () => q('select library_admin_stats()')), /not_admin/);
  const st = (await as('admin', () => q('select library_admin_stats() s'))).rows[0].s;
  record('admin stats are real numbers', st.total_views === 2 && st.total_downloads === 1 && st.open_reports === 1 && st.daily.length === 30 && st.top_viewed[0].id === r1.id);

  // storage policies
  const putObj = (who, name) => as(who, () => q(`insert into storage.objects(bucket_id,name) values ('library-resources',$1)`, [name]));
  await ok('teacher uploads into own folder', () => putObj('teacher', `u/${U.teacher}/aaa/file.pdf`));
  await denied('teacher cannot upload into someone else’s folder', () => putObj('teacher', `u/${U.teacher2}/aaa/file.pdf`), /row-level security/);
  await denied('student without upload rights cannot upload', () => putObj('s1', `u/${U.s1}/aaa/file.pdf`), /row-level security/);
  await denied('path outside u/<uid>/<id>/file is refused', () => putObj('teacher', `u/${U.teacher}/file.pdf`), /row-level security/);
  await denied('other buckets are not covered', () => as('teacher', () => q(`insert into storage.objects(bucket_id,name) values ('other',$1)`, [`u/${U.teacher}/a/b.pdf`])), /row-level security/);
  const readable = async who => (await as(who, () => q(`select name from storage.objects where bucket_id='library-resources'`))).rows.length;
  record('uploader reads own pending object', (await readable('teacher')) === 1);
  record('students cannot read pending objects', (await readable('s1')) === 0);
  await q(`insert into storage.objects(bucket_id,name) values ('library-resources',$1)`, [`u/${U.teacher}/r/file.pdf`]);
  await q(`update library_resources set storage_path=$2 where id=$1`, [r1.id, `u/${U.teacher}/r/file.pdf`]);
  record('students can read the object of a published resource', (await readable('s1')) === 1);
  record('admin reads all objects', (await readable('admin')) === 2);
  const od = await as('teacher', () => q(`delete from storage.objects where name=$1`, [`u/${U.teacher}/r/file.pdf`]));
  record('uploader cannot delete a published resource file', od.rowCount === 0);
  const od2 = await as('teacher', () => q(`delete from storage.objects where name=$1`, [`u/${U.teacher}/aaa/file.pdf`]));
  record('uploader can delete an unpublished file', od2.rowCount === 1);
  const bk = (await q(`select public, file_size_limit from storage.buckets where id='library-resources'`)).rows[0];
  record('bucket is private with a size limit', bk.public === false && Number(bk.file_size_limit) > 0);

  // rollback script runs
  await q(fs.readFileSync(path.join(root, 'supabase/rollback/library_rollback.sql'), 'utf8'));
  record('rollback script runs', (await q(`select to_regclass('public.library_resources') r`)).rows[0].r === null);
} catch (e) { record('harness error', false, e.stack || e.message); }
finally { try { await c?.end(); } catch {} try { await pg.stop(); } catch {} }

console.log(results.join('\n')); console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
