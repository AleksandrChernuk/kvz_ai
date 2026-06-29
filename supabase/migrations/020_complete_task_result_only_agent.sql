-- ============================================================
-- 020: complete_task — звільнити result-only маркери від перевірки доступу
--
-- Міграція 019 додала enum-значення agent_type='orchestrated' — маркер синтезу,
-- який НЕ є маршрутизованим виконавцем (його немає в каталозі agents). Жива
-- complete_task (016) перевіряє can_role_access_agent(role, agent) і кидає
-- виняток для будь-якого agent поза матрицею доступів. Тож кожна orchestrated-
-- задача падала б на завершенні: «Agent orchestrated is not allowed for role …».
--
-- Доступ до РЕАЛЬНИХ виконавців під-задач (codex/gemini) уже перевірено при
-- маршрутизації в оркестраторі; сам маркер синтезу доступу не потребує. Тому
-- result-only агенти звільняються від перевірки, решта інваріантів незмінні.
--
-- ЦЕ ТЕПЕР ЄДИНЕ ЖИВЕ визначення complete_task (перевизначає 016). Інваріанти:
--   1. lock-ownership: locked_by = p_worker_id
--   2. running-guard: status = 'running' (+ if not found raise)
--   3. approval-gate: approval_required ⇒ approved_at not null
--   4. approval-binding: approved ⇒ result = approved result
--   5. agent-access: agent not null AND (result-only OR can_role_access_agent)
--   6. empty-answer: result.answer не порожній
-- Окрема міграція (не 019), бо нове enum-значення не можна вживати в одній
-- транзакції з ALTER TYPE ADD VALUE.
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
  v_task tasks%rowtype;
  v_role user_role;
  v_agent agent_type;
  -- Маркери результату, що НЕ є маршрутизованими виконавцями (немає в каталозі
  -- agents). Доступ до фактичних виконавців перевірено при маршрутизації.
  v_result_only agent_type[] := array['orchestrated']::agent_type[];
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

  if v_agent <> all (v_result_only) and not can_role_access_agent(v_role, v_agent) then
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
