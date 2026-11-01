-- iLogia Library — 003: RPC functions (usage tracking, moderation, facets, admin statistics).
-- FOR REVIEW. Every function checks auth.uid() / is_admin() on the server; the browser is never trusted.

-- Records a usage event for a PUBLISHED resource and keeps the counters real.
create or replace function public.library_track(p_resource_id uuid, p_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare v_res public.library_resources%rowtype;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_kind not in ('view','read','download') then raise exception 'invalid_kind'; end if;
  select * into v_res from public.library_resources where id = p_resource_id and status = 'published';
  if not found then raise exception 'resource_not_available'; end if;
  if p_kind = 'download' and not v_res.allow_download then raise exception 'download_not_allowed'; end if;

  if p_kind = 'view' and exists (
      select 1 from public.library_events e
      where e.user_id = auth.uid() and e.resource_id = p_resource_id and e.kind = 'view' and e.created_at > now() - interval '30 minutes')
  then return; end if;

  insert into public.library_events (user_id, resource_id, kind) values (auth.uid(), p_resource_id, p_kind);
  if p_kind = 'view' then
    update public.library_resources set views_count = views_count + 1 where id = p_resource_id;
  elsif p_kind = 'download' then
    update public.library_resources set downloads_count = downloads_count + 1 where id = p_resource_id;
  end if;
end $$;

-- Moderation. p_action: approve | reject | unpublish | restore
create or replace function public.library_review_resource(p_id uuid, p_action text, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  if p_action = 'approve' or p_action = 'restore' then
    update public.library_resources set status = 'published', reject_reason = null,
           published_at = coalesce(published_at, now()), reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
  elsif p_action = 'reject' then
    if coalesce(btrim(p_reason), '') = '' then raise exception 'reason_required'; end if;
    update public.library_resources set status = 'rejected', reject_reason = left(btrim(p_reason), 500),
           reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
  elsif p_action = 'unpublish' then
    update public.library_resources set status = 'unavailable', reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
  else
    raise exception 'invalid_action';
  end if;
  if not found then raise exception 'resource_not_found'; end if;
end $$;

-- Counts for filters and category cards (published resources only; RLS applies).
create or replace function public.library_facets() returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'total',     (select count(*) from public.library_resources where status = 'published'),
    'category',  coalesce((select jsonb_object_agg(k, n) from (select category_id k, count(*) n from public.library_resources where status = 'published' group by 1) t), '{}'::jsonb),
    'subject',   coalesce((select jsonb_object_agg(k, n) from (select subject_id  k, count(*) n from public.library_resources where status = 'published' and subject_id is not null group by 1) t), '{}'::jsonb),
    'grade',     coalesce((select jsonb_object_agg(k, n) from (select grade_id    k, count(*) n from public.library_resources where status = 'published' and grade_id is not null group by 1) t), '{}'::jsonb),
    'file_type', coalesce((select jsonb_object_agg(k, n) from (select file_type   k, count(*) n from public.library_resources where status = 'published' group by 1) t), '{}'::jsonb)
  );
$$;

-- Real usage statistics for the admin dashboard.
create or replace function public.library_admin_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  select jsonb_build_object(
    'by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from public.library_resources group by 1) s), '{}'::jsonb),
    'open_reports', (select count(*) from public.library_reports where status = 'open'),
    'total_views', (select coalesce(sum(views_count), 0) from public.library_resources),
    'total_downloads', (select coalesce(sum(downloads_count), 0) from public.library_resources),
    'active_users_30d', (select count(distinct user_id) from public.library_events where created_at > now() - interval '30 days'),
    'bookmarks', (select count(*) from public.library_bookmarks),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'view', v, 'read', rd, 'download', dl) order by d) from (
        select g::date d,
               count(*) filter (where e.kind = 'view') v, count(*) filter (where e.kind = 'read') rd, count(*) filter (where e.kind = 'download') dl
        from generate_series(current_date - 29, current_date, interval '1 day') g
        left join public.library_events e on e.created_at >= g and e.created_at < g + interval '1 day'
        group by 1) x), '[]'::jsonb),
    'top_viewed', coalesce((select jsonb_agg(t) from (select id, title, views_count, downloads_count from public.library_resources
                    where status = 'published' and views_count > 0 order by views_count desc limit 5) t), '[]'::jsonb)
  ) into r;
  return r;
end $$;

revoke all on function public.library_track(uuid, text), public.library_review_resource(uuid, text, text),
                       public.library_facets(), public.library_admin_stats() from public, anon;
grant execute on function public.library_track(uuid, text), public.library_review_resource(uuid, text, text),
                          public.library_facets(), public.library_admin_stats() to authenticated;
