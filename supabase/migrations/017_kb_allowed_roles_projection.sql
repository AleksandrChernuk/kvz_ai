-- ============================================================
-- 017: knowledge_bases.allowed_roles — похідна від junction-таблиці
--
-- Після 016 єдиним читачем доступу до KB є knowledge_base_role_access
-- (RLS + worker-шлях). Колонка allowed_roles все ще писалась RPC-функціями
-- і експонувалась у типах/UI, але більше не керувала доступом — тобто стала
-- другим джерелом правди, яке могло розсинхронитись із таблицею.
--
-- Робимо колонку детермінованою проекцією junction-таблиці: будь-яка зміна
-- knowledge_base_role_access автоматично перераховує allowed_roles. Тепер
-- два представлення не можуть розійтися незалежно від шляху запису.
-- ============================================================

create or replace function sync_kb_allowed_roles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kb uuid;
begin
  v_kb := coalesce(new.knowledge_base_id, old.knowledge_base_id);

  update knowledge_bases
  set allowed_roles = coalesce(
    (
      select array_agg(role order by role)
      from knowledge_base_role_access
      where knowledge_base_id = v_kb
    ),
    '{}'::user_role[]
  )
  where id = v_kb;

  return null;
end;
$$;

drop trigger if exists kb_role_access_sync on knowledge_base_role_access;
create trigger kb_role_access_sync
after insert or delete on knowledge_base_role_access
for each row execute function sync_kb_allowed_roles();

-- Початкове вирівнювання для вже наявних рядків.
update knowledge_bases kb
set allowed_roles = coalesce(
  (
    select array_agg(role order by role)
    from knowledge_base_role_access
    where knowledge_base_id = kb.id
  ),
  '{}'::user_role[]
);
