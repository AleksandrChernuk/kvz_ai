create type user_role as enum ('admin', 'manager', 'engineer', 'viewer');

create table profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade unique not null,
  full_name text,
  role user_role default 'viewer' not null,
  created_at timestamptz default now()
);

alter table profiles enable row level security;
create policy "users see own profile" on profiles for select using (auth.uid() = user_id);
create policy "admin sees all" on profiles for select using (
  exists (select 1 from profiles where user_id = auth.uid() and role = 'admin')
);

create function handle_new_user() returns trigger as $$
begin
  insert into profiles (user_id, full_name) values (new.id, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();
