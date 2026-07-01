-- ============================================================
-- 025: ренейм KB → «конектор» на рівні БД
--
-- Історичні міграції (008/016/017/018/022/024) лишаються як є — вони вже
-- застосовані. Ця міграція перейменовує сутність у фінальний, єдиний термін
-- «конектор» (connector) поверх існуючої схеми: enum-значення, таблиці,
-- колонку, індекс, RLS-політики, RPC-функції, тригер, фіча-флаг і тіла
-- функцій, що лишаються постійними (ops_smoke_check, seed_notebooklm_notebook).
--
-- Ідентифікатори конкретних сервісів (mcp_server='kb-docs',
-- 'notebooklm-selection') НЕ чіпаємо — це імена реальних конекторів, зашиті у
-- agent/.mcp.json та рантайм.
-- ============================================================

-- 1. agent_type: значення 'kb' → 'connector' (каскадно оновлює всі рядки).
alter type agent_type rename value 'kb' to 'connector';

-- Каталог агентів: агент-роутер лишається, отримує єдиний нейм.
update agents
set name = 'Конектори',
    description = 'Маршрутизація до MCP-конекторів'
where key = 'connector';

-- 2. Таблиці, колонка, індекс.
alter table knowledge_bases rename to connectors;
alter table knowledge_base_role_access rename to connector_role_access;
alter table connector_role_access rename column knowledge_base_id to connector_id;
alter index knowledge_base_role_access_role_idx rename to connector_role_access_role_idx;

-- 3. RLS-політики (перейменовуємо + оновлюємо посилання на нову таблицю/колонку).
drop policy if exists "users see allowed kbs" on connectors;
drop policy if exists "admin manages kbs" on connectors;
create policy "users see allowed connectors" on connectors
  for select using (
    enabled
    and exists (
      select 1
      from connector_role_access cra
      where cra.connector_id = connectors.id
        and cra.role = current_user_role()
    )
  );
create policy "admin manages connectors" on connectors
  for all using (is_admin()) with check (is_admin());

drop policy if exists "authenticated read kb role access" on connector_role_access;
drop policy if exists "admin manages kb role access" on connector_role_access;
create policy "authenticated read connector role access" on connector_role_access
  for select using (auth.uid() is not null);
create policy "admin manages connector role access" on connector_role_access
  for all using (is_admin()) with check (is_admin());

-- 4. Фіча-флаг kb_manage → connectors_manage.
update role_features set feature = 'connectors_manage' where feature = 'kb_manage';

-- 5. RPC-функції: старі DROP, нові CREATE (тіла plpgsql резолвлять імена в
--    рантаймі, тому простого RENAME недостатньо).
drop function if exists can_manage_kb();
create function can_manage_connectors()
returns bool
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from role_features
    where role = current_user_role()
      and feature = 'connectors_manage'
      and enabled
  );
$$;
revoke execute on function can_manage_connectors() from public, anon;
grant execute on function can_manage_connectors() to authenticated, service_role;

drop function if exists create_knowledge_base_with_access(text, text, text, jsonb, user_role[]);
create function create_connector_with_access(
  p_name text,
  p_mcp_server text,
  p_description text,
  p_mcp_config jsonb,
  p_allowed_roles user_role[]
)
returns connectors
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row connectors;
begin
  if not can_manage_connectors() then
    raise exception 'Not allowed to manage connectors';
  end if;

  if nullif(trim(p_name), '') is null or nullif(trim(p_mcp_server), '') is null then
    raise exception 'name and mcp_server are required';
  end if;

  if p_allowed_roles is null or cardinality(p_allowed_roles) = 0 then
    raise exception 'allowed_roles must not be empty';
  end if;

  insert into connectors (
    name,
    mcp_server,
    description,
    mcp_config,
    allowed_roles
  )
  values (
    trim(p_name),
    trim(p_mcp_server),
    nullif(trim(p_description), ''),
    coalesce(p_mcp_config, '{}'::jsonb),
    p_allowed_roles
  )
  returning * into v_row;

  insert into connector_role_access (connector_id, role)
  select v_row.id, unnest(p_allowed_roles)
  on conflict (connector_id, role) do nothing;

  return v_row;
end;
$$;
revoke execute on function create_connector_with_access(text, text, text, jsonb, user_role[]) from public, anon;
grant execute on function create_connector_with_access(text, text, text, jsonb, user_role[]) to authenticated, service_role;

drop function if exists update_knowledge_base_with_access(uuid, text, text, bool, bool, user_role[]);
create function update_connector_with_access(
  p_id uuid,
  p_name text,
  p_description text,
  p_description_set bool,
  p_enabled bool,
  p_allowed_roles user_role[]
)
returns connectors
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row connectors;
begin
  if not can_manage_connectors() then
    raise exception 'Not allowed to manage connectors';
  end if;

  if p_allowed_roles is not null and cardinality(p_allowed_roles) = 0 then
    raise exception 'allowed_roles must not be empty';
  end if;

  if p_name is not null and nullif(trim(p_name), '') is null then
    raise exception 'name must not be empty';
  end if;

  update connectors
  set
    name = case
      when p_name is null then name
      else trim(p_name)
    end,
    description = case
      when p_description_set then nullif(trim(p_description), '')
      else description
    end,
    enabled = coalesce(p_enabled, enabled),
    allowed_roles = coalesce(p_allowed_roles, allowed_roles)
  where id = p_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Connector % not found', p_id;
  end if;

  if p_allowed_roles is not null then
    delete from connector_role_access
    where connector_id = p_id;

    insert into connector_role_access (connector_id, role)
    select p_id, unnest(p_allowed_roles)
    on conflict (connector_id, role) do nothing;
  end if;

  return v_row;
end;
$$;
revoke execute on function update_connector_with_access(uuid, text, text, bool, bool, user_role[]) from public, anon;
grant execute on function update_connector_with_access(uuid, text, text, bool, bool, user_role[]) to authenticated, service_role;

-- 6. Тригер-проекція allowed_roles.
drop trigger if exists kb_role_access_sync on connector_role_access;
drop function if exists sync_kb_allowed_roles();
create function sync_connector_allowed_roles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_connector uuid;
begin
  v_connector := coalesce(new.connector_id, old.connector_id);

  update connectors
  set allowed_roles = coalesce(
    (
      select array_agg(role order by role)
      from connector_role_access
      where connector_id = v_connector
    ),
    '{}'::user_role[]
  )
  where id = v_connector;

  return null;
end;
$$;
create trigger connector_role_access_sync
after insert or delete on connector_role_access
for each row execute function sync_connector_allowed_roles();

-- 7. ops_smoke_check: оновити посилання на таблицю + ключ у відповіді.
create or replace function ops_smoke_check()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agents int;
  v_role_agent_access int;
  v_connector_access int;
begin
  select count(*) into v_agents from agents;
  select count(*) into v_role_agent_access from role_agent_access;
  select count(*) into v_connector_access from connector_role_access;

  return jsonb_build_object(
    'agents_count', v_agents,
    'role_agent_access_count', v_role_agent_access,
    'connector_role_access_count', v_connector_access,
    'can_role_access_codex_viewer', can_role_access_agent('viewer', 'codex'),
    -- Перевірка наявності, а не виклик: health-probe не повинен мутувати чергу.
    'release_stale_locks_available', to_regprocedure('release_stale_locks(int)') is not null
  );
end;
$$;

-- 8. seed_notebooklm_notebook (з 024) — постійна функція, тіло тримає старі
--    імена таблиць. Пересоздаємо під нові.
create or replace function seed_notebooklm_notebook(
  p_name text,
  p_notebook_id text,
  p_roles user_role[],
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if nullif(trim(p_name), '') is null or nullif(trim(p_notebook_id), '') is null then
    raise exception 'p_name and p_notebook_id are required';
  end if;
  if p_roles is null or cardinality(p_roles) = 0 then
    raise exception 'p_roles must not be empty';
  end if;

  select id into v_id
  from connectors
  where mcp_server = 'notebooklm-selection'
    and mcp_config->>'notebook_id' = trim(p_notebook_id);

  if v_id is null then
    insert into connectors (name, description, mcp_server, mcp_config, enabled)
    values (
      trim(p_name),
      nullif(trim(p_description), ''),
      'notebooklm-selection',
      jsonb_build_object(
        'kind', 'notebooklm',
        'purpose', 'notebook',
        'connector_class', 'read-only-kb',
        'runtime', 'notebooklm-mcp',
        'notebook_id', trim(p_notebook_id)
      ),
      true
    )
    returning id into v_id;
  else
    update connectors
    set
      name = trim(p_name),
      description = nullif(trim(p_description), ''),
      mcp_config = mcp_config || jsonb_build_object(
        'purpose', 'notebook',
        'runtime', 'notebooklm-mcp',
        'notebook_id', trim(p_notebook_id)
      ),
      enabled = true
    where id = v_id;
  end if;

  delete from connector_role_access where connector_id = v_id;
  insert into connector_role_access (connector_id, role)
  select v_id, unnest(p_roles)
  on conflict (connector_id, role) do nothing;

  return v_id;
end;
$$;
revoke execute on function seed_notebooklm_notebook(text, text, user_role[], text)
  from public, anon, authenticated;
grant execute on function seed_notebooklm_notebook(text, text, user_role[], text)
  to service_role;
