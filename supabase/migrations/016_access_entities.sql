-- ============================================================
-- 016: Нормалізовані доступи до агентів і сервісів
--   role_features лишається для UI-фіч. Агенти та KB/сервіси мають
--   власні сутності й таблиці звʼязків, щоб права не жили у string flags.
-- ============================================================

create table if not exists agents (
  key agent_type primary key,
  name text not null,
  description text,
  enabled bool default true not null,
  created_at timestamptz default now() not null
);

create table if not exists role_agent_access (
  role user_role not null,
  agent agent_type not null references agents(key) on delete cascade,
  enabled bool default true not null,
  created_at timestamptz default now() not null,
  primary key (role, agent)
);

create table if not exists knowledge_base_role_access (
  knowledge_base_id uuid not null references knowledge_bases(id) on delete cascade,
  role user_role not null,
  created_at timestamptz default now() not null,
  primary key (knowledge_base_id, role)
);

create index if not exists role_agent_access_role_idx
  on role_agent_access(role)
  where enabled;

create index if not exists knowledge_base_role_access_role_idx
  on knowledge_base_role_access(role);

insert into agents (key, name, description, enabled) values
  ('codex',  'Codex',        'Кодовий і загальний агент виконання задач', true),
  ('search', 'Пошук',        'Пошук і збір зовнішнього контексту', true),
  ('drive',  'Google Drive', 'Доступ до документів Google Drive', true),
  ('bitrix', 'Bitrix24',     'CRM і операційні задачі Bitrix24', true),
  ('email',  'Email',        'Пошта та повідомлення', true),
  ('kb',     'Бази знань',   'Маршрутизація до MCP/KB сервісів', true)
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description;

insert into role_agent_access (role, agent, enabled)
select role_value::user_role, agents.key, true
from (values ('admin'), ('manager'), ('engineer'), ('viewer')) as roles(role_value)
cross join agents
on conflict (role, agent) do nothing;

insert into knowledge_base_role_access (knowledge_base_id, role)
select id, unnest(allowed_roles)
from knowledge_bases
on conflict (knowledge_base_id, role) do nothing;

alter table agents enable row level security;
alter table role_agent_access enable row level security;
alter table knowledge_base_role_access enable row level security;

drop policy if exists "authenticated read agents" on agents;
create policy "authenticated read agents" on agents
  for select using (auth.uid() is not null);

drop policy if exists "admin manages agents" on agents;
create policy "admin manages agents" on agents
  for all using (is_admin()) with check (is_admin());

drop policy if exists "authenticated read role agent access" on role_agent_access;
create policy "authenticated read role agent access" on role_agent_access
  for select using (auth.uid() is not null);

drop policy if exists "admin manages role agent access" on role_agent_access;
create policy "admin manages role agent access" on role_agent_access
  for all using (is_admin()) with check (is_admin());

drop policy if exists "authenticated read kb role access" on knowledge_base_role_access;
create policy "authenticated read kb role access" on knowledge_base_role_access
  for select using (auth.uid() is not null);

drop policy if exists "admin manages kb role access" on knowledge_base_role_access;
create policy "admin manages kb role access" on knowledge_base_role_access
  for all using (is_admin()) with check (is_admin());

drop policy if exists "users see allowed kbs" on knowledge_bases;
create policy "users see allowed kbs" on knowledge_bases
  for select using (
    enabled
    and exists (
      select 1
      from knowledge_base_role_access kb_access
      where kb_access.knowledge_base_id = knowledge_bases.id
        and kb_access.role = current_user_role()
    )
  );

create or replace function can_access_agent(p_agent agent_type)
returns bool
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from agents
    join role_agent_access agent_access on agent_access.agent = agents.key
    where agents.key = p_agent
      and agents.enabled
      and agent_access.enabled
      and agent_access.role = current_user_role()
  );
$$;

revoke execute on function can_access_agent(agent_type) from public, anon;
grant execute on function can_access_agent(agent_type) to authenticated, service_role;

create or replace function can_role_access_agent(
  p_role user_role,
  p_agent agent_type
)
returns bool
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from agents
    join role_agent_access agent_access on agent_access.agent = agents.key
    where agents.key = p_agent
      and agents.enabled
      and agent_access.enabled
      and agent_access.role = p_role
  );
$$;

revoke execute on function can_role_access_agent(user_role, agent_type) from public, anon;
grant execute on function can_role_access_agent(user_role, agent_type) to authenticated, service_role;

create or replace function complete_task(
  p_task_id uuid,
  p_worker_id text,
  p_result jsonb,
  p_agent agent_type default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task tasks%rowtype;
  v_role user_role;
  v_agent agent_type;
begin
  select * into v_task from tasks where id = p_task_id for update;

  if v_task.id is null then
    raise exception 'Task % not found', p_task_id;
  end if;

  if v_task.locked_by is distinct from p_worker_id then
    raise exception 'Task % is not locked by worker %', p_task_id, p_worker_id;
  end if;

  v_role := coalesce(v_task.payload->>'user_role', 'viewer')::user_role;
  v_agent := coalesce(p_agent, v_task.agent);

  -- DB — авторитетна межа: не покладаємось на те, що bash-воркер завжди
  -- передасть agent. Без агента завершити не можна.
  if v_agent is null then
    raise exception 'Agent required to complete task %', p_task_id;
  end if;

  if not can_role_access_agent(v_role, v_agent) then
    raise exception 'Agent % is not allowed for role %', v_agent, v_role;
  end if;

  if v_task.approval_required then
    if v_task.approved_at is null then
      raise exception 'Task % requires approval before completion', p_task_id;
    end if;

    if v_task.result is null or v_task.result <> p_result then
      raise exception 'Task % completion result does not match approved result', p_task_id;
    end if;
  end if;

  -- Порожня відповідь не йде людині (інакше у чаті порожній assistant-пузир).
  if coalesce(p_result->>'answer', '') = '' then
    raise exception 'result.answer is empty for task %', p_task_id;
  end if;

  update tasks set
    status     = 'done',
    result     = p_result,
    agent      = coalesce(p_agent, agent),
    locked_at  = null,
    locked_by  = null,
    checkpoint = null,
    error      = null,
    updated_at = now()
  where id = p_task_id
    and locked_by = p_worker_id
    and status = 'running';

  -- Guard: лише running-задача під цим воркером завершується (запобігає
  -- повторному complete і вставці другого assistant-повідомлення).
  if not found then
    raise exception 'Task % not owned by worker % or not in running state', p_task_id, p_worker_id;
  end if;

  insert into messages (thread_id, role, content, task_id)
  values (v_task.thread_id, 'assistant', p_result->>'answer', p_task_id);

  update threads set updated_at = now() where id = v_task.thread_id;
end;
$$;

revoke execute on function complete_task(uuid, text, jsonb, agent_type) from public, anon, authenticated;
grant execute on function complete_task(uuid, text, jsonb, agent_type) to service_role;

create or replace function can_manage_kb()
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
      and feature = 'kb_manage'
      and enabled
  );
$$;

create or replace function create_knowledge_base_with_access(
  p_name text,
  p_mcp_server text,
  p_description text,
  p_mcp_config jsonb,
  p_allowed_roles user_role[]
)
returns knowledge_bases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row knowledge_bases;
begin
  if not can_manage_kb() then
    raise exception 'Not allowed to manage knowledge bases';
  end if;

  if nullif(trim(p_name), '') is null or nullif(trim(p_mcp_server), '') is null then
    raise exception 'name and mcp_server are required';
  end if;

  if p_allowed_roles is null or cardinality(p_allowed_roles) = 0 then
    raise exception 'allowed_roles must not be empty';
  end if;

  insert into knowledge_bases (
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

  insert into knowledge_base_role_access (knowledge_base_id, role)
  select v_row.id, unnest(p_allowed_roles)
  on conflict (knowledge_base_id, role) do nothing;

  return v_row;
end;
$$;

create or replace function update_knowledge_base_with_access(
  p_id uuid,
  p_name text,
  p_description text,
  p_description_set bool,
  p_enabled bool,
  p_allowed_roles user_role[]
)
returns knowledge_bases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row knowledge_bases;
begin
  if not can_manage_kb() then
    raise exception 'Not allowed to manage knowledge bases';
  end if;

  if p_allowed_roles is not null and cardinality(p_allowed_roles) = 0 then
    raise exception 'allowed_roles must not be empty';
  end if;

  if p_name is not null and nullif(trim(p_name), '') is null then
    raise exception 'name must not be empty';
  end if;

  update knowledge_bases
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
    raise exception 'Knowledge base % not found', p_id;
  end if;

  if p_allowed_roles is not null then
    delete from knowledge_base_role_access
    where knowledge_base_id = p_id;

    insert into knowledge_base_role_access (knowledge_base_id, role)
    select p_id, unnest(p_allowed_roles)
    on conflict (knowledge_base_id, role) do nothing;
  end if;

  return v_row;
end;
$$;

revoke execute on function can_manage_kb() from public, anon;
revoke execute on function create_knowledge_base_with_access(text, text, text, jsonb, user_role[]) from public, anon;
revoke execute on function update_knowledge_base_with_access(uuid, text, text, bool, bool, user_role[]) from public, anon;

grant execute on function can_manage_kb() to authenticated, service_role;
grant execute on function create_knowledge_base_with_access(text, text, text, jsonb, user_role[]) to authenticated, service_role;
grant execute on function update_knowledge_base_with_access(uuid, text, text, bool, bool, user_role[]) to authenticated, service_role;

create or replace function ops_smoke_check()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agents int;
  v_role_agent_access int;
  v_kb_access int;
begin
  select count(*) into v_agents from agents;
  select count(*) into v_role_agent_access from role_agent_access;
  select count(*) into v_kb_access from knowledge_base_role_access;

  return jsonb_build_object(
    'agents_count', v_agents,
    'role_agent_access_count', v_role_agent_access,
    'knowledge_base_role_access_count', v_kb_access,
    'can_role_access_codex_viewer', can_role_access_agent('viewer', 'codex'),
    'release_stale_locks_available', release_stale_locks(1000000) >= 0
  );
end;
$$;

revoke execute on function ops_smoke_check() from public, anon, authenticated;
grant execute on function ops_smoke_check() to service_role;
