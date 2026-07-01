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
    '{user_message:$m, user_role:"engineer", available_agents:$a, available_connectors:[]}' \
    | "$SCRIPTS_DIR/handle_task.sh"
}

run_agents() { # $1 = user_message, $2 = available_agents JSON
  jq -n --arg m "$1" --argjson a "$2" \
    '{user_message:$m, user_role:"engineer", available_agents:$a, available_connectors:[]}' \
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

# 10. Резюме після підтвердження (approval-resume, H1): попередній preview
#     (крок s2 — held, запис у bitrix) резюмиться з тим самим планом і тепер
#     реально виконує s2; s1 (вже ok) НЕ перевиконується (ідемпотентність);
#     requires_approval знято; план не перепланований.
out=$(run "порахуй вагу та запиши угоду в bitrix" 2>/dev/null)
plan=$(echo "$out" | jq -c '.raw_result.plan')
sub=$(echo "$out" | jq -c '.raw_result.sub_results')

CH=$(mktemp)
resumed=$(jq -n --arg m "порахуй вагу та запиши угоду в bitrix" --argjson a "$AGENTS" \
    --argjson plan "$plan" --argjson sub "$sub" \
  '{user_message:$m, user_role:"engineer", available_agents:$a, available_connectors:[],
    resume:{plan:$plan, sub_results:$sub}}' \
  | CODEX_HIT_FILE="$CH" "$SCRIPTS_DIR/handle_task.sh" 2>/dev/null)
hits=$(wc -l < "$CH" | tr -d ' '); rm -f "$CH"

echo "$resumed" | jq -e '.requires_approval == false' >/dev/null 2>&1 \
  && pass "резюме: requires_approval знято" || die "резюме: requires_approval лишився true"
echo "$resumed" | jq -e '.raw_result.sub_results[] | select(.id=="s2") | .status == "ok"' >/dev/null 2>&1 \
  && pass "резюме: раніше held-крок s2 реально виконано" || die "резюме: s2 не виконано"
echo "$resumed" | jq -e '.raw_result.sub_results[] | select(.id=="s2") | .answer | length > 0' >/dev/null 2>&1 \
  && pass "резюме: s2 має відповідь" || die "резюме: s2 без відповіді"
[ "$hits" = "1" ] \
  && pass "резюме: лише 1 виклик codex (s1 не перевиконано)" \
  || die "резюме: очікувався 1 виклик codex для s2, отримано $hits"
echo "$resumed" | jq -e --argjson p "$plan" '.raw_result.plan == $p' >/dev/null 2>&1 \
  && pass "резюме: план не перепланований (той самий об'єкт)" || die "резюме: план змінився"

# 11. Гейт токенів синтезу (M1) + чесний fallback для провалених кроків (M2):
#     TOKEN_LIMIT=1 занадто малий навіть для самого user_message → синтез-LLM
#     НЕ викликається (fallback без крашу); той самий TOKEN_LIMIT валить обидва
#     sub-payload-гейти (кроки failed); детермінований fallback явно позначає
#     провал кожного кроку, а не мовчки лишає порожній bullet.
out=$(TOKEN_LIMIT=1 run "порахуй вагу та підбери обладнання" 2>/dev/null)
echo "$out" | jq -e '.answer | length > 0' >/dev/null 2>&1 \
  && pass "гейт синтезу: fallback не крашнувся, відповідь непорожня" || die "гейт синтезу: відповідь порожня"
echo "$out" | jq -e '.requires_approval == false' >/dev/null 2>&1 \
  && pass "гейт синтезу: requires_approval лишився false" || die "гейт синтезу: неочікуваний approval"
echo "$out" | jq -e '.answer | test("не вдалося виконати")' >/dev/null 2>&1 \
  && pass "fallback чесно позначає провалені кроки (M2)" || die "fallback приховує провал кроку"

if [ "$fail" -ne 0 ]; then
  echo "orchestrate_test: ПРОВАЛЕНО" >&2
  exit 1
fi
echo "orchestrate_test: усі перевірки пройдено"
