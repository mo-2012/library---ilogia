-- Minimal stand-ins for the Supabase/iLogia objects the migrations depend on. TEST ONLY — never run on a real project.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth; create schema if not exists storage; create schema if not exists extensions;
grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                     nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', ''))::uuid $$;
-- columns mirror what the live iLogia site already selects (see supabase.js: grades.stage/sort_order, subjects.icon/sort_order)
create table if not exists public.grades (id bigint primary key, name text, stage text, sort_order int default 0);
create table if not exists public.subjects (id bigint primary key, name text, icon text, sort_order int default 0);
create table if not exists public.profiles (id uuid primary key references auth.users(id), is_teacher boolean default false);
create table if not exists public.admins (id uuid primary key);
create or replace function public.is_admin() returns boolean language sql stable security definer as
  $$ select exists (select 1 from public.admins where id = auth.uid()) $$;
create table if not exists storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as
  $$ select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name,'/'),1)-1,0)] $$;
grant select, insert, delete on storage.objects to authenticated;
grant select on public.grades, public.subjects, public.profiles to authenticated;
