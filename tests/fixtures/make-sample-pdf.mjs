// Builds tests/fixtures/sample.pdf with Chromium so it has real embedded fonts (Arabic + Latin), like a typical student PDF.
import { createRequire } from 'node:module'; import path from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const pages = Array.from({ length: 12 }, (_, i) => `<section style="page-break-after:always;padding:40px;direction:rtl;font-family:'Noto Naskh Arabic','DejaVu Sans',serif"><h1 style="font-size:44px">الوحدة ${i + 1}: الجبر والهندسة</h1><p style="font-size:22px;line-height:2">هذه صفحة رقم ${i + 1} من ملف تجريبي لقارئ مكتبة iLogia. Test page ${i + 1}.</p><div style="height:6px;background:#101D36;margin-top:40px"></div></section>`).join('');
const b = await chromium.launch(); const p = await b.newPage(); await p.setContent(`<html lang="ar"><body style="margin:0">${pages}</body></html>`);
await p.pdf({ path: path.join(import.meta.dirname, 'sample.pdf'), format: 'A4' }); await b.close(); console.log('sample.pdf written');
