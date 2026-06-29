#!/usr/bin/env python3
"""Детермінований фільтр результату задачі — НЕ залежить від ШІ взагалі.

Жодних API-викликів і жодної моделі: чиста математика й перевірка формату.
Однаковий вхід завжди дає однаковий результат на будь-якій машині. Це
запобіжник між «агент щось видав» і «це йде людині / на незворотну дію».

Місце у потоці (оркестратор/воркер викликає ПІСЛЯ агента, ДО доставки):

  агент видав result
        │
        ▼
  validate_result.py  ──fail──> fail_task(retry=true): на доробку з поясненням
        │ pass
        ▼
  потрібне підтвердження людини?
        ├── так  → request_approval(result)   (статус awaiting_approval)
        └── ні   → complete_task(result)

Правила перевірок (фіксовані, не змінювати без бампа VALIDATOR_VERSION).
Кожен тип результату має свій валідатор; невідомий тип = fail (safe default).

Використання:
  echo '{"kind":"weight","value":12.5,"unit":"kg"}' | python3 validate_result.py
  python3 validate_result.py --file result.json
  python3 validate_result.py --self-test

Exit codes:
  0 — пройдено
  1 — не пройдено (stdout: JSON {"ok":false,"reason":...})
  2 — некоректний вхід
"""

import argparse
import json
import sys

VALIDATOR_VERSION = 1

# Розумні межі — запобіжник від абсурду, не точна інженерія.
WEIGHT_MIN_KG = 0.0
WEIGHT_MAX_KG = 100_000.0
ALLOWED_WEIGHT_UNITS = {"kg", "kg/m", "t"}

# Заборонені конструкції в iLogic-скриптах (виконання сторонніх команд).
ILOGIC_FORBIDDEN = ("Shell(", "Process.Start", "System.Diagnostics", "Kill(")


def _fail(reason: str) -> dict:
    return {"ok": False, "reason": reason, "validator_version": VALIDATOR_VERSION}


def _ok(extra: dict | None = None) -> dict:
    out = {"ok": True, "validator_version": VALIDATOR_VERSION}
    if extra:
        out.update(extra)
    return out


def validate_weight(r: dict) -> dict:
    """Розрахунок ваги: число в межах, не порожнє, відома одиниця."""
    if "value" not in r:
        return _fail("Відсутнє поле value")
    v = r["value"]
    if not isinstance(v, (int, float)) or isinstance(v, bool):
        return _fail("value не число")
    if not (WEIGHT_MIN_KG < float(v) <= WEIGHT_MAX_KG):
        return _fail(f"value поза межами ({WEIGHT_MIN_KG}; {WEIGHT_MAX_KG}]")
    if r.get("unit") not in ALLOWED_WEIGHT_UNITS:
        return _fail(f"unit має бути одним із {sorted(ALLOWED_WEIGHT_UNITS)}")
    return _ok()


def validate_selection(r: dict) -> dict:
    """Підбір обладнання: модель реально є в каталозі, параметри збігаються з ТЗ."""
    model = r.get("model")
    catalog = r.get("catalog")
    if not isinstance(model, str) or not model.strip():
        return _fail("Відсутня model")
    if not isinstance(catalog, list) or model not in catalog:
        return _fail("model відсутня в каталозі")
    spec = r.get("spec") or {}
    req = r.get("requirements") or {}
    for key, want in req.items():
        if key not in spec:
            return _fail(f"spec не містить параметра {key}")
        # числові параметри — точна збіжність у межах допуску 1%
        if isinstance(want, (int, float)) and not isinstance(want, bool):
            got = spec[key]
            if not isinstance(got, (int, float)) or isinstance(got, bool):
                return _fail(f"параметр {key}: spec не число")
            if want == 0:
                if got != 0:
                    return _fail(f"параметр {key}: очікувалось 0")
            elif abs(float(got) - float(want)) / abs(float(want)) > 0.01:
                return _fail(f"параметр {key}: {got} не збігається з ТЗ {want}")
    return _ok()


def validate_ilogic(r: dict) -> dict:
    """iLogic-скрипт: непорожній, без заборонених команд."""
    code = r.get("code")
    if not isinstance(code, str) or not code.strip():
        return _fail("Порожній скрипт")
    for bad in ILOGIC_FORBIDDEN:
        if bad in code:
            return _fail(f"Заборонена команда: {bad}")
    return _ok()


def validate_dxf(r: dict) -> dict:
    """.dxf: файл створено, не порожній, валідний контейнер (SECTION/EOF)."""
    if not r.get("created"):
        return _fail("Файл не створено")
    size = r.get("size_bytes")
    if not isinstance(size, int) or size <= 0:
        return _fail("Порожній файл")
    content_head = r.get("head", "")
    if "SECTION" not in content_head:
        return _fail("Невалідний формат DXF (немає SECTION)")
    return _ok()


def validate_json(r: dict) -> dict:
    """Будь-який JSON: усі обов'язкові поля присутні."""
    required = r.get("required_fields") or []
    payload = r.get("payload")
    if not isinstance(payload, dict):
        return _fail("payload має бути об'єктом")
    missing = [f for f in required if f not in payload]
    if missing:
        return _fail(f"Відсутні обов'язкові поля: {missing}")
    return _ok()


VALIDATORS = {
    "weight": validate_weight,
    "selection": validate_selection,
    "ilogic": validate_ilogic,
    "dxf": validate_dxf,
    "json": validate_json,
}


def validate(result: dict) -> dict:
    kind = result.get("kind")
    fn = VALIDATORS.get(kind)
    if fn is None:
        return _fail(f"Невідомий тип результату: {kind!r}")
    return fn(result)


def _self_test() -> int:
    cases = [
        ({"kind": "weight", "value": 12.5, "unit": "kg"}, True),
        ({"kind": "weight", "value": -1, "unit": "kg"}, False),
        ({"kind": "weight", "value": 5, "unit": "lb"}, False),
        ({"kind": "selection", "model": "VR-400", "catalog": ["VR-400"],
          "spec": {"pressure": 1000}, "requirements": {"pressure": 1005}}, True),
        ({"kind": "selection", "model": "X", "catalog": ["VR-400"]}, False),
        ({"kind": "selection", "model": "VR-400", "catalog": ["VR-400"],
          "spec": {"pressure": 900}, "requirements": {"pressure": 1000}}, False),
        ({"kind": "ilogic", "code": "Parameter(\"D\") = 400"}, True),
        ({"kind": "ilogic", "code": "Shell(\"rm -rf\")"}, False),
        ({"kind": "dxf", "created": True, "size_bytes": 2048,
          "head": "0\nSECTION"}, True),
        ({"kind": "dxf", "created": True, "size_bytes": 0}, False),
        ({"kind": "json", "required_fields": ["a"], "payload": {"a": 1}}, True),
        ({"kind": "json", "required_fields": ["a", "b"], "payload": {"a": 1}}, False),
        ({"kind": "wat"}, False),
    ]
    failed = 0
    for inp, expect_ok in cases:
        got = validate(inp)["ok"]
        if got != expect_ok:
            failed += 1
            print(f"FAIL: {inp} -> {got}, expected {expect_ok}", file=sys.stderr)
    if failed:
        print(f"{failed} self-test(s) failed", file=sys.stderr)
        return 1
    print("all self-tests passed")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Детермінований фільтр результату")
    ap.add_argument("--file", help="JSON-файл з результатом; інакше stdin")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args()

    if args.self_test:
        return _self_test()

    raw = open(args.file, encoding="utf-8").read() if args.file else sys.stdin.read()
    try:
        result = json.loads(raw)
    except json.JSONDecodeError as e:
        print(json.dumps(_fail(f"Некоректний JSON: {e}"), ensure_ascii=False))
        return 2
    if not isinstance(result, dict):
        print(json.dumps(_fail("Очікувався об'єкт"), ensure_ascii=False))
        return 2

    verdict = validate(result)
    print(json.dumps(verdict, ensure_ascii=False))
    return 0 if verdict["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
