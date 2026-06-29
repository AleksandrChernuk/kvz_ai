-- 022: реєстрація MCP-конектора NotebookLM для агентів підбору.
--
-- Неофіційний NotebookLM MCP працює як read-only KB/query connector:
-- kvz-ai не зберігає Google-секрети, а лише маршрутизує до mcp_server.
-- Сесія Google матеріалізується на хості воркера/конектора окремо.

do $$
declare
  v_id uuid;
begin
  select id into v_id from knowledge_bases
  where mcp_server = 'notebooklm-selection'
    and mcp_config->>'purpose' = 'selection';

  if v_id is null then
    insert into knowledge_bases (name, description, mcp_server, mcp_config, enabled)
    values (
      'Підбір NotebookLM',
      'NotebookLM MCP для підбору рішень за підключеними notebooks. Неофіційний read-only конектор.',
      'notebooklm-selection',
      jsonb_build_object(
        'kind', 'notebooklm',
        'purpose', 'selection',
        'connector_class', 'read-only-kb',
        'runtime', 'notebooklm-mcp-server'
      ),
      true
    )
    returning id into v_id;
  else
    update knowledge_bases
    set
      name = 'Підбір NotebookLM',
      description = 'NotebookLM MCP для підбору рішень за підключеними notebooks. Неофіційний read-only конектор.',
      mcp_config = jsonb_build_object(
        'kind', 'notebooklm',
        'purpose', 'selection',
        'connector_class', 'read-only-kb',
        'runtime', 'notebooklm-mcp-server'
      ),
      enabled = true
    where id = v_id;
  end if;

  insert into knowledge_base_role_access (knowledge_base_id, role)
  values
    (v_id, 'admin'),
    (v_id, 'manager'),
    (v_id, 'engineer')
  on conflict do nothing;
end $$;
