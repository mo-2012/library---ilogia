-- Rollback for migrations 001–003. DESTRUCTIVE: drops all iLogia Library data (not the existing site's tables).
-- Storage objects in 'library-resources' must be deleted first from the Dashboard / API (SQL deletes of storage.objects
-- do not remove the files themselves).
drop policy if exists library_objects_read   on storage.objects;
drop policy if exists library_objects_insert on storage.objects;
drop policy if exists library_objects_delete on storage.objects;
drop function if exists public.library_object_is_published(text);
delete from storage.buckets where id = 'library-resources';
drop function if exists public.library_admin_stats(), public.library_facets(), public.library_review_resource(uuid, text, text), public.library_track(uuid, text);
drop table if exists public.library_events, public.library_reports, public.library_collection_items, public.library_collections,
                     public.library_reading_progress, public.library_resource_bookmarks, public.library_resources, public.library_categories cascade;
drop function if exists public.library_limits(), public.library_resources_guard(), public.library_can_upload(), public.library_touch_updated_at();
