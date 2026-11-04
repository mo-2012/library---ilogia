# حالة المايجريشنز على قاعدة ilogia-db (zugwicbbfbefbbwugfxq)
تم تطبيقها بتاريخ 2026-11-04 بالترتيب (library_001 → library_004). الملفات هنا مطابقة لما اتطبق.

- الجدول الجديد للإشارات المرجعية اسمه `library_resource_bookmarks` (مش `library_bookmarks`) لأن `library_bookmarks` موجود في القاعدة بشكل قديم (item_id) ولم يُلمس.
- تم إضافة `set search_path = public` لدوال الـ triggers الثلاث (migration رابع، موجود في القاعدة فقط؛ ضيفه لو عايز الريبو يطابقها: 
  `alter function public.library_touch_updated_at() set search_path = public;` وكذلك `library_resources_guard()` و`library_limits()`).
- `supabase/optional/20261031_legacy_import.sql` **لم يُنفّذ** (يتطلب تحديد تصنيف لكل نوع في `library_items`، وعددهم 23 عنصر).
