# iLogia Library — مكتبة iLogia التعليمية

مكتبة رقمية للطلاب: استكشاف الكتب والمذكرات والملخصات وأوراق العمل والمراجع، قراءة PDF داخل التطبيق مع تذكّر آخر صفحة، حفظ المصادر وتنظيمها في قوائم، ومركز رفع ولوحة إدارة بصلاحيات تُفرض من الخادم.
*English: a static front-end (GitHub Pages) on the existing iLogia Supabase project — Arabic RTL by default, English supported.*

## التقنية
- واجهة ثابتة: Vite + JavaScript (بدون إطار)، راوتر Hash (يناسب GitHub Pages)، خطوط محلية (IBM Plex Sans Arabic + Noto Naskh Arabic).
- Supabase: Auth + Postgres (RLS) + Storage خاص + RPC. لا توجد خدمة خلفية أخرى.
- قارئ PDF: `pdfjs-dist` (يُحمَّل عند أول فتح فقط، طلبات Range لقراءة الصفحات المطلوبة).
- الرفع: TUS الاستئنافي. لوحة الإدارة مدخل منفصل `/admin/` لا يحمّله الطلاب.

## التشغيل
```bash
npm ci
npm run dev        # http://localhost:5173
npm run build      # → dist/
npm test           # i18n + build + اختبارات المتصفح
npm run test:sql   # يشغّل الـ migrations على Postgres محلي مؤقت (كمستخدم غير root)
```
اختبار التكامل مع PostgREST حقيقي: `POSTGREST_BIN=/path/to/postgrest node tests/integration/postgrest.mjs` (كمستخدم غير root).

## الهيكل
```
src/main.js, src/pages/*   تطبيق الطلاب        src/admin/main.js   لوحة الإدارة
src/lib/api.js             كل استدعاءات Supabase   src/lib/upload.js   التحقق + TUS
supabase/migrations        SQL للمراجعة (001 schema+RLS · 002 storage · 003 RPC)
supabase/optional          استيراد المكتبة القديمة (اختياري)   supabase/rollback   التراجع
docs/                      STORAGE · INTEGRATIONS · DEPLOY      PROGRESS.md   حالة العمل
tests/                     sql · integration · e2e (متصفح + Supabase وهمي) · i18n
```

## الأمان باختصار
المفتاح المضمَّن عام فقط. الصلاحيات (رفع، نشر، إدارة، خصوصية القوائم والتقدم) تُفرض بـ RLS وRPC؛ الواجهة تُخفي الأزرار فقط. تفاصيل وحدود في `docs/STORAGE.md`.
