-- ============================================================
-- 024: NotebookLM — рольовий доступ по конкретних notebooks + фікс runtime
--
-- Конектор мігрував з `notebooklm-mcp-server` (cookie-скрапінг, ламкий auth)
-- на `notebooklm-mcp` (PleasePrompto, персистентний Chrome-профіль). Ця
-- міграція:
--   1) виправляє застаріле mcp_config.runtime на рядку-пікері (data-дрейф
--      з міграції 022, яку не можна редагувати після застосування);
--   2) додає ідемпотентний helper для реєстрації ОКРЕМОГО notebook як
--      власного knowledge_bases-рядка, гейтованого під конкретні ролі.
--
-- Модель: один конектор (mcp_server='notebooklm-selection') обслуговує багато
-- notebooks; кожен notebook = окремий KB-рядок із mcp_config.notebook_id,
-- як kb-docs роздає бібліотеки через mcp_config.library. Доступ по ролі йде
-- через knowledge_base_role_access (тригер 017 синкає allowed_roles).
-- ============================================================

-- 1. Data-фікс: актуалізувати runtime на рядку вільного вибору ("селектор").
update knowledge_bases
set mcp_config = mcp_config || jsonb_build_object('runtime', 'notebooklm-mcp')
where mcp_server = 'notebooklm-selection'
  and mcp_config->>'purpose' = 'selection'
  and mcp_config->>'runtime' is distinct from 'notebooklm-mcp';

-- 2. Helper: зареєструвати/оновити один notebook як рольовий KB-рядок.
--    Ідемпотентний по notebook_id у межах конектора notebooklm-selection.
--    security definer + service_role — сідиться з воркера/деплою, не з UI.
create or replace function seed_notebooklm_notebook(
  p_name text,
  p_notebook_id text,
  p_roles user_role[],
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if nullif(trim(p_name), '') is null or nullif(trim(p_notebook_id), '') is null then
    raise exception 'p_name and p_notebook_id are required';
  end if;
  if p_roles is null or cardinality(p_roles) = 0 then
    raise exception 'p_roles must not be empty';
  end if;

  select id into v_id
  from knowledge_bases
  where mcp_server = 'notebooklm-selection'
    and mcp_config->>'notebook_id' = trim(p_notebook_id);

  if v_id is null then
    insert into knowledge_bases (name, description, mcp_server, mcp_config, enabled)
    values (
      trim(p_name),
      nullif(trim(p_description), ''),
      'notebooklm-selection',
      jsonb_build_object(
        'kind', 'notebooklm',
        'purpose', 'notebook',
        'connector_class', 'read-only-kb',
        'runtime', 'notebooklm-mcp',
        'notebook_id', trim(p_notebook_id)
      ),
      true
    )
    returning id into v_id;
  else
    update knowledge_bases
    set
      name = trim(p_name),
      description = nullif(trim(p_description), ''),
      mcp_config = mcp_config || jsonb_build_object(
        'purpose', 'notebook',
        'runtime', 'notebooklm-mcp',
        'notebook_id', trim(p_notebook_id)
      ),
      enabled = true
    where id = v_id;
  end if;

  -- Роль-гейт: замінюємо набір ролей на переданий (тригер 017 синкне allowed_roles).
  delete from knowledge_base_role_access where knowledge_base_id = v_id;
  insert into knowledge_base_role_access (knowledge_base_id, role)
  select v_id, unnest(p_roles)
  on conflict (knowledge_base_id, role) do nothing;

  return v_id;
end;
$$;

revoke execute on function seed_notebooklm_notebook(text, text, user_role[], text)
  from public, anon, authenticated;
grant execute on function seed_notebooklm_notebook(text, text, user_role[], text)
  to service_role;

-- 3. Реєстрація реальних notebooks — заповнити ПІСЛЯ seed-логіна конектора
--    (коли `list_notebooks` віддасть справжні notebook_id). Розкоментуй і
--    підстав реальні id + ролі. Приклади (id — плейсхолдери):
--
--   select seed_notebooklm_notebook(
--     'Зварювання (NotebookLM)', '<notebook_id>',
--     array['admin','manager','engineer']::user_role[],
--     'Технічна база зі зварювання, read-only NotebookLM.');
--
--   select seed_notebooklm_notebook(
--     'Комерція (NotebookLM)', '<notebook_id>',
--     array['admin','manager']::user_role[],
--     'Комерційні матеріали, доступ лише менеджерам і адмінам.');
--
-- Примітка (least-privilege): рядок-"селектор" (purpose='selection') дає
-- вільний вибір серед УСІХ notebooks акаунта. Коли зʼявляться рольові рядки
-- вище, варто звузити його доступ до admin, щоб не обходити рольовий гейт:
--   -- delete from knowledge_base_role_access kra using knowledge_bases kb
--   --   where kra.knowledge_base_id = kb.id
--   --     and kb.mcp_server = 'notebooklm-selection'
--   --     and kb.mcp_config->>'purpose' = 'selection'
--   --     and kra.role <> 'admin';
