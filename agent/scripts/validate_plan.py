#!/usr/bin/env python3
"""Детермінований валідатор плану декомпозиції — БЕЗ ШІ.

Роутер (Claude) розбиває запит на під-задачі. Перш ніж виконувати план, його
треба перевірити чисто структурно (однаковий вхід → однаковий вердикт на будь-якій
машині): жодних моделей, жодних API. Це запобіжник між «модель щось напланувала» і
«воркер це виконує».

Формат плану (stdin або --file):

  {"steps": [
    {"id": "s1", "executor": "codex",  "prompt": "...", "depends_on": []},
    {"id": "s2", "executor": "gemini", "prompt": "...", "depends_on": []},
    {"id": "s3", "executor": "codex",  "prompt": "...", "depends_on": ["s1","s2"]}
  ]}

Правила (фіксовані, не змінювати без бампа PLAN_VALIDATOR_VERSION):
  - steps — непорожній список, не більше MAX_STEPS кроків;
  - кожен крок: id (унікальний непорожній рядок), executor ∈ {codex, gemini},
    prompt (непорожній рядок), depends_on (список наявних id, без self-ref);
  - граф залежностей ацикличний (топологічне сортування проходить).

Один крок — валідно (це сигнал «не декомпозувати», роутер падає на одно-виконавчий
шлях). Вивід при успіху містить кількість кроків і топологічний порядок.

Використання:
  echo '{"steps":[...]}' | python3 validate_plan.py
  python3 validate_plan.py --file plan.json
  python3 validate_plan.py --self-test

Exit codes:
  0 — план валідний (stdout: {"ok":true,"steps":N,"order":[...]})
  1 — план невалідний (stdout: {"ok":false,"reason":...})
  2 — некоректний вхід (не JSON / не обʼєкт)
"""

import argparse
import json
import os
import re
import sys

# id кроку: лише [A-Za-z0-9_] — бо воркер веде членство через рядкові переліки
# (`case "$done_ids" in *" $id "*`); пробіл/спецсимвол в id зламав би облік.
_ID_RE = re.compile(r"^[A-Za-z0-9_]{1,32}$")

PLAN_VALIDATOR_VERSION = 1

# Межа кроків — запобіжник від розповзання плану. Можна звузити через
# PLAN_MAX_STEPS (напр. воркер), але ніколи не розширити понад фіксований стелю.
_HARD_MAX_STEPS = 6
try:
    MAX_STEPS = min(_HARD_MAX_STEPS, int(os.environ.get("PLAN_MAX_STEPS", _HARD_MAX_STEPS)))
except ValueError:
    MAX_STEPS = _HARD_MAX_STEPS
if MAX_STEPS < 1:
    MAX_STEPS = _HARD_MAX_STEPS
ALLOWED_EXECUTORS = {"codex", "gemini"}


def _fail(reason: str) -> dict:
    return {"ok": False, "reason": reason, "plan_validator_version": PLAN_VALIDATOR_VERSION}


def _topo_order(steps: list[dict]) -> list[str] | None:
    """Повертає топологічний порядок id або None, якщо є цикл (Kahn)."""
    remaining = {s["id"]: set(s.get("depends_on") or []) for s in steps}
    order: list[str] = []
    while remaining:
        ready = sorted(sid for sid, deps in remaining.items() if not deps)
        if not ready:
            return None  # цикл: жоден крок не готовий
        for sid in ready:
            order.append(sid)
            del remaining[sid]
        for deps in remaining.values():
            deps.difference_update(ready)
    return order


def validate_plan(plan: dict) -> dict:
    steps = plan.get("steps")
    if not isinstance(steps, list) or not steps:
        return _fail("steps має бути непорожнім списком")
    if len(steps) > MAX_STEPS:
        return _fail(f"забагато кроків ({len(steps)} > {MAX_STEPS})")

    ids: set[str] = set()
    for i, s in enumerate(steps):
        if not isinstance(s, dict):
            return _fail(f"крок #{i} не обʼєкт")
        sid = s.get("id")
        if not isinstance(sid, str) or not sid.strip():
            return _fail(f"крок #{i}: відсутній id")
        if not _ID_RE.match(sid):
            return _fail(f"крок #{i}: id має бути [A-Za-z0-9_], ≤32 символи")
        if sid in ids:
            return _fail(f"повторюваний id: {sid}")
        ids.add(sid)
        if s.get("executor") not in ALLOWED_EXECUTORS:
            return _fail(f"крок {sid}: executor має бути одним із {sorted(ALLOWED_EXECUTORS)}")
        prompt = s.get("prompt")
        if not isinstance(prompt, str) or not prompt.strip():
            return _fail(f"крок {sid}: порожній prompt")
        dep = s.get("depends_on", [])
        if not isinstance(dep, list):
            return _fail(f"крок {sid}: depends_on має бути списком")
        for d in dep:
            if not isinstance(d, str):
                return _fail(f"крок {sid}: depends_on містить не-рядок")
            if d == sid:
                return _fail(f"крок {sid}: залежить сам від себе")

    for s in steps:
        for d in s.get("depends_on") or []:
            if d not in ids:
                return _fail(f"крок {s['id']}: невідома залежність {d}")

    order = _topo_order(steps)
    if order is None:
        return _fail("цикл у залежностях")

    return {
        "ok": True,
        "steps": len(steps),
        "order": order,
        "plan_validator_version": PLAN_VALIDATOR_VERSION,
    }


def _self_test() -> int:
    cases = [
        ({"steps": [{"id": "s1", "executor": "codex", "prompt": "порахуй", "depends_on": []}]}, True),
        ({"steps": [
            {"id": "s1", "executor": "codex", "prompt": "вага", "depends_on": []},
            {"id": "s2", "executor": "gemini", "prompt": "обладнання", "depends_on": []},
            {"id": "s3", "executor": "codex", "prompt": "dxf", "depends_on": ["s1", "s2"]},
        ]}, True),
        ({"steps": []}, False),
        ({"steps": "x"}, False),
        ({"steps": [{"id": "s1", "executor": "openai", "prompt": "x", "depends_on": []}]}, False),
        ({"steps": [{"id": "s1", "executor": "codex", "prompt": "", "depends_on": []}]}, False),
        ({"steps": [
            {"id": "s1", "executor": "codex", "prompt": "x", "depends_on": []},
            {"id": "s1", "executor": "codex", "prompt": "y", "depends_on": []},
        ]}, False),
        ({"steps": [{"id": "s1", "executor": "codex", "prompt": "x", "depends_on": ["s9"]}]}, False),
        ({"steps": [
            {"id": "s1", "executor": "codex", "prompt": "x", "depends_on": ["s2"]},
            {"id": "s2", "executor": "codex", "prompt": "y", "depends_on": ["s1"]},
        ]}, False),
        ({"steps": [{"id": "s1", "executor": "codex", "prompt": "x", "depends_on": ["s1"]}]}, False),
        ({"steps": [
            {"id": f"s{i}", "executor": "codex", "prompt": "x", "depends_on": []}
            for i in range(MAX_STEPS + 1)
        ]}, False),
        # depends_on містить не-рядок
        ({"steps": [{"id": "s1", "executor": "codex", "prompt": "x", "depends_on": [1]}]}, False),
        # id лише з пробілів (strip → порожній)
        ({"steps": [{"id": "   ", "executor": "codex", "prompt": "x", "depends_on": []}]}, False),
        # id з пробілом усередині (зламав би членство в done_ids)
        ({"steps": [{"id": "s 1", "executor": "codex", "prompt": "x", "depends_on": []}]}, False),
        # 3-вузловий цикл (Kahn має зловити, не лише 2-цикл)
        ({"steps": [
            {"id": "s1", "executor": "codex", "prompt": "x", "depends_on": ["s3"]},
            {"id": "s2", "executor": "codex", "prompt": "y", "depends_on": ["s1"]},
            {"id": "s3", "executor": "codex", "prompt": "z", "depends_on": ["s2"]},
        ]}, False),
        # depends_on не список
        ({"steps": [{"id": "s1", "executor": "codex", "prompt": "x", "depends_on": "s2"}]}, False),
    ]
    failed = 0
    for inp, expect_ok in cases:
        got = validate_plan(inp)["ok"]
        if got != expect_ok:
            failed += 1
            print(f"FAIL: {inp} -> {got}, expected {expect_ok}", file=sys.stderr)
    # топологічний порядок коректний для валідного багатокрокового плану
    order = validate_plan({"steps": [
        {"id": "s3", "executor": "codex", "prompt": "dxf", "depends_on": ["s1", "s2"]},
        {"id": "s1", "executor": "codex", "prompt": "вага", "depends_on": []},
        {"id": "s2", "executor": "gemini", "prompt": "обладнання", "depends_on": []},
    ]}).get("order")
    if order != ["s1", "s2", "s3"]:
        failed += 1
        print(f"FAIL: order {order} != ['s1','s2','s3']", file=sys.stderr)
    if failed:
        print(f"{failed} self-test(s) failed", file=sys.stderr)
        return 1
    print("all self-tests passed")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Детермінований валідатор плану")
    ap.add_argument("--file", help="JSON-файл з планом; інакше stdin")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args()

    if args.self_test:
        return _self_test()

    raw = open(args.file, encoding="utf-8").read() if args.file else sys.stdin.read()
    try:
        plan = json.loads(raw)
    except json.JSONDecodeError as e:
        print(json.dumps(_fail(f"Некоректний JSON: {e}"), ensure_ascii=False))
        return 2
    if not isinstance(plan, dict):
        print(json.dumps(_fail("Очікувався обʼєкт"), ensure_ascii=False))
        return 2

    verdict = validate_plan(plan)
    print(json.dumps(verdict, ensure_ascii=False))
    return 0 if verdict["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
