-- ============================================================
-- 007: Виправлення вже застосованих міграцій
--   - profiles: політика "admin sees all" посилалась сама на себе
--     → "infinite recursion detected in policy" (класична Supabase-помилка)
--   - threads.title: default 'Новий чат' блокував автогенерацію заголовку
-- ============================================================

-- 1. Хелпери: security definer обходить RLS — рекурсії немає.
--    Викликаються з політик, тому execute лишаємо authenticated.
create or replace function is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from profiles where user_id = auth.uid() and role = 'admin'
  );
$$;

create or replace function current_user_role()
returns user_role
language sql
security definer
stable
set search_path = public
as $$
  select role from profiles where user_id = auth.uid();
$$;

-- 2. Замінюємо рекурсивну політику на profiles
drop policy if exists "admin sees all" on profiles;

create policy "admin sees all profiles" on profiles
  for select using (is_admin());

-- 3. threads.title: прибираємо default, щоб перше повідомлення
--    могло згенерувати заголовок (API перевіряє "title порожній")
alter table threads alter column title drop default;
update threads set title = null where title = 'Новий чат';
