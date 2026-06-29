-- ============================================================
-- 021: harden handle_new_user() — fix "Database error creating new user"
--
-- Тригер on_auth_user_created виконується в контексті auth-адміна
-- (supabase_auth_admin) при вставці в auth.users. Функція була security definer
-- БЕЗ `set search_path`, тож незакваліфікований `profiles` не резолвився на
-- Supabase Cloud → вставка користувача падала з "Database error creating new
-- user". Фікс: явний search_path + схемо-кваліфіковані імена.
-- ============================================================

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, full_name)
  values (new.id, new.raw_user_meta_data->>'full_name')
  on conflict (user_id) do nothing;
  return new;
end;
$$;
