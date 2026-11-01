# النشر (لم يُنفَّذ شيء منه)

لا Push ولا Deploy ولا تعديل DNS تم. الخطوات أدناه لك أنت.

## 1) قاعدة البيانات (Staging أولًا)
1. خذ نسخة احتياطية. جرّب على مشروع Staging.
2. في SQL Editor شغّل بالترتيب: `supabase/migrations/20261031000001_library_schema.sql` ثم `…02_library_storage.sql` ثم `…03_library_rpc.sql`. كلها قابلة لإعادة التشغيل ولا تحذف شيئًا.
3. تحقق: `select count(*) from library_categories;` ← 6.
4. امنح الرفع لمعلم: `update public.profiles set is_teacher = true where lower(email) = lower('teacher@mail.com');` (الإدارة تُمنح عبر `is_admin()` الحالي كما في INSTALL.md للموقع الرئيسي).
5. اختياري: استيراد المكتبة القديمة `supabase/optional/20261031_legacy_import.sql` بعد مراجعته.
6. تراجع كامل: `supabase/rollback/library_rollback.sql` (يحذف بيانات المكتبة الجديدة فقط).

## 2) إعدادات Supabase يدويًا
- Authentication → URL Configuration: أضف `https://library.ilogia-eg.com/**` و`https://library.ilogia-eg.com/admin/**` إلى Redirect URLs.
- Google Provider: أضف النطاق الجديد في Authorized origins بـ Google Cloud.
- Storage → Settings: تأكد أن الحد الأقصى للملف ≥ 50 م.ب أو عدّل `MAX_FILE_BYTES` والـ bucket.

## 3) GitHub Pages
1. ادفع المستودع بعد مراجعته. Settings → Pages → Source: **GitHub Actions**، وفعّل Enforce HTTPS.
2. شغّل workflow «Deploy to GitHub Pages» يدويًا (مضبوط `workflow_dispatch` فقط).
3. DNS (عند مزوّد النطاق): سجل `CNAME` باسم `library` يشير إلى `mo-2012.github.io`. ملف `public/CNAME` مضاف مسبقًا.
4. لا تحتاج متغيرات بيئة. للـ Staging ضع `VITE_SUPABASE_URL` و`VITE_SUPABASE_KEY` (عامين فقط) عند البناء.

## 4) رؤوس الأمان
GitHub Pages لا يرسل رؤوسًا مخصصة، فالـ CSP موضوع في `<meta>`. لا يمكن ضبط `frame-ancestors` و`X-Frame-Options` بهذه الطريقة. إن أردتهما استخدم Cloudflare أمام النطاق وأضف الرؤوس منه.

## 5) فحص بعد النشر (يدوي)
دخول بحساب طالب ← استكشاف ← فتح PDF والتقدم إلى صفحة ثم إغلاق وإعادة الفتح ← حفظ مصدر ← بحساب معلم: رفع ملف 5 م.ب وآخر 40 م.ب مع قطع الإنترنت وإعادته أثناء الرفع ← بحساب إدارة: `/admin/` قبول ورفض ← تأكد أن الطالب لا يرى المرفوض.
