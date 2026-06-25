-- ============================================================
-- 018: реєстрація конектора kb-docs як бази знань
--
-- mcp_server = 'kb-docs' відповідає ключу в agent/.mcp.json. Доступ усім ролям
-- (read-only довідкова база). Рядки junction-таблиці — джерело правди по
-- доступу; тригер 017 синхронізує allowed_roles автоматично.
-- ============================================================

insert into knowledge_bases (name, description, mcp_server, enabled)
select
  'Документна база (kb-docs)',
  'Внутрішня довідкова база знань КВЗ: підбір вентиляції, комерційна політика, розрахунок ціни. Обирати для довідкових питань («підкажи», «як у нас», «яка політика»).',
  'kb-docs',
  true
where not exists (
  select 1 from knowledge_bases where mcp_server = 'kb-docs'
);

insert into knowledge_base_role_access (knowledge_base_id, role)
select kb.id, r.role
from knowledge_bases kb
cross join (
  values ('admin'::user_role), ('manager'), ('engineer'), ('viewer')
) as r(role)
where kb.mcp_server = 'kb-docs'
on conflict do nothing;
