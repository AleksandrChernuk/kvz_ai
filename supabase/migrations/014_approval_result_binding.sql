-- ============================================================
-- 014: approved task must complete the exact approved result
--
-- Людина підтверджує preview/result, збережений у tasks.result під час
-- request_approval(). Після approve worker не має права завершити задачу
-- іншим JSON-result, навіть якщо handler/адаптер помилково згенерував новий.
-- ============================================================

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
  v_task tasks;
begin
  select * into v_task from tasks where id = p_task_id for update;
  if not found then
    raise exception 'Task % not found', p_task_id;
  end if;

  if v_task.approval_required then
    if v_task.approved_at is null then
      raise exception 'Task % requires approval before completion', p_task_id;
    end if;

    if v_task.result is null or v_task.result <> p_result then
      raise exception 'Task % completion result does not match approved result', p_task_id;
    end if;
  end if;

  update tasks set
    status     = 'done',
    result     = p_result,
    agent      = coalesce(p_agent, agent),
    locked_at  = null,
    locked_by  = null,
    updated_at = now()
  where id = p_task_id
    and locked_by = p_worker_id
    and status = 'running'
  returning * into v_task;

  if not found then
    raise exception 'Task % not owned by worker % or not in running state', p_task_id, p_worker_id;
  end if;

  if coalesce(p_result->>'answer', '') = '' then
    raise exception 'result.answer is empty for task %', p_task_id;
  end if;

  insert into messages (thread_id, role, content, task_id)
  values (v_task.thread_id, 'assistant', p_result->>'answer', p_task_id);

  update threads set updated_at = now() where id = v_task.thread_id;
end;
$$;

revoke execute on function complete_task(uuid, text, jsonb, agent_type) from public, anon, authenticated;
grant execute on function complete_task(uuid, text, jsonb, agent_type) to service_role;
