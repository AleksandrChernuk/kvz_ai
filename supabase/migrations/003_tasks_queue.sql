-- Статуси задачі
create type task_status as enum ('pending', 'running', 'done', 'failed', 'cancelled');

-- Агенти — розширюється при додаванні нових
create type agent_type as enum ('codex', 'search', 'drive', 'bitrix', 'email');

create table tasks (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid references threads(id) on delete cascade not null,
  message_id uuid references messages(id),
  user_id uuid references auth.users(id) not null,

  -- Черга для оркестратора
  status task_status default 'pending' not null,
  priority int default 0,               -- майбутнє: пріоритет задачі
  agent agent_type,                      -- який субагент виконує

  -- Payload: що передається оркестратору
  -- структура: { user_message, user_role, thread_context, metadata }
  payload jsonb default '{}' not null,

  -- Результат від оркестратора
  -- структура: { answer, agent_used, steps[], raw_result }
  result jsonb,

  error text,

  -- Для майбутнього воркера: щоб не брати одну задачу двічі
  locked_at timestamptz,
  locked_by text,                        -- ідентифікатор воркера/інстансу

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Індекс для polling воркера
create index tasks_status_idx on tasks(status) where status = 'pending';
create index tasks_thread_idx on tasks(thread_id);

alter table tasks enable row level security;

-- Юзер бачить свої задачі
create policy "users see own tasks" on tasks
  for select using (auth.uid() = user_id);

-- Admin бачить всі
create policy "admin sees all tasks" on tasks
  for select using (
    exists (select 1 from profiles where user_id = auth.uid() and role = 'admin')
  );

-- Next.js API може створювати тільки задачі поточного користувача.
-- Service role воркера на VPS обходить RLS через SUPABASE_SERVICE_ROLE_KEY.
create policy "users insert own tasks" on tasks
  for insert with check (auth.uid() = user_id);

-- Admin може скасовувати/оновлювати задачі через API; воркер service role обходить RLS.
create policy "admin updates tasks" on tasks
  for update using (
    exists (select 1 from profiles where user_id = auth.uid() and role = 'admin')
  )
  with check (
    exists (select 1 from profiles where user_id = auth.uid() and role = 'admin')
  );
