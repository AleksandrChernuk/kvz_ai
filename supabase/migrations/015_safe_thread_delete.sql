-- ============================================================
-- 015: безпечне видалення thread
--
-- Thread не можна видалити, якщо в ньому є активні задачі. Інакше cascade
-- delete може прибрати running/pending/awaiting_approval task під воркером.
-- ============================================================

create or replace function delete_thread_safely(p_thread_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread threads;
begin
  select * into v_thread
  from threads
  where id = p_thread_id
  for update;

  if not found then
    raise exception 'Thread % not found', p_thread_id;
  end if;

  if v_thread.user_id is distinct from auth.uid() and not is_admin() then
    raise exception 'Not allowed to delete thread %', p_thread_id;
  end if;

  if exists (
    select 1
    from tasks
    where thread_id = p_thread_id
      and status in ('pending', 'running', 'awaiting_approval')
  ) then
    raise exception 'Thread % has active tasks', p_thread_id;
  end if;

  delete from threads where id = p_thread_id;
end;
$$;

revoke execute on function delete_thread_safely(uuid) from public, anon;
grant execute on function delete_thread_safely(uuid) to authenticated;
