create table threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  title text default 'Новий чат',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid references threads(id) on delete cascade not null,
  role text check (role in ('user', 'assistant', 'system')) not null,
  content text not null,
  task_id uuid,
  created_at timestamptz default now()
);

alter table threads enable row level security;
alter table messages enable row level security;

create policy "users own threads" on threads for all using (auth.uid() = user_id);
create policy "users see own messages" on messages for all using (
  exists (select 1 from threads where id = thread_id and user_id = auth.uid())
);
