// Copies the pdf.js runtime assets (standard fonts, CMaps, wasm decoders, ICC profiles) into public/pdfjs so they are
// served from our own origin (the CSP allows no third-party hosts). Runs automatically before `dev` and `build`.
import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..'), src = path.join(root, 'node_modules/pdfjs-dist'), out = path.join(root, 'public/pdfjs');
fs.rmSync(out, { recursive: true, force: true });
for (const d of ['standard_fonts', 'cmaps', 'wasm', 'iccs']) fs.cpSync(path.join(src, d), path.join(out, d), { recursive: true });
console.log('pdf.js assets copied to public/pdfjs');
