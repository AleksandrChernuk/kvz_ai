# KVZ AI

Внутрішня мультиагентна AI-платформа КВЗ. Користувачі логіняться, пишуть задачі в чаті
(«порахуй», «підкажи»…), а відповіді приходять з баз знань компанії (через MCP) та від
субагентів. Next.js 16 + React 19, Supabase (Auth + Postgres + Realtime), асинхронна
черга задач, воркер на сервері з CLI-агентами (Anthropic / OpenAI).

---

## Зміст

- [Що це і як працює (простими словами)](#що-це-і-як-працює-простими-словами)
- [Частина 1. Для новачків — підняти локально](#частина-1-для-новачків--підняти-локально-крок-за-кроком)
- [Частина 2. Для розробників](#частина-2-для-розробників)
- [Частина 3. Деплой на сервер (self-host)](#частина-3-деплой-на-сервер-self-host)
- [Перевірки перед комітом](#перевірки-перед-комітом)
- [Часті проблеми (FAQ)](#часті-проблеми-faq)

---

## Що це і як працює (простими словами)

Система складається з **4 незалежних шарів**. Кожен можна замінити, не ламаючи інші:

```
1. APP   — Next.js (те, що бачить людина: чат, список чатів, дашборди)
2. DATA  — Supabase (база: користувачі, чати, задачі, історія)
3. WORKER— процес на сервері, що бере задачі й виконує (тут живуть CLI-агенти)
4. MCP   — конектори до баз знань і систем (NotebookLM, Bitrix24, 1С) за шлюзом
```

Потік однієї задачі:

```
Людина пише в чат
   ↓ APP зберігає повідомлення + кладе задачу в чергу (status: pending)
   ↓ WORKER забирає задачу (атомарно, FOR UPDATE SKIP LOCKED)
   ↓ перевіряє ліміт токенів (детермінований, без AI)
   ↓ оркестратор (Claude) вирішує, кому віддати: база знань / Codex / пошук…
   ↓ субагент виконує через MCP-конектори
   ↓ детермінований фільтр перевіряє результат (математика/формат, без AI)
   ↓ якщо дія незворотна (ціна клієнту, .dxf на верстат, оплата) — чекає підтвердження людини
   ↓ APP показує відповідь у чаті (через Supabase Realtime)
```

Ключова ідея: **APP не думає**. Він тільки кладе задачу в базу. «Мозок» (оркестратор) і
«руки» (субагенти + MCP) живуть у WORKER окремо. Це робить систему безпечною і масштабованою.

---

## Частина 1. Для новачків — підняти локально (крок за кроком)

> Мета: запустити чат на своєму комп'ютері й побачити, як він працює. ~20 хвилин.

### Крок 0. Що треба встановити заздалегідь

| Інструмент | Перевірити | Якщо немає |
|---|---|---|
| Node.js 20+ | `node -v` | [nodejs.org](https://nodejs.org) |
| npm | `npm -v` | йде разом з Node |
| git | `git --version` | [git-scm.com](https://git-scm.com) |
| python3 | `python3 --version` | [python.org](https://python.org) |
| jq, curl | `jq --version` | `brew install jq` (macOS) |

### Крок 1. Завантажити код

```bash
git clone https://github.com/AleksandrChernuk/kvz_ai.git
cd kvz_ai
npm install
```

### Крок 2. Runtime config і секрети

Source of truth для ключів — **1Password**. У репозиторії зберігаються лише
приклади й імена змінних; реальні значення не комітяться в git, README, задачі,
логи або памʼять агентів. `.env*` файли — тільки локальна/runtime-матеріалізація
секретів з 1Password на конкретній машині.

Мінімальний набір для web runtime:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
WORKER_TOKEN
```

Мінімальний набір для worker runtime:

```text
API_URL
WORKER_TOKEN
```

`WORKER_TOKEN` — спільний секрет між Next.js API і воркером. Значення має бути
однаковим у web і worker runtime.

LLM на воркері працює через **Claude Code CLI під підпискою** (`claude -p`,
один раз `claude login`) — без `ANTHROPIC_API_KEY` і без оплати за токени.

```bash
openssl rand -hex 32
```

Для локального запуску можна матеріалізувати runtime-файли з прикладів:

```bash
cp .env.local.example .env.local
cp agent/.env.example agent/.env
```

### Крок 3. Supabase і міграції

Створити Supabase project або підключити self-hosted Supabase, занести runtime
values у 1Password, матеріалізувати env для поточного оточення й виконати SQL
міграції з `supabase/migrations/` **по порядку, від 001 до 016**.

Для self-hosted/production використовується `ops/supabase/apply-migrations.sh`.
Для hosted Supabase — SQL Editor або CLI, але порядок міграцій не змінювати.

### Крок 4. Запустити застосунок

```bash
npm run dev
```

Відкрити [http://localhost:3000](http://localhost:3000).

### Крок 5. Створити першого користувача

1. Supabase Dashboard → **Authentication → Add user** → ввести email/пароль.
2. Тригер автоматично заведе профіль з роллю `viewer`.
3. Щоб зробити себе адміном: **SQL Editor** →
   ```sql
   update profiles set role = 'admin' where user_id = (
     select id from auth.users where email = 'ваш@email'
   );
   ```

### Крок 6. Запустити воркер

Воркер читає `agent/.env` або змінні процесу. `WORKER_TOKEN` має збігатися з web
runtime, інакше worker API поверне 401.

Запустити:

```bash
./agent/scripts/poll.sh
```

Після цього chat flow працює як queue: `/api/chat` створює task, воркер claim-ить
її, проходить token gate / validation / approval gate і завершує через worker API.

---

## Частина 2. Для розробників

### Стек

| Шар | Технологія |
|---|---|
| Framework | Next.js 16.2.7 (App Router, React 19) |
| Auth + DB | Supabase (SSR, RLS enabled) |
| UI | Tailwind CSS v4, shadcn/ui (radix-ui), lucide-react |
| Notifications | sonner |
| Tests | vitest + Python self-tests |

> **Увага:** це Next.js **16**, не той, що в навчальних даних. Багато патернів з v13–15
> застаріли. Перед написанням коду дивись `node_modules/next/dist/docs/`. Деталі — в `AGENTS.md`.

### Архітектура черги

```
User → /api/chat → зберігає Message + створює Task (pending)
                                  ↓
              poll.sh → POST /api/tasks/claim   (атомарний FOR UPDATE SKIP LOCKED)
                                  ↓
              token gate: check_token_limit.py  (детермінований, 5000 ток./задачу, --trim)
                                  ↓
              handle_task.sh → Claude CLI (підписка) / MCP бази знань
                                  ↓
              детермінований фільтр: validate_result.py  (математика/формат, без AI)
                                  ↓
              гейт людини: якщо result.requires_approval → awaiting_approval
                                  ↓
              POST /api/tasks/complete  (транзакційно: Task.result + assistant message + webhook)
```

Помилка → `POST /api/tasks/fail` → retry (`retry_count++`, max 3) або остаточний `failed`.
Завислі задачі (> 5 хв у `running`) звільняє watchdog (`release_stale_locks`): він споживає
одну спробу й або повертає задачу в `pending`, або переводить її у `failed`, якщо спроби
вичерпано. У production watchdog запускає окремий `kvz-ai-watchdog.timer`, щоб stale locks
звільнялися навіть після падіння worker-процесу.

### Детермінований фільтр (не залежить від AI)

`agent/scripts/validate_result.py` — чиста математика й перевірка формату, **жодних
викликів моделі**. Якщо `TaskResult` містить `validation` з полем `kind`, `poll.sh` проганяє
результат перед доставкою. Провал → результат людині НЕ йде, задача повертається на доробку
з причиною. Валідатори: `weight`, `selection`, `ilogic`, `dxf`, `json`.

```bash
echo '{"kind":"weight","value":12.5,"unit":"kg"}' | python3 agent/scripts/validate_result.py
python3 agent/scripts/validate_result.py --self-test
```

### Гейт людського підтвердження

Для незворотних дій (ціна клієнту, `.dxf` на верстат, оплата) handler виставляє
`result.requires_approval = true`. Задача йде в `awaiting_approval`; людина бачить у чаті
кнопки **Підтвердити / Відхилити**. Підтвердження повертає задачу в чергу з `approved_at`,
воркер перепідіймає її та виконує незворотний крок. Відхилення → `cancelled`.

### Worker API (всі вимагають `Authorization: Bearer <WORKER_TOKEN>`)

| Endpoint | Призначення |
|---|---|
| `POST /api/tasks/claim` | Атомарний захват наступної задачі |
| `POST /api/tasks/complete` | Транзакційне завершення + webhook |
| `POST /api/tasks/fail` | Помилка: retry або остаточний fail |
| `POST /api/tasks/checkpoint` | Прогрес для crash recovery |
| `POST /api/tasks/request-approval` | Поставити задачу на підтвердження людини |
| `POST /api/tasks/watchdog` | Звільнити завислі локи |
| `GET/POST/PATCH /api/mail` | Пошта між агентами |
| `POST /api/runs` | Логічний запуск |
| `GET/PATCH /api/agents` | Каталог агентів і доступ ролей (`?role=` для worker routing) |
| `GET/POST/PATCH /api/kb` | Бази знань / MCP-сервіси і доступ ролей (`?role=` для worker routing) |
| `GET/PATCH /api/features` | UI-фічі по ролях |

Користувацькі (через сесію, не worker-токен): `POST /api/tasks/[taskId]/approve`,
`POST /api/tasks/[taskId]/reject`.

### Ролі та доступ

`admin` > `manager` > `engineer` > `viewer`. Доступ — у API-роутах і на сторінках.
Роль ЗАВЖДИ читається з `profiles` по `user_id`, **ніколи з тіла запиту**.

Матриця керується з `/access`:

- агенти: `agents` + `role_agent_access`;
- MCP/KB сервіси: `knowledge_bases` + `knowledge_base_role_access`;
- UI-фічі: `role_features` (`training`, `kb_manage`, `export`, …).

### Структура

```
src/
  app/
    (auth)/login/          — логін
    (dashboard)/           — chat, tasks, queue, runs, access
    api/                   — chat, tasks/*, runs, mail, agents, kb, features
  components/chat/         — ThreadList, ChatWindow, InputBar, MessageBubble, TaskStatusBadge
  components/tasks/        — TasksTable, QueueTable, RunsTable
  components/access/       — матриця доступів
  lib/                     — supabase (client/server/admin), worker-auth, webhook,
                             validate, access, features, title, threads, task-meta
  types/                   — database.ts, roles.ts
supabase/migrations/       — 001…016 (див. нижче)
agent/                     — оркестратор: CLAUDE.md, scripts/*, .mcp.json
ops/                       — інфраструктура деплою (див. Частину 3)
```

### Міграції

| # | Що |
|---|---|
| 001 | profiles + тригер на нового користувача |
| 002 | threads + messages + RLS |
| 003 | tasks + черга + RLS |
| 004 | realtime + тригери |
| 005 | claim/fail/checkpoint/watchdog, runs, agent_sessions |
| 006 | mail + webhook + rate limit |
| 007 | фікс RLS-рекурсії + title |
| 008 | knowledge_bases + role_features |
| 009 | транзакційний complete |
| 010 | атомарний chat enqueue |
| 011 | **гейт підтвердження** (awaiting_approval, request/approve/reject) |
| 012 | complete_task backstop (відмова без approval) + індекси read-шляхів |
| 013–016 | retry accounting, approval result binding, safe thread delete, access entities |
| 017 | knowledge_bases.allowed_roles — похідна junction-таблиці (single source) |
| 013 | послідовний retry-облік для fail_task/watchdog |
| 014 | complete_task приймає тільки підтверджений result після approval |
| 015 | безпечне видалення thread: заборона при активних задачах |
| 016 | нормалізовані доступи: agents, role_agent_access, knowledge_base_role_access |

### Конвенції

- **Мова:** UI-текст — українською; код, змінні, коментарі — англійською.
- **Server vs Client:** перевага Server Components; `"use client"` тільки де потрібні хуки.
- **Supabase:** `@/lib/supabase/server` у server-контексті, `@/lib/supabase/client` у браузері,
  `@/lib/supabase/admin` (service role) у worker-ендпоінтах.
- **Типи:** завжди `.returns<T[]>()` / `.single<T>()`, ніколи `any`.
- **Помилки в роутах:** `NextResponse.json({ error }, { status })`, не кидати виключення.
- **Без коментарів**, окрім випадків, де WHY неочевидний.

### Безпека

- Усі security-definer функції черги: `revoke from anon, authenticated` + `grant to service_role`
  — публічний anon key не керує чергою.
- Worker-ендпоінти: timing-safe перевірка `WORKER_TOKEN` + service-role клієнт.
- RLS-хелпери `is_admin()` / `current_user_role()` (security definer) — без рекурсії.
- Webhook: SSRF-guard (https-only, блок приватних IP, DNS resolve, `redirect: "manual"`).

---

## Частина 3. Деплой на сервер (self-host)

Уся інфраструктура — у папці `ops/`. Чотири шари, кожен зі своїм README:

| Шар | Папка | Що |
|---|---|---|
| Supabase | `ops/supabase/` | self-host база через Docker Compose |
| App + Worker | `ops/` | systemd-юніти, deploy-скрипт, nginx |
| MCP Gateway | `ops/contextforge/` | ContextForge — єдиний шлюз до MCP-конекторів |
| Backup + Logs | `ops/backup/`, `ops/logging/` | pg_dump по cron, logrotate, ліміти docker-логів |

Стислий порядок (детально — у `ops/README.md`):

```bash
# 1. Self-host Supabase
sudo SUPABASE_DOMAIN=supabase.example.com SITE_DOMAIN=ai.example.com \
  ./ops/supabase/setup-self-hosted.sh

# 2. Міграції
sudo ./ops/backup/backup-postgres.sh        # бекап перед міграцією
sudo ./ops/supabase/apply-migrations.sh

# 3. MCP-шлюз (ізольована мережа, креди 1С/Bitrix усередині, наружу не світиться)
cd /opt/kvz-mcp-gateway && cp .env.example .env  # матеріалізувати runtime env з 1Password
docker compose --env-file .env up -d

# 4. Деплой застосунку
SERVER=root@SERVER DOMAIN=ai.example.com ./ops/deploy/deploy-release.sh

# 5. Бекапи + логи (один раз)
sudo cp ops/logging/logrotate-kvz-ai.conf /etc/logrotate.d/kvz-ai
sudo cp ops/logging/daemon.json /etc/docker/daemon.json && sudo systemctl restart docker
sudo crontab -e   # додати бекап щодня; watchdog ставиться deploy-скриптом
```

> **Важливо:** CLI-агенти (Claude / Codex) ставляться лише на worker-сервер — це шар
> виконання з найнебезпечнішими правами. MCP-шлюз і Supabase Studio **ніколи** не
> публікуються наружу через nginx. Секрети — лише на сервері, ніколи в git.

### Безпека MCP (3 рубежі)

| Рубіж | Чим тримається |
|---|---|
| Мережа | конектори в `internal` docker-мережі без `ports:` — недосяжні ззовні й з app |
| Токен | `CF_AUTH_TOKEN` на шлюзі — кожен виклик з токеном воркера |
| Роль | `knowledge_base_role_access` / `role_agent_access` vs `profiles.role` до виклику |

---

## Перевірки перед комітом

```bash
npm run lint        # ESLint
npx tsc --noEmit    # типи
npm test            # vitest + self-test token gate
npm run build       # production build (перед деплоєм)
./scripts/db-test/run.sh   # інтеграційні тести БД (міграції + функції + RLS)
```

Запускати після будь-яких змін коду.

### Відомі advisory залежностей (не блокери)

`npm audit` показує транзитивні попередження без реального runtime-ризику:
- root: `postcss` всередині `next@16` (XSS у CSS-стрингіфікації, build-time; «фікс»
  від npm відкочує Next — ігноруємо до апдейту Next);
- `connectors/kb-docs`: ланцюг `vitest → vite → esbuild` — **dev-залежності**, у
  рантайм конектора (`dist/` + MCP SDK + zod) не потрапляють.

SAST: `semgrep --config=auto` — 0 знахідок.

Після self-host deploy:

```bash
SERVER=root@SERVER ./ops/deploy/smoke-check.sh
```

---

## Часті проблеми (FAQ)

**Чат не відповідає.** Воркер не запущений (`./agent/scripts/poll.sh`) або `WORKER_TOKEN`
у `agent/.env` не збігається з `.env.local`.

**Задача висить «Виконується…» назавжди.** Не працює watchdog або worker. На сервері —
`systemctl status kvz-ai-watchdog.timer kvz-ai-worker`; локально — перезапустити воркер.

**401 на worker-ендпоінтах.** Невірний або відсутній `WORKER_TOKEN`.

**RLS блокує запити / користувач бачить чуже.** Перевір, що всі міграції (001–016)
застосовані й `enable row level security` спрацював.

**Міграція 011 падає на `alter type … add value`.** Виконуй цей стейтмент окремо
від решти (Postgres не дозволяє використовувати нове значення enum у тій самій транзакції).
```
