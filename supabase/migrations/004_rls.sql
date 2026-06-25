-- Realtime для фронту
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table tasks;

-- Функція оновлення updated_at
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger tasks_updated_at before update on tasks
  for each row execute function update_updated_at();

create trigger threads_updated_at before update on threads
  for each row execute function update_updated_at();

-- Майбутня функція для атомарного захоплення задачі воркером
-- (щоб два інстанси Claude Code не взяли одну задачу)
create or replace function claim_next_task(worker_id text)
returns setof tasks as $$
  update tasks
  set status = 'running',
      locked_at = now(),
      locked_by = worker_id
  where id = (
    select id from tasks
    where status = 'pending'
      and (locked_at is null or locked_at < now() - interval '5 minutes')
    order by priority desc, created_at asc
    for update skip locked
    limit 1
  )
  returning *;
$$ language sql;
