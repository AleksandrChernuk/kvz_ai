-- ============================================================
-- 005: Queue improvements inspired by Overstory
--   - retry_count / max_retries on tasks
--   - checkpoint JSONB for crash recovery
--   - agent_sessions table (state tracking)
--   - runs table (logical batching)
--   - claim_next_task() atomic function
--   - release_stale_locks() watchdog function
-- ============================================================

-- 1. Нові колонки на tasks
alter table tasks
  add column if not exists retry_count int default 0 not null,
  add column if not exists max_retries int default 3 not null,
  add column if not exists checkpoint jsonb,        -- прогрес агента для відновлення
  add column if not exists run_id uuid;             -- логічний запуск

-- Індекс для пріоритетного polling
create index if not exists tasks_queue_idx
  on tasks(priority desc, created_at asc)
  where status = 'pending';

-- -----------------------------------------------------------------------
-- 2. Runs — логічне групування задач одного сесійного запуску
-- -----------------------------------------------------------------------
create table if not exists runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz default now() not null,
  completed_at timestamptz,
  status text default 'active' not null check (status in ('active', 'completed', 'failed')),
  agent_count int default 0 not null,
  coordinator_session_id uuid,
  metadata jsonb default '{}' not null
);

alter table tasks
  add constraint tasks_run_id_fk
  foreign key (run_id) references runs(id) on delete set null;

-- -----------------------------------------------------------------------
-- 3. Agent sessions — стан оркестратора та субагентів
-- -----------------------------------------------------------------------
create type agent_state as enum (
  'booting', 'working', 'between_turns', 'stalled', 'completed', 'zombie'
);

create table if not exists agent_sessions (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null,             -- 'orchestrator', 'codex', 'search', …
  capability agent_type,
  state agent_state default 'booting' not null,
  task_id uuid references tasks(id) on delete set null,
  run_id uuid references runs(id) on delete set null,
  parent_session_id uuid references agent_sessions(id) on delete set null,
  depth int default 0 not null,         -- 0 = orchestrator, 1 = subagent
  worker_id text not null,              -- ідентифікатор процесу/інстансу
  escalation_level int default 0 not null,
  checkpoint jsonb,                     -- handoff при краші
  stalled_since timestamptz,
  last_activity timestamptz default now() not null,
  started_at timestamptz default now() not null,
  completed_at timestamptz
);

create index if not exists agent_sessions_state_idx on agent_sessions(state);
create index if not exists agent_sessions_task_idx on agent_sessions(task_id);
create index if not exists agent_sessions_worker_idx on agent_sessions(worker_id);

-- -----------------------------------------------------------------------
-- 4. claim_next_task(worker_id) — атомарний захват задачі
--    004 створив claim_next_task(worker_id text); create or replace не може
--    змінити імʼя вхідного параметра — спершу видаляємо стару версію.
-- -----------------------------------------------------------------------
drop function if exists claim_next_task(text);

create function claim_next_task(p_worker_id text)
returns setof tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task tasks;
begin
  select * into v_task
  from tasks
  where status = 'pending'
    and retry_count < max_retries
  order by priority desc, created_at asc
  limit 1
  for update skip locked;

  if not found then
    return;
  end if;

  update tasks set
    status     = 'running',
    locked_at  = now(),
    locked_by  = p_worker_id,
    updated_at = now()
  where id = v_task.id;

  return query select * from tasks where id = v_task.id;
end;
$$;

-- -----------------------------------------------------------------------
-- 5. release_stale_locks() — watchdog: звільнити задачі старіші 5 хвилин
-- -----------------------------------------------------------------------
create or replace function release_stale_locks(p_timeout_minutes int default 5)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update tasks set
    status        = 'pending',
    locked_at     = null,
    locked_by     = null,
    retry_count   = retry_count + 1,
    updated_at    = now()
  where status = 'running'
    and locked_at < now() - (p_timeout_minutes || ' minutes')::interval
    and retry_count < max_retries;

  get diagnostics v_count = row_count;

  -- Задачі що вичерпали retry — позначити як failed
  update tasks set
    status     = 'failed',
    error      = 'Перевищено кількість спроб (' || max_retries || ')',
    updated_at = now()
  where status = 'running'
    and locked_at < now() - (p_timeout_minutes || ' minutes')::interval
    and retry_count >= max_retries;

  return v_count;
end;
$$;

-- -----------------------------------------------------------------------
-- 6. complete_task() — атомарно завершити задачу і зберегти результат
-- -----------------------------------------------------------------------
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
begin
  update tasks set
    status     = 'done',
    result     = p_result,
    agent      = coalesce(p_agent, agent),
    locked_at  = null,
    locked_by  = null,
    updated_at = now()
  where id = p_task_id
    and locked_by = p_worker_id
    and status = 'running';

  if not found then
    raise exception 'Task % not owned by worker % or not in running state', p_task_id, p_worker_id;
  end if;
end;
$$;

-- -----------------------------------------------------------------------
-- 7. fail_task() — атомарно позначити задачу як failed
-- -----------------------------------------------------------------------
create or replace function fail_task(
  p_task_id uuid,
  p_worker_id text,
  p_error text,
  p_retry bool default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task tasks;
begin
  select * into v_task from tasks where id = p_task_id for update;

  if not found then
    raise exception 'Task % not found', p_task_id;
  end if;

  -- Тільки воркер, що тримає лок, може зафейлити задачу
  if v_task.locked_by is distinct from p_worker_id then
    raise exception 'Task % not owned by worker %', p_task_id, p_worker_id;
  end if;

  if p_retry and v_task.retry_count < v_task.max_retries then
    -- Повернути в чергу з лічильником retry
    update tasks set
      status      = 'pending',
      locked_at   = null,
      locked_by   = null,
      retry_count = retry_count + 1,
      error       = p_error,
      updated_at  = now()
    where id = p_task_id;
  else
    -- Остаточний fail
    update tasks set
      status     = 'failed',
      locked_at  = null,
      locked_by  = null,
      error      = p_error,
      updated_at = now()
    where id = p_task_id;
  end if;
end;
$$;

-- -----------------------------------------------------------------------
-- 8. save_checkpoint() — зберегти прогрес агента для crash recovery
-- -----------------------------------------------------------------------
create or replace function save_checkpoint(
  p_task_id uuid,
  p_worker_id text,
  p_checkpoint jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update tasks set
    checkpoint = p_checkpoint,
    updated_at = now()
  where id = p_task_id
    and locked_by = p_worker_id
    and status = 'running';

  -- Без перевірки save_checkpoint повертав би успіх навіть якщо лок втрачено
  -- або задача вже не running — і API відповідав би {ok:true} брехливо.
  if not found then
    raise exception 'Task % not owned by worker % or not in running state', p_task_id, p_worker_id;
  end if;
end;
$$;

-- -----------------------------------------------------------------------
-- 9. Доступ до security definer функцій.
--    Anon key публічний (лежить у фронтенд-бандлі) — execute лишаємо
--    тільки service_role, інакше будь-хто керує чергою напряму.
-- -----------------------------------------------------------------------
revoke execute on function claim_next_task(text) from public, anon, authenticated;
revoke execute on function release_stale_locks(int) from public, anon, authenticated;
revoke execute on function complete_task(uuid, text, jsonb, agent_type) from public, anon, authenticated;
revoke execute on function fail_task(uuid, text, text, bool) from public, anon, authenticated;
revoke execute on function save_checkpoint(uuid, text, jsonb) from public, anon, authenticated;

grant execute on function claim_next_task(text) to service_role;
grant execute on function release_stale_locks(int) to service_role;
grant execute on function complete_task(uuid, text, jsonb, agent_type) to service_role;
grant execute on function fail_task(uuid, text, text, bool) to service_role;
grant execute on function save_checkpoint(uuid, text, jsonb) to service_role;

-- RLS для нових таблиць
alter table runs enable row level security;
alter table agent_sessions enable row level security;

-- Читання — тільки admin (інсерти йдуть через service role, RLS їх не стосується)
create policy "admin reads runs" on runs
  for select using (
    exists (select 1 from profiles where user_id = auth.uid() and role = 'admin')
  );

create policy "admin reads sessions" on agent_sessions
  for select using (
    exists (select 1 from profiles where user_id = auth.uid() and role = 'admin')
  );
