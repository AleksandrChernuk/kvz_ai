-- ============================================================
-- 008: Бази знань (MCP-конектори) + рольові фічі
--   Відповіді агентів беруться з підключених баз знань (NotebookLM-подібні
--   та інші MCP-сервери). Кожна база має список ролей, яким доступна.
-- ============================================================

-- 1. Новий тип агента: kb — запити до баз знань
alter type agent_type add value if not exists 'kb';

-- 2. Бази знань
create table if not exists knowledge_bases (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,                 -- що в цій базі; оркестратор обирає за описом
  mcp_server text not null,         -- ключ серверу в agent/.mcp.json
  mcp_config jsonb default '{}' not null,
  allowed_roles user_role[] default '{admin,manager,engineer,viewer}'::user_role[] not null,
  enabled bool default true not null,
  created_at timestamptz default now() not null
);

alter table knowledge_bases enable row level security;

-- Юзер бачить тільки бази, дозволені його ролі
create policy "users see allowed kbs" on knowledge_bases
  for select using (
    enabled and current_user_role() = any(allowed_roles)
  );

create policy "admin manages kbs" on knowledge_bases
  for all using (is_admin()) with check (is_admin());

-- 3. Рольові фічі: який функціонал доступний якій ролі
create table if not exists role_features (
  role user_role not null,
  feature text not null,            -- 'training', 'kb_manage', 'export', …
  enabled bool default true not null,
  primary key (role, feature)
);

alter table role_features enable row level security;

create policy "authenticated read features" on role_features
  for select using (auth.uid() is not null);

create policy "admin manages features" on role_features
  for all using (is_admin()) with check (is_admin());

-- Початкові фічі
insert into role_features (role, feature, enabled) values
  ('admin',    'training',  true),
  ('manager',  'training',  true),
  ('engineer', 'training',  false),
  ('viewer',   'training',  false),
  ('admin',    'kb_manage', true)
on conflict (role, feature) do nothing;
