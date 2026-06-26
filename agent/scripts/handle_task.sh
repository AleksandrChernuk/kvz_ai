#!/usr/bin/env bash
# Маршрутизатор (МОЗОК = Claude). Читає TaskPayload зі stdin, ВИРІШУЄ якому
# виконавцю віддати, і делегує. Сам відповіді НЕ формує.
#
# Виконавці (всі під ПІДПИСКОЮ, без API-ключів):
#   codex  → handle_codex.sh   (код, скрипти, розрахунки, технічна робота)
#   gemini → handle_gemini.sh  (знання, довідка, відповіді з бази знань;
#                               fallback на Claude, поки gemini не налаштований)
#
# Передумова: на хості воркера залогінений `claude` CLI (для маршрутизації) і
# виконавчі CLI (`codex login`, `gemini`/`gemini login`). Жодних API-ключів.
#
# Env: CLAUDE_MODEL (роутер, default opus)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_MODEL="${CLAUDE_MODEL:-opus}"

PAYLOAD=$(cat)
USER_MESSAGE=$(echo "$PAYLOAD" | jq -r '.user_message // ""')
AVAILABLE_AGENTS=$(echo "$PAYLOAD" | jq -c '.available_agents // []')

# --- Рішення мозку: codex чи gemini -----------------------------------------
# Claude під підпискою класифікує задачу (виводить рівно одне слово). Якщо
# роутер недоступний/невпевнений — детермінований fallback за сигнальними словами.
EXECUTOR=""
if command -v claude >/dev/null && [ -n "$USER_MESSAGE" ]; then
  ROUTER_SYS="Ти — маршрутизатор задач. Виведи РІВНО одне слово без пояснень: \
codex — якщо це код, скрипт, розрахунок, генерація файлів, технічна робота; \
gemini — якщо це знання, довідка, питання, спілкування."
  set +e
  RJSON=$(printf '%s' "$USER_MESSAGE" | claude -p \
    --model "$CLAUDE_MODEL" --append-system-prompt "$ROUTER_SYS" \
    --output-format json --allowed-tools "" 2>>/tmp/kvz-router.log)
  set -e
  EXECUTOR=$(printf '%s' "$RJSON" | jq -r '.result // empty' 2>/dev/null \
    | tr '[:upper:]' '[:lower:]' | grep -oE 'codex|gemini' | head -1)
fi

if [ -z "$EXECUTOR" ]; then
  case "$(printf '%s' "$USER_MESSAGE" | tr '[:upper:]' '[:lower:]')" in
    *код*|*скрипт*|*функці*|*програм*|*debug*|*деба*|*баг*|*refactor*|*implement*|*python*|*javascript*|*typescript*|*розрахуй*|*порахуй*|*обчисл*|*ilogic*)
      EXECUTOR="codex" ;;
    *) EXECUTOR="gemini" ;;
  esac
fi

# Доступ ролі до агента codex (інакше — знання)
if [ "$EXECUTOR" = "codex" ]; then
  echo "$AVAILABLE_AGENTS" | jq -e '.[] | select(.key == "codex")' >/dev/null 2>&1 || EXECUTOR="gemini"
fi

# --- Делегування (fail-soft: codex впав → виконавець знань) ------------------
if [ "$EXECUTOR" = "codex" ] && command -v codex >/dev/null; then
  if out=$(printf '%s' "$PAYLOAD" | "$SCRIPT_DIR/handle_codex.sh" 2>>/tmp/kvz-codex.log); then
    printf '%s' "$out"
    exit 0
  fi
  echo "codex виконавець впав — делегуємо виконавцю знань" >&2
fi

printf '%s' "$PAYLOAD" | "$SCRIPT_DIR/handle_gemini.sh"
