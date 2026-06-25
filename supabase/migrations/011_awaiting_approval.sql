-- -----------------------------------------------------------------------
-- Human approval gate before irreversible actions
-- (надсилання ціни клієнту, передача .dxf на верстат, оплата, ...).
--
-- Потік:
--   running --request_approval--> awaiting_approval --approve--> pending
--                                                  \--reject--> cancelled
--
-- Детермінований фільтр (agent/scripts/validate_result.py) виконується
-- ДО цього: спочатку математична перевірка результату, і лише якщо вона
-- пройшла, результат, що веде до незворотної дії, ставиться на підтвердження
-- людини. ШІ не може сам пройти цей гейт.
-- -----------------------------------------------------------------------

-- 1. Новий статус. Окремим стейтментом (psql автокомітить), щоб значення
--    enum було доступне функціям нижче.
alter type task_status add value if not exists 'awaiting_approval';

-- 2. Поля підтвердження.
alter table tasks add column if not exists approval_required boolean default false not null;
alter table tasks add column if not exists approved_at timestamptz;
alter table tasks add column if not exists approved_by uuid references auth.users(id);

-- -----------------------------------------------------------------------
-- request_approval() — воркер, тримаючи лок, ставить задачу на підтвердження.
-- Викликається ТІЛЬКИ після успішного детермінованого фільтра, з прев'ю
-- результату (що саме буде надіслано/виконано).
-- -----------------------------------------------------------------------
create or replace function request_approval(
  p_task_id uuid,
  p_worker_id text,
  p_result jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update tasks set
    status            = 'awaiting_approval',
    result            = p_result,
    approval_required = true,
    locked_at         = null,
    locked_by         = null,
    updated_at        = now()
  where id = p_task_id
    and locked_by = p_worker_id
    and status = 'running';

  if not found then
    raise exception 'Task % not owned by worker % or not running', p_task_id, p_worker_id;
  end if;
end;
$$;

revoke execute on function request_approval(uuid, text, jsonb) from anon, authenticated;
grant execute on function request_approval(uuid, text, jsonb) to service_role;

-- -----------------------------------------------------------------------
-- approve_task() — людина підтверджує. Власник задачі або admin.
-- Повертає задачу в чергу (pending) з відміткою approved_at, щоб воркер
-- перепідняв її і виконав незворотний крок.
-- -----------------------------------------------------------------------
create or replace function approve_task(p_task_id uuid)
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
  if v_task.user_id is distinct from auth.uid() and not is_admin() then
    raise exception 'Not allowed to approve task %', p_task_id;
  end if;
  if v_task.status <> 'awaiting_approval' then
    raise exception 'Task % is not awaiting approval', p_task_id;
  end if;

  update tasks set
    status      = 'pending',
    approved_at = now(),
    approved_by = auth.uid(),
    locked_at   = null,
    locked_by   = null,
    updated_at  = now()
  where id = p_task_id;
end;
$$;

revoke execute on function approve_task(uuid) from anon;
grant execute on function approve_task(uuid) to authenticated;

-- -----------------------------------------------------------------------
-- reject_task() — людина відхиляє. Задача завершується як cancelled.
-- -----------------------------------------------------------------------
create or replace function reject_task(p_task_id uuid, p_reason text default null)
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
  if v_task.user_id is distinct from auth.uid() and not is_admin() then
    raise exception 'Not allowed to reject task %', p_task_id;
  end if;
  if v_task.status <> 'awaiting_approval' then
    raise exception 'Task % is not awaiting approval', p_task_id;
  end if;

  update tasks set
    status     = 'cancelled',
    error      = coalesce(p_reason, 'Відхилено користувачем'),
    locked_at  = null,
    locked_by  = null,
    updated_at = now()
  where id = p_task_id;
end;
$$;

revoke execute on function reject_task(uuid, text) from anon;
grant execute on function reject_task(uuid, text) to authenticated;
