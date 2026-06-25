#!/usr/bin/env python3
"""Детермінована перевірка ліміту токенів задачі (5000 за замовчуванням).

Без зовнішніх залежностей і без API-викликів: однаковий вхід завжди
дає однаковий результат на будь-якій машині. Оцінювач свідомо
консервативний (трохи завищує), бо це запобіжник, а не біллінг.

Правило оцінки (фіксоване, не змінювати без бампа ESTIMATOR_VERSION):
  ASCII-символи:      4 символи ≈ 1 токен
  Кирилиця (U+0400…): 2 символи ≈ 1 токен
  Решта (емодзі, CJK): 1 символ = 1 токен
  + MESSAGE_OVERHEAD токенів службових на кожне повідомлення

Використання (оркестратор викликає після claim, перед dispatch):
  python3 check_token_limit.py --file payload.json            # перевірка
  echo '{"user_message": "..."}' | python3 check_token_limit.py
  python3 check_token_limit.py --file payload.json --trim     # обрізати контекст
  python3 check_token_limit.py --self-test

Режим --check (за замовчуванням): друкує JSON-звіт у stdout.
Режим --trim: видаляє найстаріші повідомлення thread_context, поки payload
не вліз у ліміт; обрізаний payload — у stdout, звіт — у stderr.
Якщо саме user_message перевищує ліміт — обрізка неможлива, задачу треба
фейлити з поясненням користувачу.

Exit codes:
  0 — у межах ліміту (після trim, якщо --trim)
  1 — перевищено ліміт
  2 — некоректний вхід
"""

import argparse
import json
import math
import sys

ESTIMATOR_VERSION = 1
DEFAULT_LIMIT = 5000
MESSAGE_OVERHEAD = 4  # службові токени: роль, розділювачі


def estimate_tokens(text: str) -> int:
    """Детермінована оцінка кількості токенів у тексті."""
    ascii_count = 0
    cyrillic_count = 0
    other_count = 0
    for ch in text:
        code = ord(ch)
        if code < 128:
            ascii_count += 1
        elif 0x0400 <= code <= 0x04FF:
            cyrillic_count += 1
        else:
            other_count += 1
    return (
        math.ceil(ascii_count / 4)
        + math.ceil(cyrillic_count / 2)
        + other_count
    )


def payload_breakdown(payload: dict) -> dict:
    """Розбивка токенів по частинах payload."""
    user_message = payload.get("user_message") or ""
    context = payload.get("thread_context") or []

    message_tokens = estimate_tokens(user_message) + MESSAGE_OVERHEAD
    context_tokens = [
        estimate_tokens((m or {}).get("content") or "") + MESSAGE_OVERHEAD
        for m in context
    ]

    return {
        "estimator_version": ESTIMATOR_VERSION,
        "user_message": message_tokens,
        "thread_context": context_tokens,
        "total": message_tokens + sum(context_tokens),
    }


def trim_payload(payload: dict, limit: int) -> tuple:
    """Видаляє найстаріші повідомлення контексту, поки не вліземо в ліміт.

    Повертає (trimmed_payload, breakdown, dropped_count).
    """
    payload = json.loads(json.dumps(payload, ensure_ascii=False))
    context = list(payload.get("thread_context") or [])
    dropped = 0

    breakdown = payload_breakdown(payload)
    while breakdown["total"] > limit and context:
        context.pop(0)  # найстаріше повідомлення
        dropped += 1
        payload["thread_context"] = context
        breakdown = payload_breakdown(payload)

    return payload, breakdown, dropped


def self_test() -> int:
    """Перевірка детермінованості та коректності оцінювача."""
    # ASCII: 11 символів → ceil(11/4) = 3
    assert estimate_tokens("hello world") == 3, "ascii"
    # Кирилиця: "привіт" = 6 символів (і = U+0456) → ceil(6/2) = 3
    assert estimate_tokens("привіт") == 3, "cyrillic"
    # Мішаний: "hi привіт" → ascii 3 (h,i,пробіл) → 1, кирилиця 6 → 3 = 4
    assert estimate_tokens("hi привіт") == 4, "mixed"
    # Емодзі — 1 токен за символ
    assert estimate_tokens("\U0001F600") == 1, "emoji"
    # Порожній
    assert estimate_tokens("") == 0, "empty"

    # Детермінованість: 100 повторів дають однакове значення
    sample = "Порахуй бюджет проєкту за Q2 та підкажи де перевитрати"
    first = estimate_tokens(sample)
    assert all(estimate_tokens(sample) == first for _ in range(100)), "determinism"

    # Trim: контекст видаляється з найстарішого
    payload = {
        "user_message": "x" * 40,  # 10 токенів + 4 overhead
        "thread_context": [
            {"content": "a" * 400},  # 100 + 4
            {"content": "b" * 400},  # 100 + 4
        ],
    }
    trimmed, bd, dropped = trim_payload(payload, limit=130)
    assert dropped == 1, f"expected 1 dropped, got {dropped}"
    assert trimmed["thread_context"][0]["content"][0] == "b", "oldest dropped first"
    assert bd["total"] <= 130, "within limit after trim"

    print("self-test: OK", file=sys.stderr)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Детермінована перевірка ліміту токенів задачі"
    )
    parser.add_argument("--file", help="JSON-файл payload (інакше stdin)")
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT)
    parser.add_argument(
        "--trim",
        action="store_true",
        help="обрізати thread_context до ліміту, вивід — у stdout",
    )
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    try:
        raw = open(args.file, encoding="utf-8").read() if args.file else sys.stdin.read()
        payload = json.loads(raw)
        if not isinstance(payload, dict):
            raise ValueError("payload must be a JSON object")
    except (OSError, ValueError, json.JSONDecodeError) as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False), file=sys.stderr)
        return 2

    if args.trim:
        trimmed, breakdown, dropped = trim_payload(payload, args.limit)
        report = {
            **breakdown,
            "limit": args.limit,
            "within_limit": breakdown["total"] <= args.limit,
            "dropped_messages": dropped,
        }
        print(json.dumps(report, ensure_ascii=False), file=sys.stderr)
        if not report["within_limit"]:
            # user_message сам перевищує ліміт — обрізати нічого
            return 1
        print(json.dumps(trimmed, ensure_ascii=False))
        return 0

    breakdown = payload_breakdown(payload)
    report = {
        **breakdown,
        "limit": args.limit,
        "within_limit": breakdown["total"] <= args.limit,
    }
    print(json.dumps(report, ensure_ascii=False))
    return 0 if report["within_limit"] else 1


if __name__ == "__main__":
    sys.exit(main())
