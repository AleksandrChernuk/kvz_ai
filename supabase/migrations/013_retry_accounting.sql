-- ============================================================
-- 013: послідовний облік retry для fail_task і watchdog
--
-- retry_count рахує використані спроби. Retryable fail або stale-lock
-- release споживає одну спробу; якщо це остання дозволена спроба, задача
-- одразу стає failed, а не pending з retry_count = max_retries.
-- ============================================================

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
    status      = 'pending',
    locked_at   = null,
    locked_by   = null,
    retry_count = retry_count + 1,
    error       = 'Watchdog звільнив задачу після таймауту',
    updated_at  = now()
  where status = 'running'
    and locked_at < now() - (p_timeout_minutes || ' minutes')::interval
    and retry_count + 1 < max_retries;

  get diagnostics v_count = row_count;

  update tasks set
    status      = 'failed',
    locked_at   = null,
    locked_by   = null,
    retry_count = least(retry_count + 1, max_retries),
    error       = 'Перевищено кількість спроб (' || max_retries || ')',
    updated_at  = now()
  where status = 'running'
    and locked_at < now() - (p_timeout_minutes || ' minutes')::interval
    and retry_count + 1 >= max_retries;

  return v_count;
end;
$$;

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

  if v_task.locked_by is distinct from p_worker_id then
    raise exception 'Task % not owned by worker %', p_task_id, p_worker_id;
  end if;

  if p_retry and v_task.retry_count + 1 < v_task.max_retries then
    update tasks set
      status      = 'pending',
      locked_at   = null,
      locked_by   = null,
      retry_count = retry_count + 1,
      error       = p_error,
      updated_at  = now()
    where id = p_task_id;
  elsif p_retry then
    update tasks set
      status      = 'failed',
      locked_at   = null,
      locked_by   = null,
      retry_count = least(retry_count + 1, max_retries),
      error       = p_error,
      updated_at  = now()
    where id = p_task_id;
  else
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

revoke execute on function release_stale_locks(int) from public, anon, authenticated;
revoke execute on function fail_task(uuid, text, text, bool) from public, anon, authenticated;

grant execute on function release_stale_locks(int) to service_role;
grant execute on function fail_task(uuid, text, text, bool) to service_role;

update tasks set
  status      = 'failed',
  retry_count = least(retry_count, max_retries),
  error       = coalesce(error, 'Перевищено кількість спроб (' || max_retries || ')'),
  locked_at   = null,
  locked_by   = null,
  updated_at  = now()
where status = 'pending'
  and retry_count >= max_retries;
