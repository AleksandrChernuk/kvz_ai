-- ============================================================
-- 018: реєстрація ролевих бібліотек конектора kb-docs
--
-- Кожна бібліотека PM (папка data/<library> у конекторі) = окремий рядок
-- knowledge_bases з власним доступом по ролях. mcp_server = 'kb-docs' для всіх;
-- конкретна бібліотека передається через mcp_config.library. Доступ задається
-- junction-таблицею (017-тригер синхронізує allowed_roles).
--
-- Ролі: admin > manager > engineer > viewer. Зварник у цій моделі = engineer/
-- viewer (доступ лише до «Зварювання»); PM = admin (доступ до всіх).
-- ============================================================

-- helper: створити бібліотеку + видати доступ ролям
create or replace function seed_kb_library(
  p_name text,
  p_description text,
  p_library text,
  p_roles user_role[]
)
returns void
language plpgsql
as $$
declare
  v_id uuid;
begin
  select id into v_id from knowledge_bases
  where mcp_server = 'kb-docs' and mcp_config->>'library' = p_library;

  if v_id is null then
    insert into knowledge_bases (name, description, mcp_server, mcp_config, enabled)
    values (
      p_name, p_description, 'kb-docs',
      jsonb_build_object('library', p_library), true
    )
    returning id into v_id;
  end if;

  insert into knowledge_base_role_access (knowledge_base_id, role)
  select v_id, r from unnest(p_roles) as r
  on conflict do nothing;
end;
$$;

select seed_kb_library(
  'Загальна база (kb-docs)',
  'Загальна довідкова база КВЗ: підбір вентиляції тощо. Доступна всім ролям.',
  'zagalna',
  array['admin','manager','engineer','viewer']::user_role[]
);

select seed_kb_library(
  'Зварювання (kb-docs)',
  'База зі зварювання: матеріали, електроди, режими. Для зварників (engineer/viewer).',
  'zvaryuvannya',
  array['admin','engineer','viewer']::user_role[]
);

select seed_kb_library(
  'Фінанси (kb-docs)',
  'Комерційна політика, розрахунок ціни, маржа. Лише для PM та менеджерів.',
  'finansy',
  array['admin','manager']::user_role[]
);

drop function seed_kb_library(text, text, text, user_role[]);
