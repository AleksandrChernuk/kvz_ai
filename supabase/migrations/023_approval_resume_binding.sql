-- ============================================================
-- 023: approval binding — allow resumed orchestrated result
--
-- 014/020 bound complete_task to an EXACT match between the approved
-- preview (tasks.result, set by request_approval) and the completing
-- result. That was correct for "re-deliver the same preview verbatim"
-- but blocks the actual fix for approval-resume: after a human approves,
-- the worker must re-invoke the orchestrator to really RUN the
-- previously-held (irreversible) steps, which necessarily produces a
-- different final answer than the preview (the preview never contained
-- their output — they were never executed).
--
-- The safety property that must hold is not "final text is identical to
-- the preview" — it's "the plan shown to the human is the plan that ran,
-- and it's no longer sitting on a fresh, unapproved hold". So exact
-- match is still accepted (unchanged fallback path), but an orchestrated
-- resume is also accepted when: same agent_used, same plan
-- (raw_result.plan, deep jsonb equality — order-independent), and the
-- resumed result no longer requires approval.
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
  v_result_only agent_type[] := array['orchestrated']::agent_type[];
  v_is_resume boolean;
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

    if v_task.result is null then
      raise exception 'Task % completion result does not match approved result', p_task_id;
    end if;

    v_is_resume :=
      v_task.result->>'agent_used' = 'orchestrated'
      and p_result->>'agent_used' = 'orchestrated'
      and coalesce(p_result->>'requires_approval', 'true') = 'false'
      and v_task.result->'raw_result'->'plan' is not null
      and v_task.result->'raw_result'->'plan' = p_result->'raw_result'->'plan';

    if v_task.result <> p_result and not v_is_resume then
      raise exception 'Task % completion result does not match approved result', p_task_id;
    end if;
  end if;

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
