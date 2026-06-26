-- Minimal Supabase stubs so migrations 001..NNN apply against a plain Postgres.
-- Provides: the three Supabase roles, the auth schema/users table, an auth.uid()
-- that reads a test GUC (app.user_id), and the realtime publication. This lets
-- integration tests exercise the REAL queue functions and RLS policies.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb  -- read by handle_new_user (001)
);

-- In Supabase auth.uid() comes from the JWT. In tests we set it via a GUC.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to anon, authenticated, service_role;

-- Realtime publication referenced by migration 004.
create publication supabase_realtime;
