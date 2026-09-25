# Mailer — a small self-hosted email campaign manager

Import contacts, compose a campaign, send it through your own SMTP account at a
controlled rate, and track delivery and opens. It is deliberately much smaller
than Mailchimp or SendPulse's marketing platform: one admin, one database, one
web app.

Built with Next.js (App Router) + TypeScript + PostgreSQL + Drizzle + Nodemailer.
It is provider-agnostic — SendPulse is just a set of SMTP settings.

---

## Домашнее задание

К менеджеру email-рассылок добавить **запланированную отправку**: при создании кампании выбрать «отправить сейчас» или «запланировать»
(дата, время, часовой пояс), хранить время в UTC, запускать кампанию автоматически через уже существующую очередь и
SMTP rate limiter, разрешить отмену до постановки в очередь, пережить перезапуск и никогда не запускать кампанию дважды.

**Дополнительное задание:** перенос времени уже запланированной кампании (пока она `SCHEDULED`) и dev-панель для ручного
тестирования планирования (тестовое время, планировщик, очередь, rate limiter, подсказки `?`, обучающий тур).

## Реализованные возможности

- Шаг «Отправка» мастера кампании: **Отправить сейчас** или **Запланировать** (дата, время; часовой пояс браузера показан рядом).
- Проверка времени в браузере и на сервере (часы сервера); прошедшее и неоднозначное/несуществующее время отклоняется.
- Статус `SCHEDULED`; `campaigns.scheduled_at` — `timestamptz`, то есть момент в UTC.
- Автоматический запуск: тик worker находит `SCHEDULED` с `scheduled_at <= now()` и ставит их в очередь.
- Отправка идёт через существующую очередь, лимит `SMTP_MAX_EMAILS_PER_HOUR`, повторы и защиту от дублей.
- Отмена (`POST /api/campaigns/:id/cancel-scheduled`) и перенос (`PATCH /api/campaigns/:id/schedule`) только пока статус `SCHEDULED`.
- Расписание хранится в PostgreSQL, поэтому переживает перезапуск; пропущенная кампания запускается на первом тике после подъёма.
- Интерфейс на русском и английском, dev-панель (только development/test), Docker Compose, health check, CI.

## Архитектура планирования рассылок

```text
мастер кампании ──POST /api/campaigns/:id/schedule──▶ campaigns.status = SCHEDULED, scheduled_at (UTC)
                                                              │
worker (сервис worker / npm run worker / cron) ──POST /api/worker/tick──▶ тик:
   1. activateDueCampaigns: SCHEDULED и scheduled_at <= now() ──▶ QUEUED + строки campaign_recipients (одна транзакция)
   2. очередь: claim строк в пределах лимита ──▶ SMTP ──▶ SENT / повтор / FAILED
   3. finalizeCompletedCampaigns: нет QUEUED/SENDING ──▶ COMPLETED
```

Отдельного процесса-планировщика нет: **тик worker и есть планировщик**. Код: `src/lib/campaign-activation.ts`
(запуск, отмена, перенос), `src/lib/scheduling.ts` (разбор и проверка времени), `src/lib/campaign-send.ts`
(сервисы отправки и планирования), `src/lib/worker.ts` и `src/lib/queue.ts` (очередь), `src/lib/rate-limit.ts`.

## Жизненный цикл кампании

```text
DRAFT → SCHEDULED → QUEUED → SENDING → COMPLETED
                  ↘ CANCELLED
```

`DRAFT → QUEUED` — немедленная отправка. `QUEUED`, `SENDING` можно приостановить (`PAUSED`) или остановить
(`CANCELLED`) обычной отменой. Отмена запланированной и перенос возможны только из `SCHEDULED`. Если к моменту запуска
получателей не осталось, кампания становится `CANCELLED`.

## Как хранятся дата, время и часовой пояс

- В базе один момент времени `scheduled_at timestamptz` (UTC). Часовой пояс не хранится.
- API принимает и отдаёт ISO 8601 с указанием зоны (`2026-10-15T08:30:00.000Z` или `+02:00`); значение без зоны отклоняется.
- Мастер переводит введённые дату и время в UTC по **часовому поясу браузера** (он показан рядом с полями). Если локальное
  время бывает дважды (перевод часов назад), мастер просит выбрать; несуществующее время (перевод вперёд) отклоняется.
- Сервер сравнивает только моменты по своим часам. Подробности: [Time zones](#time-zones).

## Как работает автоматический запуск

Тик worker (`POST /api/worker/tick`, секрет `WORKER_SECRET`) первым делом ищет `SCHEDULED` кампании, время которых
наступило, и для каждой в одной транзакции блокирует строку (`FOR UPDATE SKIP LOCKED`), ставит `QUEUED` и создаёт
строки получателей. Тик вызывает сервис `worker` (или `npm run worker`, или внешний cron) каждые
`WORKER_TICK_INTERVAL_SECONDS` (по умолчанию 60 с), поэтому кампания стартует в пределах одного интервала после своего
времени. Подробности: [Scheduled campaigns](#scheduled-campaigns), [Running the scheduler](#running-the-scheduler).

## Как используются очередь и rate limiter

Запланированная кампания не обходит очередь: после `QUEUED` работает тот же путь, что и при немедленной отправке.
Запланированное время — это **начало** отправки; большая кампания всё равно уходит со скоростью
`SMTP_MAX_EMAILS_PER_HOUR` (× `SMTP_RATE_SAFETY_FACTOR`). Счёт отправок ведётся в Postgres (`smtp_send_log`), поэтому лимит
не сбрасывается при перезапуске. Подробности: [How the sending queue and rate limit work](#how-the-sending-queue-and-rate-limit-work).

## Как предотвращаются повторный запуск и гонки

- Запуск, отмена и перенос — условные записи по `status = 'SCHEDULED'` одной строки кампании; выигрывает ровно одна.
- Несколько worker одновременно: строку получает один (`SKIP LOCKED`), остальные её пропускают.
- Если транзакция запуска упала, кампания остаётся `SCHEDULED` без частичной очереди и повторяется на следующем тике.
- Один адрес на кампанию: уникальный индекс `(campaign_id, email_normalized)`; отправленное письмо не отправляется повторно.

## Как работают отмена и перенос времени

- **Отмена**: `POST /api/campaigns/:id/cancel-scheduled` → `CANCELLED`; `409`, если кампания уже не `SCHEDULED`.
- **Перенос**: `PATCH /api/campaigns/:id/schedule` с новым будущим временем; `409`, если статус другой **или время уже
  наступило и планировщик вправе запустить кампанию**. В UI это кнопки «Изменить время» и «Отменить» в списке и на странице
  кампании. Перенос — одна запись `UPDATE … WHERE status='SCHEDULED' AND scheduled_at > now()`, поэтому гонка с worker
  решается атомарно; в старое время кампания не стартует.
- Подробности и таблицы ответов: [Seeing and cancelling scheduled campaigns](#seeing-and-cancelling-scheduled-campaigns),
  [Changing the time of a scheduled campaign](#changing-the-time-of-a-scheduled-campaign).

## Как система восстанавливается после перезапуска

Ни расписание, ни очередь не живут в памяти процесса. После остановки и запуска (`docker compose down` / `up`, падение
worker или web) кампания, чьё время прошло, запускается на первом тике; перенесённое и ещё будущее время остаётся в базе.
Подробности: [Restarts and missed start times](#restarts-and-missed-start-times).

## Как включить и использовать dev-панель

Только в development/test и только при `ENABLE_EMAIL_TEST_PANEL=true` в `.env`; после этого перезапустить `npm run dev`.
Справа внизу появится кнопка **Тестовая панель**: тестовое время (Задать / Продвинуть на 1 мин, 5 мин, 1 ч, 1 день),
планировщик (Старт, Стоп, «Запустить сейчас» — ровно один цикл), очередь и rate limit, создание тестовых кампаний,
журнал событий, тур «Как протестировать планирование» и 9 сценариев. Все письма при этом идут на встроенный тестовый SMTP
(`@test.invalid`, файлы `.eml` в `received-emails/`). В production панели нет: её маршруты не собираются, код не входит в
сборку. Подробности: [Developer test panel](#developer-test-panel).

## Локальный запуск

**Требования:** Node.js 22+, npm, Docker (для PostgreSQL) и SMTP-аккаунт (для реальной отправки; для проверки хватит dev-панели
или Mailpit).

**Настройка `.env`:** `cp .env.example .env`, затем задать `ENCRYPTION_KEY` и `WORKER_SECRET` (`openssl rand -hex 32` для
каждого); остальное по умолчанию подходит для локальной работы. `.env` не попадает в Git.

**Обычный запуск:**

```bash
npm install
cp .env.example .env
docker compose up -d db                 # PostgreSQL на 127.0.0.1:5435
npm run db:migrate                      # миграции
npm run create-admin -- you@example.com 'a-long-password'
npm run dev                             # frontend и backend (Next.js) на http://localhost:3000
npm run worker                          # во втором терминале: worker и планировщик (тик каждую минуту)
```

**Docker Compose (всё сразу):**

```bash
docker compose --profile app up --build -d          # migrate, web, worker
docker compose exec web node dist-scripts/create-admin.cjs you@example.com 'a-long-password'
docker compose --profile app --profile smtp-test up --build -d   # то же плюс Mailpit на http://localhost:8025
```

| Процесс | Обычный запуск | Docker Compose |
| --- | --- | --- |
| Миграции | `npm run db:migrate` | сервис `migrate` (один раз) |
| Frontend и backend | `npm run dev` / `npm run build && npm start` | сервис `web` |
| Worker и scheduler (один процесс) | `npm run worker` | сервис `worker` |

**Проверки и сборка:**

```bash
npm run lint
npm run typecheck
npm test            # нужен PostgreSQL: docker compose up -d db
npm run build
```

## Пошаговая инструкция ручной проверки задания

Быстрый путь с dev-панелью (не нужно ждать): в `.env` `ENABLE_EMAIL_TEST_PANEL=true`, запустить `npm run dev`, войти, открыть
**Тестовая панель**. Панель сама запускает планировщик и тестовый SMTP, `npm run worker` не нужен.

1. **Запланированная кампания вручную.** Рассылки → Новая рассылка → название → тема и текст → выбрать список получателей →
   шаг «Отправка» → **Запланировать** → дата и время через 2–3 минуты → «Запланировать рассылку». Проверить: статус
   «Запланирована», в списке видно время и `≈ N` получателей. Прошедшее время должно быть отклонено.
2. **Автозапуск.** Подождать время (при `npm run worker` — до минуты). Статус: `QUEUED` → `SENDING` → `COMPLETED`; получатели
   появляются на странице кампании.
3. **Через dev-панель.** «Создать тестовую кампанию» → шаблон «Запуск через 5 мин» → Создать; «Тестовое время» → Фиксированное →
   Задать; шаг «5 минут» → Продвинуть; «Планировщик» → Запустить сейчас. Проверить статусы в разделе «Тестовые кампании».
4. **Отмена.** Создать ещё одну запланированную кампанию → «Отменить» → подтвердить → `CANCELLED`; «Запустить сейчас»
   ничего не запускает.
5. **Перенос.** Создать запланированную → «Изменить время» → новое будущее время → в списке новое время; повторный
   перенос кампании, которая уже `QUEUED`, отклоняется (409).
6. **Перезапуск.** Запланировать кампанию на 5 минут вперёд, остановить приложение и worker (`Ctrl+C`, либо `docker compose stop
   web worker`), подождать, пока время пройдёт, запустить снова: кампания стартует на первом тике. Будущее расписание после
   перезапуска остаётся.

Сценарий для преподавателя, коротко:

```text
1. Запустить проект.
2. Создать кампанию.
3. Выбрать «Запланировать».
4. Указать будущее время.
5. Убедиться, что статус стал SCHEDULED.
6. Дождаться времени или использовать dev-панель.
7. Проверить переход в QUEUED, SENDING и COMPLETED.
8. Проверить отмену.
9. Проверить изменение времени.
10. Перезапустить приложение и проверить восстановление расписания.
```

Автоматически те же сценарии проверяют тесты (см. колонку «Как проверить»): `npm test` — 58 файлов, 1638 тестов на реальном PostgreSQL.

## Таблица готовности

Статусы: `DONE` — реализовано и проверено; `PARTIAL` — реализовано частично; `FAILED` — работает неправильно; `NOT STARTED` — не
реализовано; `BLOCKED` — нужен недоступный сервис, секрет или доступ. Проверки выполнены на этой машине (Windows, Node 24,
PostgreSQL 17 в Docker): `npm test` в трёх часовых поясах (UTC, `Pacific/Kiritimati`, `Pacific/Pago_Pago`), `npm run lint`,
`npm run typecheck`, `npm run build`, сборка и запуск Docker Compose; те же шаги в GitHub Actions (CI #2, коммит `77c910f`).

| Критерий | Статус | Что реализовано | Как проверить | Что не удалось |
|---|---|---|---|---|
| 1. Выбор между немедленной и запланированной отправкой | DONE | Шаг «Отправка»: «Отправить сейчас» / «Запланировать» | Ручной сценарий, п. 1; `npx vitest run tests/send-step-ui.test.tsx tests/campaign-send.test.ts` | — |
| 2. Выбор даты, времени и часового пояса | PARTIAL | Дата и время выбираются; зона — часовой пояс браузера, показана рядом с полями, неоднозначное время (перевод часов) выбирается вручную | Ручной сценарий, п. 1; `npx vitest run tests/scheduling.test.ts tests/timezones.test.ts` | В мастере нет выпадающего списка зон: зону нельзя выбрать отдельно от браузера (список зон есть только в dev-панели) |
| 3. Frontend и backend запрещают прошедшее время | DONE | Проверка в форме (`ScheduleFields`) и на сервере (`parseScheduledAt`, ответ `400` с кодом `SCHEDULE_*`) | Ввести прошедшее время; `npx vitest run tests/scheduling.test.ts tests/campaign-scheduling.test.ts tests/send-step-ui.test.tsx` | — |
| 4. Кампания получает статус `SCHEDULED` | DONE | `POST /api/campaigns/:id/schedule`; ограничение БД `campaigns_scheduled_requires_time` | Ручной сценарий, п. 1; `npx vitest run tests/campaign-scheduling.test.ts` | — |
| 5. `scheduledAt` сохраняется в базе в UTC | DONE | Колонка `scheduled_at timestamptz`, API в ISO 8601 с зоной | `npx vitest run tests/timezones.test.ts tests/scheduling-e2e.test.ts` (в трёх часовых поясах) | — |
| 6. Кампания автоматически запускается в нужное время | DONE | Тик worker: `activateDueCampaigns` → `QUEUED` | Ручной сценарий, п. 2; `npx vitest run tests/scheduled-activation.test.ts tests/scheduling-e2e.test.ts`; проверено в Docker Compose (запуск без участия человека) | — |
| 7. Используются существующая очередь и SMTP rate limiting | DONE | После `QUEUED` тот же путь, что у немедленной отправки; счётчик лимита в Postgres | `npx vitest run tests/scheduling-e2e.test.ts tests/queue.test.ts tests/testpanel-ratelimit.test.ts`; в Docker при лимите 8/ч и 12 отправленных письмах отправок 0, после повышения лимита — все | — |
| 8. Кампанию можно отменить до перехода в `QUEUED` | DONE | `POST /api/campaigns/:id/cancel-scheduled`, кнопки в списке и на странице | Ручной сценарий, п. 4; `npx vitest run tests/scheduled-cancel.test.ts tests/campaign-list-ui.test.tsx` | — |
| 9. Отменённая кампания не запускается | DONE | Запуск и отмена — условные записи по `status='SCHEDULED'` | `npx vitest run tests/scheduled-cancel.test.ts`; в Docker отменённая кампания осталась без получателей | — |
| 10. Расписание сохраняется после перезапуска | DONE | Расписание только в PostgreSQL | Ручной сценарий, п. 6; `npx vitest run tests/scheduler-restart.test.ts tests/scheduler-processes.test.ts`; Docker: `down` и `up` без `-v` | — |
| 11. Пропущенная во время простоя кампания запускается после восстановления | DONE | Тик находит всё, что стало due, «как бы поздно ни было» | `npx vitest run tests/scheduler-recovery.test.ts tests/scheduler-restart.test.ts`; Docker: остановка `web` и `worker`, ожидание, запуск — кампания стартовала | — |
| 12. Кампания не запускается дважды | DONE | `FOR UPDATE SKIP LOCKED`, условный `UPDATE`, уникальный `(campaign_id, email_normalized)` | `npx vitest run tests/scheduler-processes.test.ts tests/scheduled-activation.test.ts` (несколько реальных процессов); Docker: 24 строки на 24 разные пары | — |
| 13. Немедленная отправка и существующие функции не сломаны | DONE | Весь прежний набор тестов проходит; `sendDraftCampaign` вынесен в сервис без смены поведения | `npm test` (1638 тестов); `npx vitest run tests/campaign-send.test.ts tests/queue.test.ts tests/api-auth.test.ts` | Ручной прогон всех экранов в браузере целиком не выполнялся |
| 14. Запланированную кампанию можно перенести на новое будущее время | DONE | `PATCH /api/campaigns/:id/schedule`, кнопка «Изменить время» | Ручной сценарий, п. 5; `npx vitest run tests/reschedule.test.ts tests/reschedule-ui.test.tsx` | — |
| 15. Перенос разрешён, пока статус `SCHEDULED`, даже если прежнее время наступило, но worker ещё не забрал кампанию | PARTIAL | Разрешён для `SCHEDULED` с будущим `scheduled_at`. Если время **уже наступило**, перенос отклоняется (`409`), чтобы устаревшая страница не отбирала кампанию у планировщика | `npx vitest run tests/reschedule.test.ts tests/reschedule-times.test.ts` | Требование в формулировке задания («разрешён, даже если прежнее время наступило») сознательно реализовано строже: см. [Changing the time of a scheduled campaign](#changing-the-time-of-a-scheduled-campaign) |
| 16. После `QUEUED`, `SENDING`, `COMPLETED` или `CANCELLED` перенос запрещён | DONE | `409` для любого статуса, кроме `SCHEDULED` | `npx vitest run tests/reschedule.test.ts` | — |
| 17. После переноса кампания не запускается в старое время | DONE | Worker читает `scheduled_at` заново на каждом тике | `npx vitest run tests/reschedule.test.ts tests/reschedule-times.test.ts` | — |
| 18. Система автоматически использует новое время | DONE | То же чтение `scheduled_at`; никаких таймеров и заданий для замены | Ручной сценарий, п. 5; `npx vitest run tests/reschedule.test.ts` | — |
| 19. Гонка между переносом и worker обрабатывается атомарно | DONE | Перенос — один `UPDATE … WHERE status='SCHEDULED' AND scheduled_at > now()` | `npx vitest run tests/reschedule.test.ts` (гонки перенос/запуск) | — |
| 20. Новое время сохраняется после перезапуска | DONE | Хранится в базе | `npx vitest run tests/reschedule.test.ts tests/scheduler-restart.test.ts` | — |
| 21. Dev-панель, подсказки и обучалка доступны только в development/test | DONE | Флаг + `NODE_ENV`, проверка на сервере, маршруты `route.dev.ts` не собираются в production | `npx vitest run tests/testpanel-access.test.ts`; production: `/api/dev/*` → 404 (проверено в `next start` и Docker), `grep` по `.next` не находит панель | — |
| 22. Production-сборка и Docker работают | DONE | `npm run build`; образ 270 MB, сервисы `db`, `migrate`, `web`, `worker`, `mailpit` | `npm run build`; `docker compose --profile app up --build -d`; `docker compose ps` (все healthy); `curl http://localhost:3000/api/health` | — |
| 23. Проведена проверка безопасности | DONE | Аудит доступа, ввода, секретов и зависимостей; исправления: лимит попыток входа, общие 500, заголовки, отказ от примерных секретов | `npm audit --omit=dev` (0 уязвимостей); `npx vitest run tests/security-hardening.test.ts tests/api-auth.test.ts`; сканирование gitleaks (0 находок) | 4 moderate-уязвимости в dev-инструментах (`drizzle-kit`, только dev-сервер `esbuild`), в образ не попадают; лимит входа хранится в памяти процесса; один workspace без владельцев кампаний |
| 24. `received-emails` и тестовые `.eml` не попадают в Git | DONE | `/received-emails/` и `*.eml` в `.gitignore`, `.dockerignore` | `git ls-files \| grep -E "received-emails\|\.eml$"` (пусто); `git check-ignore -v received-emails` | — |
| 25. GitHub Actions проходят | DONE | `.github/workflows/ci.yml`: lint, типы, 1638 тестов на Postgres-сервисе, build, проверка отсутствия dev-панели, `npm audit --omit=dev`, gitleaks, сборка Docker-образа; `publish-image.yml` публикует образ после зелёного CI | Вкладка Actions репозитория `yshu17/ai-email-broadcast-HW`: запуск CI #2 (коммит `77c910f`) — все три задачи успешны; Publish image #2 — успешно | Первый запуск (CI #1) упал на шаге gitleaks из-за ошибки самого `gitleaks-action` на первом пуше нового репозитория (утечек не найдено); заменён на прямой запуск gitleaks CLI |
| 26. Изменения опубликованы в GitHub либо указан блокер | DONE | Код в https://github.com/yshu17/ai-email-broadcast-HW (ветка `main`, вся история исходного проекта плюс доработки); образ `ghcr.io/yshu17/ai-email-broadcast-hw:latest` | `git ls-remote https://github.com/yshu17/ai-email-broadcast-HW main`; `docker pull ghcr.io/yshu17/ai-email-broadcast-hw:latest` (после входа в ghcr.io: репозиторий и пакет приватные) | В исходный репозиторий `ievgiienko/ai-email-broadcast` не отправлено: у аккаунта `yshu17` нет прав записи; доработки опубликованы в собственном репозитории |

## Известные ограничения и нереализованные пункты

- Часовой пояс в мастере — пояс браузера; отдельного выбора зоны нет (критерий 2).
- Перенос отклоняется, если прежнее время уже наступило (критерий 15): так устаревшая страница не отбирает кампанию у планировщика.
- Точность запуска — интервал тика worker (по умолчанию 60 с).
- Один workspace и один тип пользователя (admin): кампании не принадлежат отдельным пользователям.
- Лимит попыток входа хранится в памяти одного процесса.
- Список кампаний загружается целиком; время запроса растёт с числом получателей (~100 мс на 375 тыс. записей).
- Нет форматтера кода, поэтому CI не проверяет форматирование.
- Репозиторий `yshu17/ai-email-broadcast-HW` и образ в GHCR приватные: для просмотра нужен доступ (Settings → Collaborators) или смена видимости на Public.
- Изменения не отправлены в исходный репозиторий `ievgiienko/ai-email-broadcast` (нет прав записи); его владелец может забрать их из `yshu17/ai-email-broadcast-HW`.
- `npm audit` (полное дерево) показывает 4 moderate в dev-инструментах, см. [Known advisory](#known-advisory).

```text
Основная задача: NOT READY
Дополнительное задание: NOT READY
Проект в целом: NOT READY
```

Основная задача не `READY`: критерий 2 — `PARTIAL` (часовой пояс берётся из браузера, отдельного выбора зоны нет). Дополнительное
задание не `READY`: критерий 15 реализован строже формулировки (`PARTIAL`). Остальные 24 критерия — `DONE`.

---

## Contents

- [Домашнее задание](#домашнее-задание)
- [Реализованные возможности](#реализованные-возможности)
- [Архитектура планирования рассылок](#архитектура-планирования-рассылок)
- [Жизненный цикл кампании](#жизненный-цикл-кампании)
- [Локальный запуск](#локальный-запуск)
- [Пошаговая инструкция ручной проверки задания](#пошаговая-инструкция-ручной-проверки-задания)
- [Таблица готовности](#таблица-готовности)
- [Известные ограничения и нереализованные пункты](#известные-ограничения-и-нереализованные-пункты)

- [Quick start](#quick-start)
- [Configuring SendPulse SMTP](#configuring-sendpulse-smtp)
- [How the sending queue and rate limit work](#how-the-sending-queue-and-rate-limit-work)
- [Never sending the same email twice](#never-sending-the-same-email-twice)
- [Open tracking, and what it does not tell you](#open-tracking-and-what-it-does-not-tell-you)
- [Unsubscribes and the suppression list](#unsubscribes-and-the-suppression-list)
- [Language (RU / EN)](#language-ru--en)
- [Developer test panel](#developer-test-panel)
- [Deployment](#deployment)
- [Health checks](#health-checks)
- [Continuous integration and the container image](#continuous-integration-and-the-container-image)
- [Troubleshooting](#troubleshooting)
- [Architecture and trade-offs](#architecture-and-trade-offs)
- [Environment variables](#environment-variables)
- [Development](#development)
- [Security notes](#security-notes)

---

## Quick start

Requirements: Node 22+, Docker (for local Postgres), and an SMTP account.

```bash
npm install
cp .env.example .env
```

Fill in `.env`. At minimum, generate the two secrets:

```bash
openssl rand -hex 32   # ENCRYPTION_KEY
openssl rand -hex 32   # WORKER_SECRET
```

Start the database, apply migrations, and create your admin account:

```bash
docker compose up -d db
npm run db:migrate
npm run create-admin -- you@example.com 'a-long-password-you-will-remember'
```

Run it:

```bash
npm run dev
```

Open http://localhost:3000, sign in, and go to **Settings** to configure SMTP.

To actually send, something must call the worker endpoint on a schedule. In
development, run this in a second terminal:

```bash
npm run worker
```

That is a plain loop that POSTs to `/api/worker/tick` every minute — exactly what
a cron job would do in production. The same tick also starts **scheduled**
campaigns (see [Scheduled campaigns](#scheduled-campaigns)), so a scheduled
campaign only starts while something is ticking. If nothing was, it starts on the
first tick after that resumes, however late (see
[Restarts and missed start times](#restarts-and-missed-start-times)).

---

## Configuring SendPulse SMTP

In SendPulse, open **Settings → SMTP** and generate SMTP credentials (these are
*not* your SendPulse account login). Then in this app's **Settings** page:

| Field | Value |
| --- | --- |
| Hostname | `smtp-pulse.com` |
| Port | `587` (STARTTLS) or `465` (TLS/SSL) |
| Encryption | `STARTTLS` for 587, `TLS/SSL` for 465 |
| Username | your SendPulse SMTP login |
| Password | your SendPulse SMTP password |
| Sender email | an address **verified as a sender in SendPulse** |
| Sender display name | e.g. `Example News` |
| Maximum emails per hour | `5000` |

There are preset buttons on the page for both SendPulse port options.

Then use **Test connection** (opens an SMTP session and authenticates, sends
nothing) and **Send test email** (sends a real message). If the sender address is
not verified in SendPulse, the test will fail with a 5xx from their server — the
error is shown verbatim, minus any credentials.

The password is encrypted with AES-256-GCM using `ENCRYPTION_KEY` before it is
stored, and is never sent back to the browser: the settings API returns only
`smtpPasswordSet: true`.

**Any standard SMTP server works.** Nothing about SendPulse is special-cased in
the code; it is all configuration.

---

## How the sending queue and rate limit work

### The queue

Queuing a campaign does not send anything. It writes one `campaign_recipients`
row per unique recipient, each with a snapshot of the contact, a delivery status,
and two random tokens (tracking + unsubscribe). **The database is the only source
of truth.** Nothing lives in process memory, so restarts, crashes and serverless
timeouts cost nothing.

A worker invocation (`POST /api/worker/tick`) does this and then returns:

1. Return rows whose worker lease expired back to `QUEUED` (crash recovery).
2. Read how many SMTP attempts were logged in the last rolling hour.
3. Compute a batch size from the remaining hourly allowance.
4. Claim that many due recipients **atomically**.
5. Re-check the suppression list.
6. Send them, with a small amount of parallelism.
7. Mark each row `SENT`, `FAILED`, or re-queue it with a backoff.
8. Stop when the queue is empty, the hour's quota is spent, or the time budget
   runs out.

The claim in step 4 is a single statement:

```sql
WITH due AS (
  SELECT r.id FROM campaign_recipients r
  JOIN campaigns c ON c.id = r.campaign_id
  WHERE r.delivery_status = 'QUEUED'
    AND r.next_attempt_at <= now()
    AND c.status IN ('QUEUED', 'SENDING')
  ORDER BY r.next_attempt_at, r.created_at
  LIMIT $1
  FOR UPDATE OF r SKIP LOCKED      -- concurrent workers get disjoint rows
)
UPDATE campaign_recipients r
SET delivery_status = 'SENDING',
    attempts        = r.attempts + 1,
    lease_expires_at = now() + interval '5 minutes',
    claimed_by      = $2
FROM due, campaigns c2
WHERE r.id = due.id AND c2.id = r.campaign_id
RETURNING ...
```

`FOR UPDATE ... SKIP LOCKED` is what makes overlapping cron invocations safe: two
workers firing at the same instant partition the queue rather than both grabbing
the same recipient.

### The rate limit

`SMTP_MAX_EMAILS_PER_HOUR` (default `5000`, matching SendPulse) is the ceiling.
Two things keep the app under it:

**A rolling window, not a clock hour.** Every SMTP attempt inserts a row into
`smtp_send_log`. The limiter counts rows in the last 60 minutes. Resetting on the
hour would allow a 2× burst across the boundary — 5,000 at 10:59 and another
5,000 at 11:01.

**A safety margin.** `SMTP_RATE_SAFETY_FACTOR` (default `0.95`) means the app
aims for 4,750/hour, leaving room for the small overshoot that is possible when
several workers reserve quota simultaneously.

**Quota is spread across ticks.** A tick does not drain the whole hour's budget
at once. It takes at most `effectiveLimit × tickInterval / 3600` — about 79
emails on a 60-second cron — so sending is paced rather than bursty.

For 20,000 recipients at 5,000/hour, expect roughly 4 hours 13 minutes. The
confirmation screen shows this estimate before you commit.

### Failure handling

Up to `SMTP_MAX_ATTEMPTS` (default 3) attempts per recipient, backing off 1 → 5 →
15 minutes. After the last attempt the recipient is `FAILED` with a short,
credential-scrubbed error, and the campaign carries on — one bad address can
never block the rest.

- **5xx replies** (bad mailbox, rejected sender) are permanent: failed
  immediately, no retries wasted.
- **4xx replies and socket errors** are temporary and retried.
- **Unknown errors are treated as temporary**, because wrongly calling something
  permanent silently drops a real recipient.
- **Authentication and connection failures abort the whole batch** and release
  the claimed rows without consuming an attempt. These are configuration
  problems, not recipient problems; failing 200 people because a password
  expired would be wrong.

Failed addresses can be exported as CSV from the campaign page.

### Scheduled campaigns

On the last step of the campaign wizard you can choose **Schedule** and pick a
date and time. The campaign is saved as `SCHEDULED` with `scheduled_at` — a UTC
instant; the wizard converts what you typed using your browser's time zone, which
it displays next to the fields. Nothing is queued or sent at that point, and the
campaign can no longer be edited.

The time is validated twice: in the browser, and again by
`POST /api/campaigns/:id/schedule`, which compares it with the *server's* clock
and answers `400` with `{ error, code, field }` if it is missing, malformed, or
not strictly in the future.

**There is no separate scheduler.** The existing worker does it. Every
`/api/worker/tick` begins by looking for campaigns with `status = 'SCHEDULED'`
and `scheduled_at <= now()` (database clock) and, for each one, does what the
**Queue campaign** button does — in a single transaction it locks the campaign
row (`FOR UPDATE SKIP LOCKED`), sets `QUEUED`, and writes the recipient rows.
From there the ordinary path takes over: the worker claims those rows within the
hourly limit and sends them, retrying and failing exactly as for an immediate
campaign (`SCHEDULED → QUEUED → SENDING → COMPLETED`).

- **The scheduled time is when sending starts, not when it finishes.** A large
  campaign still goes out at `SMTP_MAX_EMAILS_PER_HOUR`; the rate limiter is not
  bypassed or given a separate path.
- **Precision is the worker's interval.** With the default one-minute tick a
  campaign starts within about a minute of its time; with a 5-minute external cron
  it can start up to 5 minutes late. Set `WORKER_TICK_INTERVAL_SECONDS` to match.
- **Restarts and downtime are safe.** The schedule lives in the database, not in
  any process. A campaign that came due while the worker was down starts on the
  next tick — however late that is; it is not skipped. The log line records how
  late (`lateSeconds`).
- **No double start.** Only one of several concurrent workers gets the row lock;
  the rest skip it. If the transaction fails or the process dies midway, it rolls
  back: the campaign stays `SCHEDULED` with no partial queue, and the next tick
  retries it. A campaign that keeps failing is retried every tick and logged as
  `[scheduler] activation failed`, while the others proceed.
- **Empty audience.** If by the scheduled time everyone has unsubscribed or been
  removed, there is nothing to send: the campaign becomes `CANCELLED` (and is
  logged) instead of being retried forever.
- If SMTP is not configured when the time arrives the campaign is still queued,
  and its mail waits until SMTP is set up.

#### Seeing and cancelling scheduled campaigns

In the **Campaigns** list a scheduled campaign shows the `SCHEDULED` badge, the
line *Scheduled for …* with its start time, and the number of recipients it is
expected to have (`≈ N` — an estimate, because the queue is only built when
sending starts). Campaigns that are not scheduled show no such line. The list
API returns `scheduledAt` (ISO 8601, UTC, with `Z`; `null` when not scheduled)
and, for `SCHEDULED` rows only, `estimatedRecipients`.

While a campaign is still `SCHEDULED` it can be cancelled, from the list
(**Cancel**) or from the campaign's own page (**Cancel scheduled send**). Both
ask for confirmation, naming the campaign and its start time. Nothing is deleted:
the campaign becomes `CANCELLED`, and its `scheduled_at` is kept as history.

`POST /api/campaigns/:id/cancel-scheduled` (session and same-origin required):

| Response | Meaning |
| --- | --- |
| `200 { ok, alreadyCancelled: false, campaign }` | It was `SCHEDULED`; it is now `CANCELLED`. |
| `200 { ok, alreadyCancelled: true, campaign }` | A repeat. Nothing changed. |
| `404` | No such campaign. |
| `409` | It is not `SCHEDULED` (already `QUEUED`, `SENDING`, `COMPLETED`…). Nothing changed. |

It is separate from `POST /api/campaigns/:id/cancel`, which stops a send that is
already under way (`QUEUED`, `SENDING`, `PAUSED`). The two are kept apart on
purpose: a page that still shows "scheduled" can never cancel a campaign that has
since started. The request body is ignored; the status to move from is not the
client's to say.

**Cancel versus start.** Cancelling and starting are both a conditional write on
`status = 'SCHEDULED'` against the same campaign row, so exactly one wins:

- *Cancel first:* the campaign is `CANCELLED`, the worker no longer finds it (or,
  if the cancel is still uncommitted, its `SKIP LOCKED` claim steps over the row),
  and it never starts.
- *Start first:* the campaign is `QUEUED`, so the cancel matches nothing, waits
  for the start's transaction to finish, and answers `409`. The send carries on.

There are no pre-created jobs to withdraw: the queue does not exist until the
start, so the status is the whole story.

#### Changing the time of a scheduled campaign

While a campaign is `SCHEDULED` its time can be changed, from the list (**Change
time**) or from the campaign's own page (**Change time** beside *Cancel scheduled
send*). The action is offered for `SCHEDULED` campaigns only. It opens the same
form as the wizard's date and time step, filled with the current time in your
time zone (shown, with the current time in words), and **Save** is refused, in the
browser, for a time that is not in the future (checked again at the moment you press
it). The list and the page show the new time at once, without a reload.

`PATCH /api/campaigns/:id/schedule` with `{ "scheduledAt": "2026-10-16T09:00:00+02:00" }`
(session and same-origin required). The value is an ISO 8601 instant with a zone
designator, exactly as for `POST`, and is stored as UTC. It is the only thing the
endpoint reads; the status and every other field are not the client's to set.

| Response | Meaning |
| --- | --- |
| `200 { ok, scheduledAt, campaign }` | Moved. The campaign is still `SCHEDULED`, at the new time. |
| `400 { error, code, field }` | No time, a malformed one, or one that is not strictly in the future (`SCHEDULE_*`). Nothing changed. |
| `401` / `403` | No session / a request from another site. |
| `404` | No such campaign. |
| `409` | It is not `SCHEDULED` (`QUEUED`, `SENDING`, `PAUSED`, `COMPLETED`, `CANCELLED`, `DRAFT`), **or its time has already come** and the scheduler is entitled to start it. Nothing changed. |

**Moving versus starting.** Like cancelling, the move is one conditional write
against the campaign row the worker also claims:
`UPDATE … WHERE status = 'SCHEDULED' AND scheduled_at > now()` (database clock, the
worker's own). A check made before the write would not be enough, so this one is
made *by* the write:

- *Move first:* `scheduled_at` is the new time. The worker's claim re-reads the row
  under its lock, sees a time in the future and leaves it (or, if the move is still
  uncommitted, its `SKIP LOCKED` steps over the row). It starts at the new time.
- *Start first:* the campaign is `QUEUED` (or locked mid-start), so the move waits
  for that transaction, matches nothing and answers `409`. Nothing is changed.
- A campaign whose time has come but which a worker tick has not reached yet still
  reads `SCHEDULED`; the move is refused (`409`) as well, so a stale page cannot
  take a campaign back from the scheduler.

Nothing else is involved: no job is created or replaced, no timer exists to cancel,
no recipient row is written or changed. The worker reads `scheduled_at` afresh on
every tick, so it starts the campaign at the new time — later or earlier, as long as
it is still ahead — and never at the old one. The new time survives a restart
because it is in the database.

Every signed-in user is an admin of the whole workspace: the app has no campaign
owners or roles, so the checks are the session (`401`) and the same-origin rule
(`403`), not per-campaign ownership.

#### Time zones

- **What is stored.** `campaigns.scheduled_at` is a `timestamptz`: one absolute
  instant, held in UTC. The API sends and receives it as ISO 8601 with an explicit
  designator (`2026-10-15T08:30:00.000Z`; an offset such as `+02:00` is accepted
  on input and normalised). A value without one is rejected, so the server's own
  zone can never be guessed at. The server compares instants only.
- **Whose zone.** The app has no per-user time-zone setting, so the user's zone
  is **the browser's** (`Intl.DateTimeFormat().resolvedOptions().timeZone`, an
  IANA name such as `Europe/Madrid`). Someone travelling, or two admins in
  different countries, each see and enter times in their own zone. It is
  displayed next to the date and time fields, in the confirmation dialogs, and on
  the campaign page. No `scheduledTimezone` column is stored: the instant is what
  matters, and each viewer's own zone is what they should read it in.
- **One mechanism.** Everything that turns typed input into an instant, and an
  instant into text, lives in `src/lib/scheduling.ts` (`toScheduledAt`,
  `formatScheduledTime`, `describeLocalTimeZone`); the UI does not format these
  times by hand anywhere else. Times are shown in the viewer's locale with the
  zone's short name (e.g. `15 Oct 2026, 10:30 CEST`), and are marked up as
  `<time datetime="…Z">` with the IANA zone and UTC instant in the tooltip.
- **Daylight saving.** Offsets come from the IANA rules for the zone on the
  chosen date, never a fixed number. A wall-clock time that does not exist
  (clocks jump forward) is rejected with a message next to the time field. A time
  that happens twice (clocks go back) is not guessed: the wizard shows both
  instants, with their UTC offsets, and asks which is meant.

#### Running the scheduler

There is no separate scheduler service: **the worker tick is the scheduler**. Every
`POST /api/worker/tick` first looks for `SCHEDULED` campaigns that are due, then
does the ordinary queue work. So a scheduled campaign starts only if something
calls that endpoint regularly. Pick one:

| How | Command / setting |
| --- | --- |
| Docker Compose (`docker compose --profile app up`) | Nothing to set: the `worker` service is the ticker. (A single container without a worker service can set `RUN_INTERNAL_WORKER=true` instead.) |
| Any machine, as its own process | `npm run worker` (from a build: `node dist-scripts/worker-loop.cjs`). Point `WORKER_TARGET_URL` at the app if it is not on `127.0.0.1:$PORT`. Give it `WORKER_SECRET`. |
| Vercel Pro / any external cron | Call `POST /api/worker/tick` with `Authorization: Bearer $WORKER_SECRET` every minute (`vercel.json` already declares this). |

The ticker (`npm run worker`) keeps no schedule and no state of its own; the
schedule is `campaigns.scheduled_at` in Postgres. It ticks every
`WORKER_TICK_INTERVAL_SECONDS` (default 60). If a tick fails — the app is down,
the database is down, the request hangs past `WORKER_REQUEST_TIMEOUT_SECONDS`
(default 90) — it logs it and tries again after 5 s, 10 s, 20 s … never longer
than the normal interval, so it recovers within seconds of the app coming back
instead of waiting a full minute. Ticks never overlap, and on `SIGTERM`/`SIGINT`
it stops waiting at once and exits after the tick in progress.

#### Restarts and missed start times

Nothing about a schedule lives in memory: no `setTimeout`, no per-campaign timer.
A scheduled campaign is a row (`status = 'SCHEDULED'`, `scheduled_at`), and every
tick asks the database which rows are due (`scheduled_at <= now()`, by the
database's clock). So:

- **A restart changes nothing.** Stopping the app, the ticker, or both — cleanly
  or with `kill -9` — leaves the row as it was. Boot-time migrations do not touch
  it either.
- **A missed time is not lost.** If the app was down at 10:00 and back at 10:15,
  the first tick after it is back finds the campaign overdue and starts it
  (`SCHEDULED → QUEUED`), whatever the delay: the test is "due", never "due this
  minute". Several overdue campaigns are started one after another, **oldest
  schedule first**, each in its own transaction, so one that fails does not hold
  up the others; it stays `SCHEDULED` and is retried on the next tick. Up to
  `SCHEDULER_BATCH_LIMIT` (default 100) are started per tick; campaigns that
  fail do not use up that allowance.
- **The hourly rate limit still applies.** Starting a campaign only writes its
  recipient rows; delivery is the ordinary queue, so a backlog of overdue
  campaigns after an outage is sent at `SMTP_MAX_EMAILS_PER_HOUR`, oldest first,
  and never as a burst.
- **The actual start is logged.** Each start writes
  `[scheduler] activated campaign { campaignId, scheduledAt, activatedAt, lateSeconds, recipients }`
  (there is no metrics system to feed; `lateSeconds` is the delay).
  Cancelled campaigns, and campaigns already `QUEUED`, `SENDING` or
  `COMPLETED`, are never started.

**No campaign is left half-started.** Starting a campaign is one database
transaction: lock the campaign row (`FOR UPDATE SKIP LOCKED`), set `QUEUED`, write
the recipient rows. If the process dies anywhere in it — or the connection drops —
Postgres rolls it back, and the campaign is exactly as it was: `SCHEDULED`, no
rows, picked up again on the next tick. There is no moment at which it is `QUEUED`
without a queue, and none at which a queue exists that the status does not know
about. The recipient rows are `UNIQUE (campaign_id, email_normalized)` and written
with `ON CONFLICT DO NOTHING`, so even a repeated start cannot duplicate a job or
email anyone twice; and the sender only claims rows of `QUEUED`/`SENDING`
campaigns, so rows of a still-`SCHEDULED` or `CANCELLED` one are never sent.

As a safety net for data from before this was atomic (or an older instance that
is still running during a deploy), every tick also repairs a campaign that has
been `QUEUED` with **no recipient rows at all** for longer than
`STUCK_CAMPAIGN_GRACE_SECONDS` (default 300): it writes the queue, or, if nobody is
left to send to, cancels it (it sent nothing, so it is never shown as `COMPLETED`).
A `QUEUED` campaign whose queue has fully finished without a single send (say
everyone unsubscribed) is completed rather than left waiting.

**Several instances.** Any number of workers may tick at once: the campaign row
lock means exactly one starts a given campaign, and the others skip it without
waiting.

**When the database is down.** A tick that cannot reach it fails (HTTP 500, logged);
nothing is changed and no campaign moves. In a scheduler cycle, the first
connection failure ends the cycle rather than trying every campaign against a dead
database. The ticker retries within seconds; Postgres.js reconnects by itself, so
after a database restart the first few queries can report `CONNECTION_CLOSED`
before the pool is healthy again. The queue is in the same database, so there is
no separate queue to be down. If SMTP is unreachable, the batch is abandoned,
its attempts are handed back, and the same rows are sent when it returns.

### Pause / resume / cancel

The worker only claims from campaigns whose status is `QUEUED` or `SENDING`.

- **Pause** flips the status to `PAUSED`. Queued rows are not touched at all —
  they simply stop being claimed, and resume exactly where they stopped.
- **Cancel** flips the status to `CANCELLED` and moves the remaining queued rows
  to `CANCELLED` too — a distinct state from `FAILED`, so a cancellation never
  inflates the failure rate.
- Messages already handed to the SMTP server cannot be recalled. Rows currently
  `SENDING` are left to resolve on their own.

---

## Never sending the same email twice

This is the constraint the schema and the worker are built around.

1. **`UNIQUE(campaign_id, email_normalized)`.** One row per address per campaign,
   enforced by the database. Recipient generation uses `ON CONFLICT DO NOTHING`,
   so a double-clicked Send button or a retried HTTP request cannot duplicate the
   queue.
2. **Queuing a campaign is one transaction that starts by locking its row**
   (`FOR UPDATE SKIP LOCKED`, only while it is still `DRAFT`, or `SCHEDULED` and
   due). Only one concurrent request or worker can win; the loser gets a 409 (or,
   for a worker, skips the campaign). A failure rolls the whole thing back.
3. **Claiming is atomic and increments `attempts` before any SMTP traffic.** A
   row is accounted for even if the process dies immediately afterwards.
4. **Terminal updates are conditional on still being `SENDING`.** A late write
   from a worker that already lost its lease cannot resurrect or overwrite a row.
5. **Deduplication is case-insensitive**, so `Bob@Example.com` and
   `bob@example.com` are one recipient.

### The edge case that cannot be removed

SMTP has no transactional handshake with your database. There is a window
between "the SMTP server accepted the message" and "we committed `SENT`". If the
process dies inside that window, the lease eventually expires, the row returns to
`QUEUED`, and **that one recipient may receive the message twice.**

This is inherent to at-least-once delivery over SMTP — every mailer has it. What
this design guarantees is that the window is small (one database round-trip) and
bounded (`attempts` is incremented at claim time, so even a pathologically
crash-looping row exhausts its retries and stops rather than sending forever).

Eliminating it entirely would require a two-phase commit with the SMTP provider,
which SMTP does not offer.

---

## Open tracking, and what it does not tell you

Every recipient gets a 256-bit random `tracking_token` — never a sequential
database id, so opens cannot be enumerated or forged for someone else. A 1×1
transparent GIF is injected into the outgoing HTML:

```html
<img src="https://your-app.example.com/api/track/open/TOKEN" width="1" height="1" ...>
```

On request the endpoint does one `UPDATE` and returns the image:

```sql
UPDATE campaign_recipients
SET first_opened_at = COALESCE(first_opened_at, now()),   -- set once, ever
    last_opened_at  = now(),
    open_count      = open_count + 1
WHERE tracking_token = $1
```

`COALESCE` is what separates **unique opens** (`first_opened_at IS NOT NULL`)
from **total opens** (`open_count`). Requesting the pixel ten times is one unique
open and ten total opens.

Engagement is stored in its own columns. It never touches `delivery_status`, so
an open cannot overwrite delivery state.

### Limitations — please read before trusting the numbers

Open tracking is **approximate, and biased in both directions**:

- Most mail clients block remote images by default. Those readers are invisible:
  someone can read the whole email and never register an open.
- Apple Mail Privacy Protection, Gmail's image proxy, corporate security
  scanners and link-preview bots fetch images automatically. Those register opens
  that no human caused.
- Plain-text readers never load images at all.
- The pixel can only fire while the app is reachable at `APP_URL`.

So the UI calls the metric "opens", not "reads". Use it for relative comparison
between campaigns, not as evidence that a specific person read a specific email.

Previews and test sends **never** include the pixel, so they cannot pollute
statistics.

---

## Unsubscribes and the suppression list

Every campaign email carries an unsubscribe link built from a second 256-bit
random token, plus the standard headers for one-click unsubscribe:

```
List-Unsubscribe: <https://app/api/unsubscribe/TOKEN>, <mailto:unsubscribe@app>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

Place the link yourself with `{{unsubscribeUrl}}` anywhere in the body; if you
do not, a footer is appended automatically. There is no way to send without one.

Unsubscribing writes to a **global** `suppressions` table and immediately pulls
the address out of any queue it is sitting in. From then on:

- Recipient generation excludes suppressed addresses.
- The worker re-checks suppression at send time, so someone who unsubscribes
  mid-campaign is skipped (status `SUPPRESSED`, not `FAILED`).
- **Importing a CSV never re-subscribes anyone.** Suppressed addresses are
  skipped by the importer and reported in the import summary. Only an explicit
  removal on the Unsubscribed page can undo a suppression.

Reasons are `UNSUBSCRIBED` and `MANUAL` today; `HARD_BOUNCE` and `COMPLAINT`
already exist in the enum for when bounce processing is added. The worker treats
every reason identically, so adding one needs no worker change.

---

## Deployment

### Choosing a platform

The queue needs something to call `/api/worker/tick` roughly once a minute. That
requirement drives the whole decision.

| Platform | Verdict |
| --- | --- |
| **Docker on a small VPS / Fly.io / Railway / Render** | **Recommended.** Run the `web` and `worker` services (compose does), or one container with `RUN_INTERNAL_WORKER=true`. No external scheduler, no plan restrictions. ~$5/month. |
| **Vercel Pro** | Works well. `vercel.json` already declares a `* * * * *` cron. Function duration is capped at 60s, which the worker respects. |
| **Vercel Hobby (free)** | **Not sufficient on its own.** Hobby cron jobs run **once per day**, which cannot drive an 83-emails-per-minute queue. See below. |
| **Any host + an external cron** | Works anywhere. Point cron-job.org, GitHub Actions, or a cron on another machine at the worker endpoint. |

The app is portable: the worker is a plain authenticated HTTP endpoint, so the
scheduler is a deployment choice, not an architectural one.

### Docker (recommended)

One image runs every process; what a container does is its command:

| Service (`compose.yaml`) | Command | What it is |
| --- | --- | --- |
| `db` | `postgres:17-alpine` | PostgreSQL. Its data is the named volume `mailer-db`. Published on `127.0.0.1` only (port `5435`), for `npm run dev` and `npm test`; the other containers reach it over the compose network. |
| `migrate` | `node dist-scripts/migrate.cjs` | Applies the database migrations once and exits. `web` and `worker` wait for it, so no two containers ever migrate at the same time. |
| `web` | `node server.js` | The application, on port `3000`. |
| `worker` | `node dist-scripts/worker-loop.cjs` | The ticker. It calls the web server's worker endpoint every `WORKER_TICK_INTERVAL_SECONDS`; **that tick is the scheduler** (it starts due scheduled campaigns) **and** the queue processor (it sends what the rate limit allows). There is no separate scheduler process. |
| `mailpit` | profile `smtp-test` | A local mail server that keeps what it is sent instead of delivering it. |

```bash
cp .env.example .env
# fill in ENCRYPTION_KEY and WORKER_SECRET (openssl rand -hex 32 for each) and APP_URL

docker compose --profile app up --build -d        # migrate, web and worker
docker compose exec web node dist-scripts/create-admin.cjs you@example.com 'a-long-password'
```

Open http://localhost:3000 and sign in. That is the whole procedure; `docker compose ps` shows every service
`healthy` (see [Health checks](#health-checks)).

- **Migrations** run as their own step, not at every start, because several replicas starting together would
  race each other. After an upgrade run `docker compose --profile app run --rm migrate` (or just
  `docker compose --profile app up --build -d`, which runs it first). A single container can opt in to migrating
  when it starts with `AUTO_MIGRATE=true`; never turn that on for several replicas.
- **Only Postgres is needed for development:** `docker compose up -d db`, then `npm run dev`.
- **Test mail:** `docker compose --profile app --profile smtp-test up -d`, then in **Settings** use host `mailpit`,
  port `1025`, security `none` (or set `SMTP_HOST=mailpit SMTP_PORT=1025 SMTP_SECURITY=none
  SMTP_FROM_EMAIL=sender@example.test` in `.env`). Read the mail at http://localhost:8025. Nothing is delivered.
- **A managed database** instead of the bundled one: set `DATABASE_URL` for the `migrate`, `web` and `worker`
  services (edit `compose.yaml`, or start the image yourself) and do not start `db`.
- **Secrets** are never in the image or in `compose.yaml`. `ENCRYPTION_KEY` and `WORKER_SECRET` have no defaults, and
  compose refuses to start without them; a production server also refuses the `replace-me…` values from
  `.env.example`. Set `POSTGRES_PASSWORD` to your own URL-safe value for anything that is not a laptop.
- **Restarting is safe at any moment.** Every schedule (`campaigns.scheduled_at`) and the queue live in Postgres.
  `docker compose down` (without `-v`) and `up` keeps them; a campaign whose time passed while everything was
  down starts on the first tick after the containers are back; the rate limit counts sends already recorded in the
  database, so a restart cannot let it be exceeded. `docker compose down -v` deletes the database volume.
- **The image** runs as the unprivileged `node` user, holds no secrets, starts through `tini` (so `docker stop`
  reaches the server at once) and is built in three stages (dependencies, build, runtime). Only the standalone
  server, the static files, the migrations and the bundled scripts are in it.

```bash
docker build -t mailer .                     # the image alone
docker run --rm -p 3000:3000 --env-file .env mailer
```

### Vercel

1. Import the repository and add a PostgreSQL database (Neon, Supabase, Vercel
   Postgres — anything with a connection string).
2. Set the environment variables from [below](#environment-variables). `APP_URL`
   must be your real public URL, or tracking pixels and unsubscribe links will
   point at localhost.
3. Run migrations once against the production database:
   `DATABASE_URL='postgres://…' npm run db:migrate`
4. Create the admin: `DATABASE_URL='postgres://…' npm run create-admin -- you@example.com 'password'`
5. `vercel.json` registers the cron. **On Hobby, replace it with an external
   scheduler** (below).

Use a pooled connection string if your provider offers one; the client already
sets `prepare: false` for pgbouncer compatibility.

### Driving the worker from an external scheduler

Any of these work; the endpoint is idempotent, so extra or overlapping calls are
harmless.

```bash
# cron-job.org, UptimeRobot, or any cron host — every minute
curl -X POST https://your-app.example.com/api/worker/tick \
     -H "Authorization: Bearer $WORKER_SECRET"
```

GitHub Actions (note: scheduled workflows have a 5-minute minimum and are
frequently delayed under load — fine for a slow campaign, poor for a
time-sensitive one):

```yaml
name: mailer-worker
on:
  schedule: [{ cron: "*/5 * * * *" }]
  workflow_dispatch:
jobs:
  tick:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -sS -X POST "${{ secrets.APP_URL }}/api/worker/tick" \
               -H "Authorization: Bearer ${{ secrets.WORKER_SECRET }}"
```

With a 5-minute interval, raise `WORKER_TICK_INTERVAL_SECONDS` to `300` so each
tick claims a proportionally larger batch, and check that the batch still fits
inside your platform's function timeout.

### Free-tier limitations, concretely

- **Vercel Hobby cron runs once per day.** Minute-level schedules require Pro.
  With a daily tick you would send one batch per day. Either upgrade, or use an
  external scheduler, or self-host.
- **Vercel function duration:** 60s is the practical Hobby ceiling.
  `WORKER_TIME_BUDGET_MS` defaults to 45s so a batch always finishes cleanly.
- **No background workers on serverless.** There is no always-on process; this is
  precisely why the design is "database + scheduled endpoint + short batches".
- **Free Postgres tiers** (Neon, Supabase) suspend on idle and cap connections.
  Keep `DATABASE_POOL_MAX` small (5 is the default).
- **Serverless cold starts** add latency to a tick but cost nothing in
  correctness — an interrupted tick just leaves rows queued for the next one.

---

## Health checks

- `GET /api/health` — no sign-in needed. `200 {"status":"ok"}` when the server is up and can reach the database,
  `503 {"status":"unavailable"}` when it cannot. It says nothing else; the reason is in the server's log. The image's
  `HEALTHCHECK` and the compose `web` check use it.
- `worker` — healthy while the ticker has had an answer from the web server within three intervals and a minute
  (it touches `WORKER_HEARTBEAT_FILE` after each answered tick).
- `db` — `pg_isready`. `migrate` — succeeds or fails; `web` and `worker` do not start until it has succeeded.

```bash
docker compose ps                  # STATUS shows (healthy)
curl -s http://localhost:3000/api/health
```

## Continuous integration and the container image

`.github/workflows/ci.yml` runs on every push to `main` and every pull request. It uses no repository secrets, so a
pull request from a fork is checked the same way and cannot reach any:

1. **Lint, types, tests, build** — `npm ci` (from the lock file), `npm run lint`, `npm run typecheck`, `npm test`
   against a real Postgres service, `npm run build`, a check that the developer test panel is not in the
   production build, and `npm audit --omit=dev --audit-level=high`.
2. **Secret scan** — gitleaks over the repository history.
3. **Docker image** — builds the image (not pushed) and checks that it runs as a normal user and carries no `.env`,
   no test mail and no `sharp`.

`.github/workflows/publish-image.yml` publishes `ghcr.io/<owner>/<repository>` **only** after CI has passed on a push
to `main` (tags `latest` and `sha-<commit>`) or on a version tag such as `v1.2.3` (tag `1.2.3`). It never runs for a pull
request. There is no code formatter configured in this project, so there is no format check.

```bash
docker pull ghcr.io/<owner>/<repository>:latest
```

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `docker compose up` stops with `set ENCRYPTION_KEY in .env` | Both secrets are required. `openssl rand -hex 32` for each, in `.env`. |
| `web` is `unhealthy` | `docker compose logs web`. Usually `DATABASE_URL` is wrong, or the database is not up (`/api/health` answers `503`). |
| `web` and `worker` never start, `migrate` shows `Exited (1)` | A migration failed; `docker compose logs migrate`. |
| The worker logs `401` | `WORKER_SECRET` differs between `web` and `worker`, or is still the `replace-me…` example value. |
| Scheduled campaigns do not start | Nothing is calling the worker endpoint: start the `worker` service (or see [Running the scheduler](#running-the-scheduler)). |
| `ENCRYPTION_KEY is missing, too short or still the example value` | Set a real key. Changing it later means re-entering the stored SMTP password. |
| `429` when signing in | Too many failed attempts; wait about ten minutes, or restart the server. |
| `password authentication failed` after changing `POSTGRES_PASSWORD` | The database volume keeps the password it was created with. Change it inside Postgres, or `docker compose down -v` (deletes the data). |
| Port already in use | Set `WEB_PORT` or `DB_PORT` in `.env`. |
| Links in email point at `localhost` | `APP_URL` must be the public address. |

---

## Architecture and trade-offs

**One Next.js app, one PostgreSQL database. No Redis, no queue broker, no
container orchestration.** For a private tool sending a few thousand emails an
hour, Postgres `SKIP LOCKED` *is* a perfectly good job queue, and it comes with
transactions and durability for free. Adding Redis or RabbitMQ would add
infrastructure to run, secure and pay for, without making a single guarantee
stronger.

Some specific choices:

- **Drizzle over Prisma.** No query engine binary, faster serverless cold starts,
  and it stays out of the way when a piece of logic needs hand-written SQL — which
  the queue does.
- **A hand-written CSV parser.** ~90 lines. Its exact behaviour around quoted
  delimiters, CRLF, BOMs and ragged rows is something the tests pin down
  directly, which matters more here than a dependency would.
- **A `contenteditable` editor rather than TipTap.** The required feature set
  (headings, bold/italic/underline, links, lists, alignment, undo/redo) maps
  one-to-one onto `document.execCommand`. That is ~150 lines against a
  multi-megabyte editor framework, and it emits plain HTML that email clients
  understand. Everything it produces is sanitized server-side. If rich tables or
  collaborative editing are ever needed, swapping in TipTap touches one component.
- **Delivery status and engagement are separate columns.** `delivery_status` is
  SMTP state; `first_opened_at` / `open_count` are engagement. Folding "opened"
  into the status enum would make "sent and opened" unrepresentable.
- **Recipients store a snapshot of the contact.** Historical statistics do not
  depend on the current contents of a list, and deleting a contact does not erase
  send history (`contact_id` becomes `NULL`; the email is kept).
- **`custom_fields` JSONB on contacts and recipients.** New personalization
  fields need no migration and no worker change — `buildMergeValues` picks them
  up automatically.

### Data model

```
users ── sessions
app_settings                     (single row; SMTP password encrypted at rest)

contacts ──< contact_list_members >── contact_lists
   │                                        │
   │                                  campaign_lists
   │                                        │
   └────────────< campaign_recipients >── campaigns
                        │
                  (snapshot + delivery state + tracking/unsubscribe tokens)

suppressions      (global, keyed by normalized email)
smtp_send_log     (one row per SMTP attempt; the rate limiter's input)
```

Indexed for the queries that matter: `contacts.email_normalized` (unique),
`campaign_recipients (campaign_id, delivery_status)`,
`(delivery_status, next_attempt_at)` for the claim query, unique indexes on both
tokens, and `UNIQUE(campaign_id, email_normalized)`.

---

## Environment variables

See `.env.example` for the annotated list. The essentials:

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string. |
| `ENCRYPTION_KEY` | yes | 32 bytes (`openssl rand -hex 32`). Encrypts the stored SMTP password. Changing it means re-entering that password. |
| `WORKER_SECRET` | yes | Shared secret for `/api/worker/tick`. |
| `APP_URL` | production | Public base URL. Tracking pixels and unsubscribe links are built from it. |
| `SMTP_MAX_EMAILS_PER_HOUR` | no | Default `5000`. |
| `SMTP_RATE_SAFETY_FACTOR` | no | Default `0.95`. |
| `SMTP_MAX_ATTEMPTS` | no | Default `3`. |
| `WORKER_TIME_BUDGET_MS` | no | Default `45000`; stay under your platform's timeout. |
| `WORKER_BATCH_CAP` | no | Default `200` recipients per tick. |
| `WORKER_CONCURRENCY` | no | Default `4` parallel sends. |
| `WORKER_TICK_INTERVAL_SECONDS` | no | Default `60`. Match your actual cron interval. Scheduled campaigns start within about one interval of their time. |
| `WORKER_REQUEST_TIMEOUT_SECONDS` | no | Default `90`. `npm run worker` abandons a tick that takes longer and retries. |
| `SCHEDULER_BATCH_LIMIT` | no | Default `100`. Most scheduled campaigns started per tick. |
| `STUCK_CAMPAIGN_GRACE_SECONDS` | no | Default `300`. How long a `QUEUED` campaign may have no recipient rows before it is repaired. |
| `EMAIL_LANGUAGE` | no | `ru` (default) or `en`. The language of the text the app adds to emails (unsubscribe footer, plain-text line) and the fallback for the unsubscribe page. The admin's screen language does not affect it. |
| `ENABLE_EMAIL_TEST_PANEL` | no | `true` switches on the developer test panel, **only** in a development or test environment. Default `false`; never available in production. See [Developer test panel](#developer-test-panel). |
| `TEST_SMTP_OUTPUT_DIR`, `TEST_SMTP_PORT` | no | Where the built-in test SMTP server saves `.eml` files (default `received-emails/`, ignored by Git) and its port (default: any free one). Only used while the panel is on. |
| `RUN_INTERNAL_WORKER` | no | `true` only for a single container without a `worker` service: starts (and restarts) the ticker next to the server. |
| `AUTO_MIGRATE` | no | `true` makes a container apply migrations when it starts. Off by default; for one container only (see [Docker](#docker-recommended)). |
| `WORKER_HEARTBEAT_FILE` | no | A file the ticker touches after every answered tick; the compose health check for `worker` reads it. |
| `POSTGRES_PASSWORD`, `WEB_PORT`, `DB_PORT`, `MAILER_IMAGE` | no | Read by `compose.yaml` only. |
| `SMTP_*` | no | Override the stored settings entirely. Useful if you would rather keep credentials out of the database. **When set, the Settings page marks the affected fields as overridden**, so you are never editing a value that has no effect. |

Never commit real credentials. `.env` is gitignored; `.env.example` contains
placeholders only.

---

## Language (RU / EN)

The interface is in **Russian by default**, with an **RU | EN** switcher in the header
(and on the sign-in and unsubscribe pages). The choice is remembered in a cookie
(`locale`, one year); nothing about the URLs changes.

What follows the language you pick:

- every screen, dialog, tooltip and screen-reader label, the tab title and `<html lang>`;
- dates and numbers (`24 сент. 2026 г., 22:25` / `Sep 24, 2026, 10:25 PM`, `4 850` / `4,850`);
- the text of API errors. The app's own pages send an `x-locale` header with every
  request, so a refusal such as "Campaign not found" arrives as «Рассылка не найдена».
  A caller that says nothing (a script, cron, `curl`) gets **English**, the stable,
  documented wording.

What does **not** follow it:

- **Email text the app adds** (the unsubscribe footer and the plain-text line). It is a
  property of the deployment, so switching your screen to English cannot change what
  recipients receive. It is Russian unless you set `EMAIL_LANGUAGE=en`.
- **The public unsubscribe page** a recipient opens from an email: their own choice
  (the switcher on that page), else their browser's language, else `EMAIL_LANGUAGE`.
- Anything you or your contacts wrote: names, subjects, bodies, list names. SMTP
  servers' replies and log lines stay as they are.

Time zones are unaffected: times are always shown in the browser's own zone.

**Where the text lives.** Every string is in `src/i18n/messages/*.ts`, one entry per
key with both languages side by side (`{ en: "Cancel", ru: "Отмена" }`), so a missing
translation is a type error. Counts use plural sets (`plural(...)`; Russian needs
`one`, `few`, `many`, `other`). Components call `useT()` (or `translate()` on the
server); API routes throw a message *key*, and `handle()` words it for the caller.

**Guards.** `tests/i18n-dictionaries.test.ts` checks that every key is complete, has
the same `{placeholders}` in both languages, and that plural sets are whole.
`tests/i18n-hardcoded.test.ts` parses every screen and fails on any literal English
left in JSX text, text attributes (`title`, `placeholder`, `aria-label`, …), or
`confirm()`/`alert()`/error messages.

**Adding a language** means: add it to `Locale`/`LOCALES` in `src/i18n/locale.ts`,
give every entry a third value (the compiler lists what is missing), and add its
plural rules to `plural()` if it needs forms other than `one`/`other`.

---

## Developer test panel

A drawer for testing scheduled sending by hand, without waiting and without touching a real
mail server. It has a **test clock**, a **scheduler** you can start, stop and run once, a
**rate limit** you can shrink so it is visible, a form for **test campaigns**, an **event
journal**, a built-in **test SMTP server**, and a step-by-step **tour** and nine **scenarios**.

### Switching it on and off

```bash
# .env  (never commit it; .env.example only has the switch, set to false)
ENABLE_EMAIL_TEST_PANEL=true
```

Restart `npm run dev`. The panel exists only when **both** are true: `NODE_ENV` is `development` or
`test`, and the flag is exactly `true`. Off by default. If the environment cannot be told for
certain, it is off. Remove the line (or set `false`) and restart to switch it off.

You see a **Test Panel** button at the bottom right and an amber **TEST MODE** banner under the
header (it says when the test time is held or a test rate limit is set). The button opens a
drawer on the right that leaves the page usable beside it; it scrolls, and takes the whole width
on a narrow screen. `Escape` closes it.

While the panel is on, **all mail goes to the built-in test SMTP server**, whatever SMTP is
configured: it accepts only made-up `@test.invalid` addresses, delivers to nobody and saves each
message as an `.eml` file in `received-emails/`. Start `npm run dev` alone; the panel runs its own
scheduler (you do not need `npm run worker`).

### What each part does

| Part | What it does |
| --- | --- |
| **Test Clock** | Holds the application's clock at a moment you choose (a date, a time, a zone), moves it by 1 minute, 5 minutes, 1 hour or 1 day, or releases it. It changes what the *schedule rules* take as "now": whether a time you ask for is still ahead, and which scheduled campaigns the scheduler finds due. It never changes the computer's clock, and it is not read by mail delivery, retry waits or the rate-limit window, which stay in real time. |
| **Scheduler** | A loop inside the server that runs one cycle every few seconds. **Start** / **Stop** the loop, **Run now** for exactly one cycle. It is the same service the worker endpoint uses (`runSchedulerCycle`): it queues campaigns whose time has come and lets the queue send what the rate limit allows; it sends nothing itself. **Stop** changes no campaign status, and while it is stopped the worker endpoint is refused too. |
| **Queue and Rate Limit** | Shows the queue (waiting, active, completed, failed) and the limit in force, and sets "at most **N** emails per **W** seconds" for the existing rate limiter (rate = N / W). It is not a second limiter. **Reset to defaults** returns to the configured hourly ceiling. |
| **Create Test Campaign** | Makes a campaign for made-up recipients (you never type an address) and sends or schedules it by the ordinary services. Seven templates fill the form; a campaign that is already overdue is the one thing written directly, because the normal API refuses a past time. Every test campaign, and its list, is named `[TEST] …`. |
| **Test campaigns** | The campaigns made here: open, run a cycle, change time (the ordinary form), cancel (the ordinary confirmation), queue rows, status history, `scheduledAt` in UTC and in your zone, refresh, and **reset** (deletes only a campaign marked `[TEST]` whose every address is a test address). |
| **Event journal** | The scheduler's, the queue's and the rate limiter's own events, newest last, with identifiers and counts only: never an address, a message body or a credential. Clearing it clears the view, not the server's record. |

The test SMTP scenarios are decided by the generated recipient address, so they survive a restart:
**Success**, **Temporary failure** (`451` the first *k* times, then accepted, which exercises the
retries), **Permanent failure** (`550`, no retries) and **Slow response** (accepted after a delay).

### Ranges

They live in one place, `TEST_LIMITS` in `src/lib/testing/limits.ts`; the forms, the server's checks
and the help all read it, and a test keeps this table equal to it.

| Setting | Allowed | Recommended |
| --- | --- | --- |
| Scheduler interval | 1–300 seconds | 2–5 s for quick checks; 10–30 s for leaving it running |
| Max emails (rate limit) | 1–1000 | 2–10 |
| Interval (rate-limit window) | 1–3600 seconds | 1–10 s |
| Recipients of a test campaign | 1–500 | 3–10 quick; 20–50 to see rate limiting; 100–500 for a longer local run |
| Slow response delay | 1–20 seconds | 2–5 s |
| Temporary failures | 1–5 | 1–2 |
| Overdue by | 1–1440 minutes | 1–10 min |
| Test clock year | 2000–2100 | — |

This is a manual check, not a load test: everything runs in one local process.

### Help, the tour and the scenarios

Every field, switch, figure and button has a `?` next to it (a short tooltip, or a popover with what
it is, what it affects, unit, allowed values, recommended, when it applies, how long it lasts and
what to watch for). They open on click, on hover with a mouse and from the keyboard; `Escape` or a
click elsewhere closes them and the focus returns to the button. The registry is
`src/lib/testing/help.ts`, its wording is in `src/i18n/messages/testhelp.ts` (RU and EN), and no
range is typed into a text: ranges and recommendations are filled in from `TEST_LIMITS`.

**How to test scheduling** is a ten-step tour that lights each control to use and says what to
expect; it never presses anything for you. The **Scenarios** section has nine short guides (a normal
scheduled start, sending at once, cancelling, moving the time, a missed start, recovery after a
restart, rate limiting, a temporary and a permanent SMTP failure), each with what to set first, the
steps, the expected statuses and jobs, and how to put things back. The panel remembers only the
state of the panel itself (open, folded sections, tour step) in this browser's local storage.

### How it is kept out of production

- `NODE_ENV` and the flag are checked on the server, in one function (`testPanelEnabled`), by the
  admin layout and again by every test-only endpoint. A public (`NEXT_PUBLIC_*`) variable is never consulted.
- The test API lives in `src/app/api/dev/**/route.dev.ts`. `pageExtensions` in `next.config.ts` lists
  `dev.ts` only outside production, so a production build **does not contain those routes at all**;
  the panel's code is not bundled either.
- Where they do exist they answer `404` (the same as any unknown address) unless the tools are on, and
  then need a signed-in admin, and, for a change, a request from this site. This app has one kind of user
  (an admin of the whole workspace), so there is no separate developer role; the flag is what makes a
  session a tester.
- The test clock, the rate-limit override, the test scheduler and the test SMTP server each refuse to be
  used outside a development or test environment, and ignore anything left over.

---

## Development

```bash
npm run dev          # dev server
npm run worker       # the ticker, in a second terminal
npm run lint
npm run typecheck
npm test             # needs Postgres: docker compose up -d db
npm run build
npm run db:generate  # after editing src/lib/db/schema.ts
npm run db:migrate
```

### Tests

Tests run against a **real PostgreSQL database** (`mailer_test`, created
automatically on the same server as your dev database). The behaviour that
matters most — atomic claiming with `SKIP LOCKED`, `ON CONFLICT DO NOTHING`,
rolling-window counting — belongs to the database; mocking it would test the
mock rather than the guarantee. The worker tests additionally run a real
in-process SMTP server so retries and error classification are exercised against
actual SMTP replies.

Covered: CSV parsing, email normalization and validation, bulk-paste parsing,
duplicate removal, recipients on multiple lists, campaign recipient uniqueness,
rate-limit arithmetic, queue claiming under concurrency, lease recovery, retry
handling, suppressed recipients never being sent, open tracking, repeat opens
counting once, pause/resume/cancel, personalization, worker restart/resume,
credential redaction, HTML sanitization, and authentication on every endpoint.

---

## Security notes

- **Authentication** — single admin, scrypt-hashed password, opaque session
  tokens stored as SHA-256 hashes. Every admin page and API route requires a
  session; the only public endpoints are the tracking pixel and unsubscribe.
- **CSRF** — session cookies are `HttpOnly`, `SameSite=Lax`, `Secure` in
  production, and mutating endpoints additionally verify the `Origin` header.
  One-click unsubscribe is deliberately exempt (it is a public POST by design,
  authenticated by its token, and only ever removes consent).
- **SMTP credentials** — AES-256-GCM at rest, never serialized to the browser,
  and scrubbed out of every error message before it is logged or displayed.
- **HTML sanitization** — email bodies are sanitized on save with an allow-list
  (no scripts, event handlers, iframes, or `javascript:` URLs). Previews render
  inside a `sandbox=""` iframe.
- **Tokens** — 256 bits of CSPRNG output for tracking and unsubscribe URLs.
  Sequential database ids are never exposed.
- **SQL injection** — all queries are parameterized, both through Drizzle and in
  the hand-written SQL, which uses tagged templates.
- **Uploads** — 10 MB and 50,000-row ceilings, `.csv`/`.txt` only, decoded as
  UTF-8. CSV exports escape leading `=`/`+`/`-`/`@` to defuse spreadsheet formula
  injection.
- **Relay abuse** — no unauthenticated path can cause an email to be sent. Test
  sends and campaign queuing both require a session.
- **Password guessing** — after 8 failed sign-ins for an account (or 30 from one address) within 10 minutes,
  further attempts get `429` until the window passes, even with the right password. The counts are in the
  server's memory, so with several replicas each keeps its own: put a rate limit on the proxy too if the
  sign-in page faces the internet.
- **Errors** — an unexpected failure answers `500 {"error":"Unexpected error"}`; what went wrong is in the server's
  log only. A malformed id in an address is a `404`.
- **Headers** — every response carries `X-Frame-Options: DENY`, `X-Content-Type-Options`, a referrer and permissions
  policy, a content policy that forbids framing, a rewritten `<base>`, foreign form targets and plug-ins, and (in
  production) `Strict-Transport-Security`.
- **Secrets** — the worker endpoint compares its secret in constant time; a production server refuses the example
  `replace-me…` values for `ENCRYPTION_KEY` and `WORKER_SECRET`.
- **One workspace** — the application has one workspace and one kind of user (an admin); there is no per-user
  ownership of campaigns, so every admin sees and changes all of them. Give the sign-in to people you would trust
  with all of it.

### Known advisory

`npm audit` reports 4 moderate advisories, all one chain: `drizzle-kit` → `@esbuild-kit/esm-loader` →
`esbuild` ≤ 0.24.2 (a development server that answers requests from any website). `drizzle-kit` is a development
tool (`npm run db:generate`) that never starts that server, and none of it is in the production image:
`npm audit --omit=dev` reports **0** vulnerabilities, and that is what CI enforces. The only fix npm offers is
downgrading `drizzle-kit` to a version too old for this schema.
