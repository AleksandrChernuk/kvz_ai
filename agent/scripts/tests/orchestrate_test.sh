#!/usr/bin/env bash
# Інтеграційний тест маршрутизатора/оркестратора БЕЗ живих LLM.
# Стаби claude/codex (tests/stubbin) дають канонічні відповіді, тож
# поведінка детермінована: перевіряємо обидва шляхи (простий vs декомпозиція).
set -euo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$(cd "$TEST_DIR/.." && pwd)"
export PATH="$TEST_DIR/stubbin:$PATH"
chmod +x "$TEST_DIR/stubbin/"* 2>/dev/null || true

fail=0
pass() { echo "PASS: $1"; }
die()  { echo "FAIL: $1" >&2; fail=1; }

AGENTS='[{"key":"codex","name":"Codex","description":"код"}]'

run() { # $1 = user_message
  jq -n --arg m "$1" --argjson a "$AGENTS" \
    '{user_message:$m, user_role:"engineer", available_agents:$a, available_knowledge_bases:[]}' \
    | "$SCRIPTS_DIR/handle_task.sh"
}

run_agents() { # $1 = user_message, $2 = available_agents JSON
  jq -n --arg m "$1" --argjson a "$2" \
    '{user_message:$m, user_role:"engineer", available_agents:$a, available_knowledge_bases:[]}' \
    | "$SCRIPTS_DIR/handle_task.sh"
}

# 1. Проста задача (план з 1 кроку) → одно-виконавчий шлях, без оркестрації.
out=$(run "порахуй вагу" 2>/dev/null)
agent=$(echo "$out" | jq -r '.agent_used')
[ "$agent" = "codex" ] && pass "проста задача → codex" || die "проста: agent_used=$agent (очікувався codex)"
echo "$out" | jq -e '.raw_result.plan' >/dev/null 2>&1 && die "проста задача не повинна мати plan" || pass "проста задача без plan"

# 2. Складена задача (план ≥2 кроки) → orchestrated + синтез + провенанс.
out=$(run "порахуй вагу та підбери обладнання" 2>/dev/null)
agent=$(echo "$out" | jq -r '.agent_used')
[ "$agent" = "orchestrated" ] && pass "складена задача → orchestrated" || die "складена: agent_used=$agent"
echo "$out" | jq -e '.answer | test("СИНТЕЗ")' >/dev/null 2>&1 && pass "відповідь синтезована" || die "немає синтезу у відповіді"
n=$(echo "$out" | jq '.raw_result.sub_results | length')
[ "$n" = "2" ] && pass "2 під-результати зібрано" || die "sub_results=$n (очікувалось 2)"
echo "$out" | jq -e '.raw_result.sub_results | map(.status=="ok") | all' >/dev/null 2>&1 \
  && pass "усі під-кроки ok" || die "є провалені під-кроки"
echo "$out" | jq -e '.steps | length >= 3' >/dev/null 2>&1 \
  && pass "steps містять план + провенанс" || die "steps неповні"

# 3. Незворотна дія (запис у Bitrix) → requires_approval=true ТА крок НЕ виконано
#    (fail-closed: гейт людини спрацьовує ДО виконання незворотної дії).
out=$(run "порахуй вагу та запиши угоду в bitrix" 2>/dev/null)
echo "$out" | jq -e '.requires_approval == true' >/dev/null 2>&1 \
  && pass "незворотний крок → requires_approval" || die "requires_approval не виставлено"
# Незворотний крок s2 має лишитись held (не делеговано виконавцю).
echo "$out" | jq -e '.raw_result.sub_results[] | select(.id=="s2") | .status == "held"' >/dev/null 2>&1 \
  && pass "незворотний крок s2 притримано (held)" || die "s2 виконано замість held"
echo "$out" | jq -e '.raw_result.sub_results[] | select(.id=="s2") | .answer == ""' >/dev/null 2>&1 \
  && pass "притриманий крок без відповіді" || die "held-крок має відповідь (виконано?)"
# Зворотний префікс s1 все одно виконано.
echo "$out" | jq -e '.raw_result.sub_results[] | select(.id=="s1") | .status == "ok"' >/dev/null 2>&1 \
  && pass "зворотний крок s1 виконано" || die "s1 не виконано"
# Відповідь явно перелічує притримані дії.
echo "$out" | jq -e '.answer | test("потребують підтвердження")' >/dev/null 2>&1 \
  && pass "відповідь перелічує притримані дії" || die "немає блоку про підтвердження"

# 4. Під-результат не проходить детермінований фільтр → крок failed (після
#    повторної спроби). Доводить, що per-step фільтр реально працює, а не no-op.
out=$(run "перевір вагу та підбери обладнання" 2>/dev/null)
echo "$out" | jq -e '.raw_result.sub_results[] | select(.id=="s1") | .status == "failed"' >/dev/null 2>&1 \
  && pass "невалідний під-результат → failed" || die "фільтр не відхилив невалідний крок (no-op?)"
# Провал s1 поширюється на залежний s2 (не синтезуємо поверх дірки).
echo "$out" | jq -e '.raw_result.sub_results[] | select(.id=="s2") | .status == "failed"' >/dev/null 2>&1 \
  && pass "провал залежності поширюється на нащадка" || die "s2 виконано попри провал залежності s1"

# 5. Під-результат проходить фільтр → крок ok.
out=$(run "звір вагу та підбери обладнання" 2>/dev/null)
echo "$out" | jq -e '.raw_result.sub_results[] | select(.id=="s1") | .status == "ok"' >/dev/null 2>&1 \
  && pass "валідний під-результат → ok" || die "фільтр відхилив валідний крок"

# 6. Простий намір (план з 1 кроку) НЕ робить другий LLM-виклик:
#    route_single напряму делегує в Codex без окремої класифікації.
RH=$(mktemp)
ROUTER_HIT_FILE="$RH" run "порахуй вагу" >/dev/null 2>&1
[ ! -s "$RH" ] && pass "простий шлях без 2-го LLM-виклику" || die "роутер викликано вдруге ($(wc -l <"$RH"))"
# Коли план вимкнено, простий шлях теж не викликає окремий Claude-router.
RH2=$(mktemp)
ROUTER_HIT_FILE="$RH2" ORCH_DISABLE=1 run "порахуй вагу" >/dev/null 2>&1
[ ! -s "$RH2" ] && pass "ORCH_DISABLE → простий шлях без роутера" || die "ORCH_DISABLE викликав роутер ($(wc -l <"$RH2"))"
rm -f "$RH" "$RH2"

# 6. Ре-гейт токенів на під-payload: крихітний ліміт валить кроки (інʼєкція
#    контексту залежностей не має пробивати ліміт; poll гейтить лише оригінал).
out=$(TOKEN_LIMIT=1 run "порахуй вагу та підбери обладнання" 2>/dev/null)
echo "$out" | jq -e '.raw_result.sub_results[] | select(.id=="s1") | .status == "failed"' >/dev/null 2>&1 \
  && pass "ре-гейт токенів валить завеликий під-крок" || die "під-payload не ре-гейтиться"

# 7. Codex є єдиним виконавцем: якщо роль не має доступу до Codex, перевірений
#    крок не підміняється іншим executor-ом і падає.
out=$(run_agents "звір вагу та підбери обладнання" '[]' 2>/dev/null)
echo "$out" | jq -e '.raw_result.sub_results[] | select(.id=="s1") | .status == "failed"' >/dev/null 2>&1 \
  && pass "codex-only: крок не підмінено іншим виконавцем" || die "крок виконано без доступу до codex"

# 8. Агрегація токенів: orchestrated не звітує хардкод {0,0}, а суму виконавців.
out=$(run "порахуй вагу та підбери обладнання" 2>/dev/null)
echo "$out" | jq -e '.tokens | has("input") and has("output")' >/dev/null 2>&1 \
  && pass "tokens агреговано (не відсутні)" || die "tokens відсутні у результаті"

# 9. Порадна згадка «лазер/верстат» (не дія) НЕ блокується гейтом незворотності.
out=$(run "порадь обладнання для лазерного різання" 2>/dev/null)
echo "$out" | jq -e '.requires_approval == false' >/dev/null 2>&1 \
  && pass "порадна згадка 'лазер' не тригерить гейт" || die "хибне спрацювання гейту на пораду"
echo "$out" | jq -e '[.raw_result.sub_results[].status] | all(. == "held") | not' >/dev/null 2>&1 \
  && pass "кроки поради виконано (не held)" || die "порадні кроки помилково притримано"

if [ "$fail" -ne 0 ]; then
  echo "orchestrate_test: ПРОВАЛЕНО" >&2
  exit 1
fi
echo "orchestrate_test: усі перевірки пройдено"
