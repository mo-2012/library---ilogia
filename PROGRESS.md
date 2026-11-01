# PROGRESS — iLogia Library

آخر تحديث: 2026-11-02

## الحالة: مكتمل محليًا، لم يُدفع ولم يُنشر. لم يُلمس مشروع Supabase الحقيقي ولا DNS.

## ما أُنجز
- [x] فحص مشروع iLogia الحالي (zip): Supabase، `library_items`، `get_library_file`، `is_admin()`، جداول `subjects/grades`.
- [x] SQL: 8 جداول، RLS، Triggers حارسة، bucket خاص + سياسات، RPC (تتبع، مراجعة، facets، إحصاءات)، ملف استيراد اختياري، ملف تراجع.
- [x] الصفحات: الرئيسية، Explore (تصفية/ترتيب/Grid/List/ترقيم)، التفاصيل، قارئ PDF، My Library (محفوظات/متابعة/قوائم/سجل)، التصنيفات، مركز الرفع، لوحة الإدارة.
- [x] عربي RTL افتراضيًا + إنجليزي LTR، تصميم Navy/Gold، Responsive.
- [x] التوثيق: `docs/STORAGE.md`, `docs/INTEGRATIONS.md`, `docs/DEPLOY.md`.

## ما اختُبر فعلًا (وكيف)
| الاختبار | النتيجة |
|---|---|
| `tests/sql/run.mjs` — الـ migrations مرتين (idempotent) على Postgres حقيقي + 66 فحص صلاحيات | 66/66 |
| `tests/integration/postgrest.mjs` — **نفس `src/lib/api.js`** ضد PostgREST + Postgres حقيقيين مع الـ migrations | 44/44 |
| `tests/e2e.mjs` — Chromium على نسخة `dist` مع Supabase وهمي (دخول، بحث، قارئ، رفع، إدارة، XSS، موبايل، إنجليزي) | 68/68 |
| `tests/i18n-check.mjs` — كل مفتاح ترجمة موجود بالعربية والإنجليزية | OK |
| `vite build` | يعمل |

## ما لم يُختبر (لا ندّعي نجاحه)
- أي اتصال بمشروع Supabase الحقيقي: التحقق من أن `profiles.is_teacher`, `subjects.icon/sort_order`, `grades.stage/sort_order` موجودة كما استنتجنا من كود الموقع الحالي.
- تسجيل الدخول الفعلي (Google OAuth، رسائل التأكيد، استعادة كلمة السر) وتدفق PKCE.
- الرفع الفعلي إلى Supabase Storage (TUS مختبر ضد Mock فقط)، وسلوك Range مع الروابط الموقعة الحقيقية.
- Safari/iOS والأجهزة الحقيقية؛ اختبرنا Chromium فقط.
- المكتبة القديمة `legacy` (تتطلب `get_library_file` الحقيقية).
- الأداء مع آلاف المصادر (الفهارس موجودة لكن لم تُقَس).

## قرارات تحتاج موافقتك
1. **الهوية:** البرومبت يحدد Navy/Gold، بينما موقع iLogia الحالي أخضر/عاجي. التزمنا بالبرومبت.
2. **الجلسة:** الدخول غير مشترك مع `ilogia-eg.com` (انظر INTEGRATIONS).
3. **حد الحجم 50 م.ب** حتى تؤكد حد خطتك.
4. تشغيل الـ migrations على Staging ثم Production، وعمل Push/Deploy/DNS — كلها بانتظارك.

## الخطوة التالية المقترحة
شغّل الـ migrations على Staging، اضبط `VITE_SUPABASE_URL/KEY` للـ Staging، وجرّب `docs/DEPLOY.md` §5.
