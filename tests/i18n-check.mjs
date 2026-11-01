// Fails when a translation key used in the source is missing from either language, or when placeholders differ.
import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const load = async (n) => (await import(path.join(root, 'src/lib', n))).default;
const ar = await load('strings.ar.js'), en = await load('strings.en.js');
const files = []; (function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); f.isDirectory() ? walk(p) : p.endsWith('.js') && files.push(p); } })(path.join(root, 'src'));
const src = files.filter((f) => !/strings\./.test(f)).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const used = new Set([...src.matchAll(/\bt\('([A-Za-z0-9_.]+)'/g)].map((m) => m[1]).filter((k) => !k.endsWith('.')));
const dyn = { 'adm.rep.': ['open', 'resolved', 'dismissed'], 'hist.': ['view', 'read', 'download'], 'my.': ['saved', 'continue', 'lists', 'history'], 'report.r.': ['copyright', 'wrong_info', 'broken_file', 'inappropriate', 'other'],
  'res.notice.': ['draft', 'pending', 'rejected', 'unavailable'], 'sort.': ['new', 'views', 'name'], 'status.': ['published', 'pending', 'unavailable', 'rejected', 'draft'], 'type.': ['pdf', 'doc', 'ppt', 'xls', 'video', 'audio', 'image', 'epub', 'text', 'link', 'other'] };
for (const [p, xs] of Object.entries(dyn)) xs.forEach((x) => used.add(p + x));
for (const m of src.matchAll(/'((?:val|read|up|err|res)\.[A-Za-z]+)'/g)) used.add(m[1]);   // keys passed as values (e.g. error: 'val.type')
let bad = 0; const miss = (lang, k) => { console.log(`MISSING ${lang}: ${k}`); bad++; };
for (const k of used) { if (!(k in ar)) { if (/^(res|up|read|err)\./.test(k) && !src.includes(`t('${k}'`) && !src.includes(`'${k}'`)) continue; miss('ar', k); } if (!(k in en)) { if (k in ar || true) miss('en', k); } }
for (const k of Object.keys(ar)) { if (!(k in en)) miss('en', k); else { const a = (ar[k].match(/\{\w+\}/g) || []).sort().join(), b = (en[k].match(/\{\w+\}/g) || []).sort().join(); if (a !== b) { console.log(`PLACEHOLDER MISMATCH ${k}: ${a} vs ${b}`); bad++; } } }
for (const k of Object.keys(en)) if (!(k in ar)) miss('ar', k);
console.log(bad ? `${bad} problem(s)` : `i18n OK — ${Object.keys(ar).length} keys, ${used.size} used`); process.exit(bad ? 1 : 0);
