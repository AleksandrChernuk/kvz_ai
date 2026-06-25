-- ============================================================
-- 006: Agent mail, webhook_url, rate limiting
-- ============================================================

-- 1. webhook_url на profiles
alter table profiles
  add column if not exists webhook_url text;

-- 2. Agent mail — структуровані повідомлення між агентами
create type mail_type as enum (
  'worker_done', 'worker_died', 'escalation',
  'health_check', 'dispatch', 'info'
);

create table if not exists agent_mail (
  id uuid primary key default gen_random_uuid(),
  from_agent text not null,
  to_agent text not null,         -- або '@all', '@orchestrators'
  subject text not null,
  body text not null,
  type mail_type default 'info' not null,
  priority int default 0 not null,
  task_id uuid references tasks(id) on delete set null,
  run_id uuid references runs(id) on delete set null,
  read_at timestamptz,
  created_at timestamptz default now() not null
);

create index if not exists agent_mail_to_idx on agent_mail(to_agent, read_at)
  where read_at is null;
create index if not exists agent_mail_task_idx on agent_mail(task_id);

alter table agent_mail enable row level security;

create policy "admin reads mail" on agent_mail
  for select using (
    exists (select 1 from profiles where user_id = auth.uid() and role = 'admin')
  );

-- 3. check_pending_limit(user_id, max) — rate limit: кількість активних задач
create or replace function check_pending_limit(p_user_id uuid, p_max int default 5)
returns bool
language sql
security definer
set search_path = public
as $$
  select count(*) < p_max
  from tasks
  where user_id = p_user_id
    and status in ('pending', 'running');
$$;

-- 4. send_mail() — вставка повідомлення між агентами
create or replace function send_mail(
  p_from text,
  p_to text,
  p_subject text,
  p_body text,
  p_type mail_type default 'info',
  p_priority int default 0,
  p_task_id uuid default null,
  p_run_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into agent_mail (from_agent, to_agent, subject, body, type, priority, task_id, run_id)
  values (p_from, p_to, p_subject, p_body, p_type, p_priority, p_task_id, p_run_id)
  returning id into v_id;
  return v_id;
end;
$$;

-- 5. mark_mail_read(agent_name) — позначити всі непрочитані як прочитані
create or replace function mark_mail_read(p_agent text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update agent_mail
  set read_at = now()
  where to_agent = p_agent
    and read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- 6. Execute — тільки service_role (anon key публічний)
revoke execute on function check_pending_limit(uuid, int) from public, anon, authenticated;
revoke execute on function send_mail(text, text, text, text, mail_type, int, uuid, uuid) from public, anon, authenticated;
revoke execute on function mark_mail_read(text) from public, anon, authenticated;

grant execute on function check_pending_limit(uuid, int) to service_role;
grant execute on function send_mail(text, text, text, text, mail_type, int, uuid, uuid) to service_role;
grant execute on function mark_mail_read(text) to service_role;
