-- ============================================================
-- 009: complete_task v2 — транзакційне завершення
--   Раніше: API робив complete_task, потім окремо вставляв
--   assistant message. Якщо вставка падала — задача done,
--   а користувач відповіді не бачив.
--   Тепер: задача + повідомлення + updated_at треду — одна транзакція.
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

-- ACL зберігається при create or replace, але фіксуємо явно
revoke execute on function complete_task(uuid, text, jsonb, agent_type) from public, anon, authenticated;
grant execute on function complete_task(uuid, text, jsonb, agent_type) to service_role;
