-- OPTIONAL — NOT part of the automatic migrations. Review, adapt, and run manually on Staging first.
-- Imports rows of the existing public.library_items into public.library_resources WITHOUT moving any file.
-- The files stay in the existing 'library' bucket; the app opens them through the existing get_library_file() RPC,
-- so the existing free/paid access rules keep working unchanged.
-- Assumes library_items columns used by the current site: id, title, unit, grade_id, subject_id, academic_year, type, is_free.

insert into public.library_resources
  (title, description, category_id, subject_id, grade_id, source, file_type, legacy_item_id, allow_download, status, published_at)
select
  li.title,
  nullif(btrim(concat_ws(' — ', li.unit, li.academic_year)), ''),
  (select id from public.library_categories where slug = 'references'),     -- ADAPT: map li.type to a category
  li.subject_id, li.grade_id, 'legacy',
  case when li.type ilike '%pdf%' then 'pdf' else 'other' end,
  li.id, false, 'published', now()
from public.library_items li
where char_length(btrim(li.title)) >= 3
on conflict (legacy_item_id) do nothing;
