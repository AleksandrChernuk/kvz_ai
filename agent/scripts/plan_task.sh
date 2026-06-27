#!/usr/bin/env bash
# Крок PLAN (МОЗОК = Claude). Читає TaskPayload зі stdin, повертає JSON-план
# декомпозиції на stdout: розбиває запит на впорядковані під-задачі для
# виконавців (codex/gemini). Сам відповіді НЕ формує — лише планує.
#
# Контракт виходу (stdout):
#   {"steps":[{"id":"s1","executor":"codex","prompt":"...","depends_on":[]}, ...]}
#
# Проста задача (один намір) → план з ОДНОГО кроку (сигнал «не декомпозувати»).
# Усе під ПІДПИСКОЮ (`claude login`), без API-ключів.
#
# Fail-soft: якщо планувальник недоступний/повернув сміття — друкуємо порожньо
# (rc=1), і викликач падає на одно-виконавчий шлях. Ніколи не вигадуємо план.
#
# Env: CLAUDE_MODEL (default opus), PLAN_MAX_STEPS (default 6)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_MODEL="${CLAUDE_MODEL:-opus}"
PLAN_MAX_STEPS="${PLAN_MAX_STEPS:-6}"

PAYLOAD=$(cat)
USER_MESSAGE=$(echo "$PAYLOAD" | jq -r '.user_message // ""')

[ -n "$USER_MESSAGE" ] || exit 1
command -v claude >/dev/null || exit 1

PLAN_SYS="Ти — планувальник задач інженерної системи КВЗ. Розбий запит користувача \
на впорядковані під-задачі й виведи РІВНО один JSON-обʼєкт без markdown, без пояснень:
{\"steps\":[{\"id\":\"s1\",\"executor\":\"codex|gemini\",\"prompt\":\"<під-задача українською>\",\"depends_on\":[]}]}
Правила:
- executor=codex для коду, скриптів, розрахунків, генерації файлів, технічної роботи;
- executor=gemini для знань, довідки, питань, підбору з бази знань;
- depends_on — список id кроків, від яких залежить цей крок (порядок виконання);
- id унікальні; не більше $PLAN_MAX_STEPS кроків; без циклів;
- НЕОБОВ'ЯЗКОВО додай крокові поле \"validation\":{\"kind\":\"weight|selection|ilogic|dxf|json\", ...} \
з ОЧІКУВАНИМИ обмеженнями, якщо результат кроку має пройти детерміновану перевірку \
(напр. розрахунок ваги). Конкретні числа дасть виконавець — не вигадуй їх сам;
- ЯКЩО задача проста (один намір) — поверни РІВНО один крок.
Нічого, окрім JSON, не виводь."

set +e
RJSON=$(printf '%s' "$USER_MESSAGE" | claude -p \
  --model "$CLAUDE_MODEL" --append-system-prompt "$PLAN_SYS" \
  --output-format json --allowed-tools "" 2>>/tmp/kvz-planner.log)
set -e

# Витягуємо текст відповіді й вичищаємо можливі ```json-огорожі.
PLAN=$(printf '%s' "$RJSON" | jq -r '.result // empty' 2>/dev/null \
  | sed -e 's/^```json//' -e 's/^```//' -e 's/```$//')
[ -n "$PLAN" ] || exit 1

# Лишаємо тільки JSON-обʼєкт (від першої { до останньої }).
PLAN=$(printf '%s' "$PLAN" | tr -d '\000' | sed -n '/{/,/}/p')
PLAN=$(printf '%s' "$PLAN" | jq -c '{steps: (.steps // [])}' 2>/dev/null) || exit 1

# Детермінована перевірка структури плану (БЕЗ ШІ). Невалідний → fail-soft.
set +e
printf '%s' "$PLAN" | PLAN_MAX_STEPS="$PLAN_MAX_STEPS" \
  python3 "$SCRIPT_DIR/validate_plan.py" >/dev/null 2>&1
VRC=$?
set -e
[ "$VRC" -eq 0 ] || exit 1

printf '%s' "$PLAN"
