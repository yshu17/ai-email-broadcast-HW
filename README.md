# Mailer — рассылки с запланированной отправкой

Самостоятельно размещаемый менеджер email-рассылок (Next.js, TypeScript, PostgreSQL, Drizzle, Nodemailer): импорт контактов,
письмо, отправка через свой SMTP с ограничением скорости, отслеживание доставки и открытий. Домашнее задание добавляет
**запланированную отправку**: выбор даты и времени (хранится в UTC), автоматический запуск через существующую очередь и
rate limiter, отмена и перенос времени, восстановление после перезапуска. Для ручной проверки есть dev-панель с тестовым
временем (только development/test).

Полная документация (жизненный цикл, гонки, перенос, Docker, безопасность, CI, диагностика): [docs/README.full.md](docs/README.full.md).

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

## Быстрый старт

Нужны Node.js 22+ и Docker.

```bash
npm install
cp .env.example .env        # задать ENCRYPTION_KEY и WORKER_SECRET: openssl rand -hex 32
docker compose up -d db     # PostgreSQL
npm run db:migrate
npm run create-admin -- you@example.com "a-long-password"
npm run dev                 # http://localhost:3000
npm run worker              # второй терминал: планировщик и очередь
```

Быстро проверить планирование без ожидания: в `.env` поставить `ENABLE_EMAIL_TEST_PANEL=true`, перезапустить `npm run dev`
и открыть кнопку **Тестовая панель** (тестовое время, запуск планировщика, тестовые кампании; `npm run worker` не нужен).

## Локальный запуск

| Что | Команда |
| --- | --- |
| Миграции | `npm run db:migrate` |
| Frontend и backend | `npm run dev` или `npm run build && npm start` |
| Worker и scheduler (один процесс, тик каждую минуту) | `npm run worker` |
| Всё в Docker | `docker compose --profile app up --build -d`, затем `docker compose exec web node dist-scripts/create-admin.cjs you@example.com "a-long-password"` |
| Тесты (нужен PostgreSQL) | `npm test` |
| Линтер, типы, сборка | `npm run lint`, `npm run typecheck`, `npm run build` |

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
| 15. Перенос разрешён, пока статус `SCHEDULED`, даже если прежнее время наступило, но worker ещё не забрал кампанию | PARTIAL | Разрешён для `SCHEDULED` с будущим `scheduled_at`. Если время **уже наступило**, перенос отклоняется (`409`), чтобы устаревшая страница не отбирала кампанию у планировщика | `npx vitest run tests/reschedule.test.ts tests/reschedule-times.test.ts` | Требование в формулировке задания («разрешён, даже если прежнее время наступило») сознательно реализовано строже: см. [Changing the time of a scheduled campaign](docs/README.full.md#changing-the-time-of-a-scheduled-campaign) |
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
- `npm audit` (полное дерево) показывает 4 moderate в dev-инструментах, см. [Known advisory](docs/README.full.md#known-advisory).

```text
Основная задача: NOT READY
Дополнительное задание: NOT READY
Проект в целом: NOT READY
```

Основная задача не `READY`: критерий 2 — `PARTIAL` (часовой пояс берётся из браузера, отдельного выбора зоны нет). Дополнительное
задание не `READY`: критерий 15 реализован строже формулировки (`PARTIAL`). Остальные 24 критерия — `DONE`.
