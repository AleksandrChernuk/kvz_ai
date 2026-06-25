-- ============================================================
-- 010: atomic chat enqueue
--   Один transactional RPC для:
--   - per-user active task limit з advisory transaction lock
--   - insert user message
--   - insert pending task
--   - link message.task_id
--   - thread title/update
-- ============================================================

create or replace function enqueue_chat_task(
  p_user_id uuid,
  p_thread_id uuid,
  p_content text,
  p_payload jsonb,
  p_title text default null,
  p_max_active int default 5
)
returns table(message_id uuid, task_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message_id uuid;
  v_task_id uuid;
  v_active_count int;
  v_is_first_message boolean;
begin
  if p_max_active < 1 or p_max_active > 100 then
    raise exception 'INVALID_ACTIVE_TASK_LIMIT';
  end if;

  if coalesce(btrim(p_content), '') = '' then
    raise exception 'EMPTY_CONTENT';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  perform 1 from threads
  where id = p_thread_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'THREAD_NOT_FOUND';
  end if;

  select count(*) into v_active_count
  from tasks
  where user_id = p_user_id
    and status in ('pending', 'running');

  if v_active_count >= p_max_active then
    raise exception 'ACTIVE_TASK_LIMIT_EXCEEDED';
  end if;

  select not exists (
    select 1 from messages where thread_id = p_thread_id
  ) into v_is_first_message;

  insert into messages (thread_id, role, content)
  values (p_thread_id, 'user', p_content)
  returning id into v_message_id;

  insert into tasks (
    thread_id,
    message_id,
    user_id,
    status,
    payload
  )
  values (
    p_thread_id,
    v_message_id,
    p_user_id,
    'pending',
    p_payload
  )
  returning id into v_task_id;

  update messages
  set task_id = v_task_id
  where id = v_message_id;

  update threads
  set
    title = case
      when v_is_first_message and title is null and p_title is not null
        then p_title
      else title
    end,
    updated_at = now()
  where id = p_thread_id;

  message_id := v_message_id;
  task_id := v_task_id;
  return next;
end;
$$;

revoke execute on function enqueue_chat_task(uuid, uuid, text, jsonb, text, int)
  from public, anon, authenticated;
grant execute on function enqueue_chat_task(uuid, uuid, text, jsonb, text, int)
  to service_role;
