-- ============================================================
-- 012: захист гейту підтвердження на рівні БД + індекси read-шляхів
--
-- 1. complete_task відмовляється завершувати задачу, що вимагає
--    підтвердження людини, але ще не підтверджена (approval_required
--    AND approved_at IS NULL). Раніше це перевіряв лише poll.sh (bash);
--    тепер незворотна дія заблокована транзакційно — витік worker-токена
--    чи баг субагента не обійде людський гейт.
--
-- 2. Індекси під гарячі read-шляхи (messages по треду, threads по юзеру).
--    Без них — seq scan; при 10 юзерах непомітно, але це безкоштовна
--    страховка на майбутнє зростання історії.
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
  -- Бекстоп гейту підтвердження — перед будь-якою зміною стану.
  select * into v_task from tasks where id = p_task_id for update;
  if not found then
    raise exception 'Task % not found', p_task_id;
  end if;
  if v_task.approval_required and v_task.approved_at is null then
    raise exception 'Task % requires approval before completion', p_task_id;
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

-- Індекси read-шляхів
create index if not exists messages_thread_created_idx
  on messages (thread_id, created_at desc);

create index if not exists threads_user_updated_idx
  on threads (user_id, updated_at desc);
