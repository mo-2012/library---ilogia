-- iLogia Library — 001: schema, triggers, Row Level Security.
-- FOR REVIEW. Run first on a Staging project. Never run on Production before it is reviewed.
-- Re-runnable (idempotent). Does not touch or delete any existing table or row.
-- Depends on objects that already exist in the iLogia project: public.is_admin(), public.subjects, public.grades,
-- and (optionally) public.profiles.is_teacher.

do $$
begin
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'public.is_admin() not found. This migration expects the existing iLogia project.';
  end if;
  if to_regclass('public.subjects') is null or to_regclass('public.grades') is null then
    raise exception 'public.subjects / public.grades not found. This migration expects the existing iLogia project.';
  end if;
end $$;

create extension if not exists pg_trgm with schema extensions;

-- ───────────────────────── helpers ─────────────────────────
create or replace function public.library_touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- Who may upload: platform admins, and teachers (profiles.is_teacher). Returns false if that column is missing.
create or replace function public.library_can_upload() returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  if public.is_admin() then return true; end if;
  begin
    return coalesce((select p.is_teacher from public.profiles p where p.id = auth.uid()), false);
  exception when undefined_column or undefined_table then
    return false;
  end;
end $$;

-- ───────────────────────── categories ─────────────────────────
create table if not exists public.library_categories (
  id          bigint generated always as identity primary key,
  slug        text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name_ar     text not null check (char_length(btrim(name_ar)) between 1 and 80),
  name_en     text not null check (char_length(btrim(name_en)) between 1 and 80),
  icon        text,
  sort_order  int  not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Taxonomy only (the kinds of resource named in the product brief). No sample resources are inserted.
insert into public.library_categories (slug, name_ar, name_en, icon, sort_order) values
  ('books',      'الكتب',          'Books',            'book-open',   10),
  ('notes',      'المذكرات',       'Study notes',      'notebook',    20),
  ('summaries',  'الملخصات',       'Summaries',        'layers',      30),
  ('worksheets', 'أوراق العمل',    'Worksheets',       'clipboard',   40),
  ('references', 'المراجع',        'References',       'library',     50),
  ('extras',     'المصادر الإضافية','Extra resources', 'sparkles',    60)
on conflict (slug) do nothing;

-- ───────────────────────── resources ─────────────────────────
create table if not exists public.library_resources (
  id               uuid primary key default gen_random_uuid(),
  title            text not null check (char_length(btrim(title)) between 3 and 200),
  description      text check (char_length(description) <= 4000),
  author           text check (char_length(author) <= 200),
  category_id      bigint not null references public.library_categories(id),
  subject_id       bigint references public.subjects(id) on delete set null,
  grade_id         bigint references public.grades(id)   on delete set null,
  source           text not null default 'upload' check (source in ('upload','external','legacy')),
  file_type        text not null check (file_type in ('pdf','doc','ppt','xls','video','audio','image','epub','text','link','other')),
  storage_bucket   text,
  storage_path     text check (storage_path is null or (storage_path !~ '(^|/)\.\.(/|$)' and storage_path !~ '^/' and char_length(storage_path) <= 400)),
  original_filename text check (char_length(original_filename) <= 255),
  mime_type        text,
  file_size        bigint check (file_size is null or file_size >= 0),
  page_count       int check (page_count is null or page_count > 0),
  external_url     text check (external_url is null or (external_url ~* '^https://' and char_length(external_url) <= 2000)),
  cover_path       text check (cover_path is null or (cover_path !~ '(^|/)\.\.(/|$)' and cover_path !~ '^/')),
  legacy_item_id   bigint unique,                       -- optional link to public.library_items (see supabase/optional)
  allow_download   boolean not null default false,      -- copyright: downloading is opt-in
  status           text not null default 'pending' check (status in ('draft','pending','published','rejected','unavailable')),
  reject_reason    text check (char_length(reject_reason) <= 500),
  uploaded_by      uuid references auth.users(id) on delete set null,
  reviewed_by      uuid references auth.users(id) on delete set null,
  reviewed_at      timestamptz,
  published_at     timestamptz,
  views_count      int not null default 0,
  downloads_count  int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint library_resources_source_ok check (
       (source = 'upload'   and storage_bucket is not null and storage_path is not null)
    or (source = 'external' and external_url is not null)
    or (source = 'legacy'   and legacy_item_id is not null))
);

create index if not exists library_resources_status_pub_idx on public.library_resources (status, published_at desc);
create index if not exists library_resources_category_idx   on public.library_resources (category_id);
create index if not exists library_resources_subject_idx    on public.library_resources (subject_id);
create index if not exists library_resources_grade_idx      on public.library_resources (grade_id);
create index if not exists library_resources_uploader_idx   on public.library_resources (uploaded_by);
create index if not exists library_resources_views_idx      on public.library_resources (views_count desc) where status = 'published';
create index if not exists library_resources_title_trgm     on public.library_resources using gin (title extensions.gin_trgm_ops);
create index if not exists library_resources_desc_trgm      on public.library_resources using gin (description extensions.gin_trgm_ops);

drop trigger if exists library_resources_touch on public.library_resources;
create trigger library_resources_touch before update on public.library_resources
  for each row execute function public.library_touch_updated_at();

-- Guard: API roles ('authenticated') can never grant themselves rights through column values.
-- Security-definer RPCs, the dashboard and service_role run under other roles and bypass the restrictions below.
create or replace function public.library_resources_guard() returns trigger
language plpgsql as $$
declare v_admin boolean;
begin
  if current_user not in ('authenticated','anon') then return new; end if;
  v_admin := public.is_admin();

  if tg_op = 'INSERT' then
    new.views_count := 0; new.downloads_count := 0;
    new.reviewed_by := null; new.reviewed_at := null; new.published_at := null; new.reject_reason := null;
    new.legacy_item_id := null;
    if new.source = 'legacy' then new.source := 'upload'; end if;
    if v_admin then
      new.uploaded_by := coalesce(new.uploaded_by, auth.uid());
      if new.status = 'published' then
        new.published_at := now(); new.reviewed_by := auth.uid(); new.reviewed_at := now();
      end if;
    else
      new.uploaded_by := auth.uid();
      if new.status not in ('draft','pending') then new.status := 'pending'; end if;
    end if;
    return new;
  end if;

  -- UPDATE
  if v_admin then
    if new.status is distinct from old.status then
      new.reviewed_by := auth.uid(); new.reviewed_at := now();
      if new.status = 'published' and old.published_at is null then new.published_at := now(); end if;
    end if;
    new.views_count := old.views_count; new.downloads_count := old.downloads_count;
    return new;
  end if;

  -- owner (RLS already limits this to own, not-yet-published rows)
  new.uploaded_by := old.uploaded_by;
  new.views_count := old.views_count; new.downloads_count := old.downloads_count;
  new.reviewed_by := old.reviewed_by; new.reviewed_at := old.reviewed_at; new.published_at := old.published_at;
  new.legacy_item_id := old.legacy_item_id; new.source := old.source;
  if new.status not in ('draft','pending') then new.status := old.status; end if;
  if old.status = 'rejected' and new.status = 'rejected' then new.status := 'pending'; end if;   -- editing = resubmitting
  if new.status = 'pending' then new.reject_reason := null; else new.reject_reason := old.reject_reason; end if;
  return new;
end $$;

drop trigger if exists library_resources_guard_trg on public.library_resources;
create trigger library_resources_guard_trg before insert or update on public.library_resources
  for each row execute function public.library_resources_guard();

alter table public.library_categories enable row level security;
alter table public.library_resources  enable row level security;

drop policy if exists library_categories_read  on public.library_categories;
drop policy if exists library_categories_admin on public.library_categories;
create policy library_categories_read  on public.library_categories for select to authenticated using (is_active or public.is_admin());
create policy library_categories_admin on public.library_categories for all    to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists library_resources_select on public.library_resources;
drop policy if exists library_resources_insert on public.library_resources;
drop policy if exists library_resources_update on public.library_resources;
drop policy if exists library_resources_delete on public.library_resources;
create policy library_resources_select on public.library_resources for select to authenticated
  using (status = 'published' or uploaded_by = auth.uid() or public.is_admin());
create policy library_resources_insert on public.library_resources for insert to authenticated
  with check (public.library_can_upload() and (public.is_admin() or uploaded_by = auth.uid()));
create policy library_resources_update on public.library_resources for update to authenticated
  using      (public.is_admin() or (uploaded_by = auth.uid() and status in ('draft','pending','rejected')))
  with check (public.is_admin() or uploaded_by = auth.uid());
create policy library_resources_delete on public.library_resources for delete to authenticated
  using (public.is_admin() or (uploaded_by = auth.uid() and status <> 'published'));

-- ───────────────────────── per-user data ─────────────────────────
create table if not exists public.library_bookmarks (
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  resource_id uuid not null references public.library_resources(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, resource_id)
);
create index if not exists library_bookmarks_user_idx on public.library_bookmarks (user_id, created_at desc);

create table if not exists public.library_reading_progress (
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  resource_id uuid not null references public.library_resources(id) on delete cascade,
  last_page   int  not null check (last_page >= 1),
  page_count  int  check (page_count is null or page_count >= 1),
  percent     smallint not null default 0 check (percent between 0 and 100),
  updated_at  timestamptz not null default now(),
  primary key (user_id, resource_id)
);
create index if not exists library_progress_user_idx on public.library_reading_progress (user_id, updated_at desc);
drop trigger if exists library_progress_touch on public.library_reading_progress;
create trigger library_progress_touch before update on public.library_reading_progress
  for each row execute function public.library_touch_updated_at();

create table if not exists public.library_collections (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  description text check (char_length(description) <= 300),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists library_collections_user_name_uq on public.library_collections (user_id, lower(btrim(name)));
drop trigger if exists library_collections_touch on public.library_collections;
create trigger library_collections_touch before update on public.library_collections
  for each row execute function public.library_touch_updated_at();

create table if not exists public.library_collection_items (
  collection_id uuid not null references public.library_collections(id) on delete cascade,
  resource_id   uuid not null references public.library_resources(id) on delete cascade,
  added_at      timestamptz not null default now(),
  primary key (collection_id, resource_id)
);

-- Soft limits so one account cannot bloat the tables.
create or replace function public.library_limits() returns trigger
language plpgsql as $$
begin
  if current_user not in ('authenticated','anon') then return new; end if;
  if tg_table_name = 'library_collections' then
    if (select count(*) from public.library_collections where user_id = new.user_id) >= 50 then raise exception 'collection_limit'; end if;
  elsif tg_table_name = 'library_collection_items' then
    if (select count(*) from public.library_collection_items where collection_id = new.collection_id) >= 500 then raise exception 'collection_items_limit'; end if;
  elsif tg_table_name = 'library_bookmarks' then
    if (select count(*) from public.library_bookmarks where user_id = new.user_id) >= 2000 then raise exception 'bookmark_limit'; end if;
  end if;
  return new;
end $$;
drop trigger if exists library_collections_limit on public.library_collections;
create trigger library_collections_limit before insert on public.library_collections for each row execute function public.library_limits();
drop trigger if exists library_items_limit on public.library_collection_items;
create trigger library_items_limit before insert on public.library_collection_items for each row execute function public.library_limits();
drop trigger if exists library_bookmarks_limit on public.library_bookmarks;
create trigger library_bookmarks_limit before insert on public.library_bookmarks for each row execute function public.library_limits();

create table if not exists public.library_reports (
  id              uuid primary key default gen_random_uuid(),
  resource_id     uuid not null references public.library_resources(id) on delete cascade,
  reporter_id     uuid default auth.uid() references auth.users(id) on delete set null,
  reason          text not null check (reason in ('copyright','wrong_info','broken_file','inappropriate','other')),
  details         text check (char_length(details) <= 1000),
  status          text not null default 'open' check (status in ('open','resolved','dismissed')),
  resolved_by     uuid references auth.users(id) on delete set null,
  resolved_at     timestamptz,
  resolution_note text check (char_length(resolution_note) <= 500),
  created_at      timestamptz not null default now()
);
create unique index if not exists library_reports_one_open_uq on public.library_reports (resource_id, reporter_id) where status = 'open';
create index if not exists library_reports_status_idx on public.library_reports (status, created_at desc);

-- Usage events. Written only by public.library_track() (security definer); users can read their own history.
create table if not exists public.library_events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  resource_id uuid not null references public.library_resources(id) on delete cascade,
  kind        text not null check (kind in ('view','read','download')),
  created_at  timestamptz not null default now()
);
create index if not exists library_events_user_idx on public.library_events (user_id, created_at desc);
create index if not exists library_events_res_idx  on public.library_events (resource_id, kind, created_at desc);
create index if not exists library_events_day_idx  on public.library_events (created_at desc);

alter table public.library_bookmarks        enable row level security;
alter table public.library_reading_progress enable row level security;
alter table public.library_collections      enable row level security;
alter table public.library_collection_items enable row level security;
alter table public.library_reports          enable row level security;
alter table public.library_events           enable row level security;

drop policy if exists library_bookmarks_own on public.library_bookmarks;
create policy library_bookmarks_own on public.library_bookmarks for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.library_resources r where r.id = resource_id));

drop policy if exists library_progress_own on public.library_reading_progress;
create policy library_progress_own on public.library_reading_progress for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.library_resources r where r.id = resource_id));

drop policy if exists library_collections_own on public.library_collections;
create policy library_collections_own on public.library_collections for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists library_collection_items_own on public.library_collection_items;
create policy library_collection_items_own on public.library_collection_items for all to authenticated
  using (exists (select 1 from public.library_collections c where c.id = collection_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public.library_collections c where c.id = collection_id and c.user_id = auth.uid())
              and exists (select 1 from public.library_resources r where r.id = resource_id));

drop policy if exists library_reports_insert on public.library_reports;
drop policy if exists library_reports_select on public.library_reports;
drop policy if exists library_reports_admin  on public.library_reports;
create policy library_reports_insert on public.library_reports for insert to authenticated
  with check (reporter_id = auth.uid() and status = 'open' and resolved_by is null and resolved_at is null and resolution_note is null
              and exists (select 1 from public.library_resources r where r.id = resource_id));
create policy library_reports_select on public.library_reports for select to authenticated
  using (reporter_id = auth.uid() or public.is_admin());
create policy library_reports_admin on public.library_reports for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists library_reports_admin_del on public.library_reports;
create policy library_reports_admin_del on public.library_reports for delete to authenticated using (public.is_admin());

drop policy if exists library_events_select on public.library_events;
create policy library_events_select on public.library_events for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ───────────────────────── grants (defence in depth on top of RLS) ─────────────────────────
revoke all on public.library_categories, public.library_resources, public.library_bookmarks, public.library_reading_progress,
              public.library_collections, public.library_collection_items, public.library_reports, public.library_events
  from anon, public;
grant select, insert, update, delete on public.library_categories, public.library_resources, public.library_bookmarks,
      public.library_reading_progress, public.library_collections, public.library_collection_items to authenticated;
grant select, insert, update, delete on public.library_reports to authenticated;
grant select on public.library_events to authenticated;
revoke all on function public.library_can_upload() from public, anon;
grant execute on function public.library_can_upload() to authenticated;
