# Локализация RU/EN — план реализации

> **Для исполнителя:** реализовывать задачу за задачей (`superpowers:executing-plans`), тесты первыми, шаги с чекбоксами.

**Цель:** весь интерфейс на русском (по умолчанию) с переключателем RU | EN; ошибки API, дата/числа и служебный текст писем локализованы.

**Архитектура:** собственный слой `src/i18n/` (словари `en.ts`/`ru.ts` с общими типизированными ключами, чистая `translate()`), язык в cookie `locale`, сервер читает cookie, клиент получает язык через `LocaleProvider` и `useT()`. API-ошибки выбрасываются ключами и переводятся в `handle()` по заголовку `x-locale`.

**Стек:** Next 16 (App Router), React 19, TypeScript, Vitest, `Intl.PluralRules`. Новых зависимостей нет.

**Спецификация:** `docs/superpowers/specs/2026-09-25-ru-en-localization-design.md`

## Глобальные ограничения

- Язык по умолчанию — `ru`; для API без `x-locale` и cookie — `en` (существующие тесты не меняются).
- Компоненты без `LocaleProvider` (SSR-тесты) работают на `en`.
- Значения статусов в БД и API не меняются; переводится только показ.
- Новых зависимостей, миграций и маршрутов вида `/ru/...` нет.
- Язык писем: `EMAIL_LANGUAGE` (`ru` по умолчанию), от языка интерфейса не зависит.
- Коммитов не делаем (в дереве незакоммиченная работа пользователя).
- Каждая задача заканчивается `npm run lint && npm run typecheck && npm test` без падений.

## Структура файлов

| Файл | Ответственность |
| --- | --- |
| `src/i18n/locale.ts` | `Locale`, `DEFAULT_LOCALE`, `LOCALE_COOKIE`, `normalizeLocale`, `intlTag`, `parseAcceptLanguage` |
| `src/i18n/translate.ts` | `translate(locale, key, params?)`, плюрали |
| `src/i18n/en.ts`, `src/i18n/ru.ts` | словари; `ru: Record<TKey,string>` |
| `src/i18n/server.ts` | `getLocale()`, `getApiLocale()` (читают `next/headers`) |
| `src/i18n/client.tsx` | `LocaleProvider`, `useT()` |
| `src/components/LanguageSwitcher.tsx` | кнопки RU / EN |
| `tests/i18n-*.test.ts(x)` | паритет словарей, плюрали, сканер хардкода, рендер на двух языках |

---

### Задача 1: ядро i18n

**Files:** Create `src/i18n/locale.ts`, `src/i18n/translate.ts`, `src/i18n/en.ts`, `src/i18n/ru.ts`; Test `tests/i18n-core.test.ts`, `tests/i18n-dictionaries.test.ts`.

**Interfaces — Produces:**
```ts
export type Locale = "ru" | "en";
export const DEFAULT_LOCALE: Locale = "ru";
export const LOCALE_COOKIE = "locale";
export function normalizeLocale(value: unknown): Locale | null;
export function parseAcceptLanguage(header: string | null | undefined): Locale | null;
export function intlTag(locale: Locale): string; // "ru-RU" | "en-US"
export type TKey = keyof typeof en;
export function translate(locale: Locale, key: TKey, params?: Record<string, string | number>): string;
```

- [ ] **Step 1: тест ядра** — `translate("ru","x.count",{count:1|2|5|11|21|22|25})` выбирает формы one/few/many; `{name}` подставляется; неизвестный параметр остаётся как есть; `normalizeLocale("RU")`→`ru`, `("fr")`→`null`; `parseAcceptLanguage("ru-RU,ru;q=0.9,en;q=0.8")`→`ru`, `("de,en")`→`en`, `(null)`→`null`.
- [ ] **Step 2: тест паритета** — все ключи `en` есть в `ru` и наоборот, значения непустые, множества `{параметров}` совпадают, у ключей с `.one` есть `.other` (en) и `.one/.few/.many/.other` (ru).
- [ ] **Step 3:** запустить, убедиться, что падают (модулей нет).
- [ ] **Step 4:** реализовать. Плюраль: `translate` ищет `key` без суффикса; если есть `key.one|few|many|other`, форма = `new Intl.PluralRules(intlTag(locale)).select(params.count)`, при отсутствии формы — `other`.
- [ ] **Step 5:** тесты зелёные.

### Задача 2: выбор языка, провайдер, переключатель

**Files:** Create `src/i18n/server.ts`, `src/i18n/client.tsx`, `src/components/LanguageSwitcher.tsx`; Modify `src/app/layout.tsx` (`<html lang>`, `generateMetadata`, `LocaleProvider`), `src/components/Nav.tsx`, `src/app/login/LoginForm.tsx`; Test `tests/i18n-switcher.test.tsx`.

**Interfaces:**
- Consumes: `translate`, `Locale` (Задача 1).
- Produces: `getLocale(): Promise<Locale>` (cookie → `ru`; вне запроса — `ru`), `getApiLocale(): Promise<Locale>` (`x-locale` → cookie → `en`), `useT(): { t, locale, formatDate(value), formatNumber(n) }`, `<LanguageSwitcher />`.

- [ ] **Step 1: тест** — `LanguageSwitcher` в разметке содержит две кнопки `RU` и `EN`, активная имеет `aria-pressed="true"`; `useT()` без провайдера возвращает `en`; `getLocale()` вне контекста запроса не бросает и даёт `ru`.
- [ ] **Step 2:** реализовать; переключатель пишет `document.cookie = "locale=ru; path=/; max-age=31536000; SameSite=Lax"` и вызывает `router.refresh()`.
- [ ] **Step 3:** `layout.tsx` → `async`; `<html lang={locale}>`; `generateMetadata` берёт `app.title` / `app.description` из словаря.
- [ ] **Step 4:** тесты зелёные, ручная проверка: переключатель меняет `<html lang>`.

### Задача 3: общие компоненты и форматирование

**Files:** Modify `src/components/ui.tsx` (StatusBadge → `status.*`, `Spinner`, `Modal` «Закрыть», `formatDate(value, locale?)`, `api()` шлёт `x-locale`), `src/lib/scheduling.ts` (тексты ошибок остаются английскими для API-контракта, но клиентская `toScheduledAt` возвращает `code` — UI переводит по коду), `src/components/CancelScheduledDialog.tsx`; Test `tests/i18n-shared.test.tsx`.

- [ ] Тесты: `StatusBadge` на `ru` даёт «Запланирована»/«Черновик»…, на `en` — прежние слова; `formatDate` на `ru` даёт `ru-RU`-формат; `api()` отправляет заголовок `x-locale`.
- [ ] Ошибки расписания: словарь `schedule.error.<CODE>`; компоненты показывают перевод по `code`, а не `error`. Существующие тесты `scheduling.test.ts` (английские тексты функции) не трогаем.

### Задача 4: ошибки API

**Files:** Modify `src/lib/auth.ts` (`HttpError(status, key, params?, details?)`), `src/lib/api.ts` (`badRequest/conflict/notFound(key, params?)`, `handle()` переводит через `getApiLocale()`), все `src/app/api/**/route.ts` и `src/lib/*.ts`, где есть литеральные сообщения (≈68 мест); словари `error.*`; Test `tests/i18n-api-errors.test.ts`.

- [ ] Тест: `POST /api/campaigns/:id/send` для не-`DRAFT` возвращает `This campaign is already QUEUED` (en, без заголовка) и русский текст с `x-locale: ru`; `code` и `field` в теле сохраняются.
- [ ] Совместимость: тексты `en` совпадают с прежними побуквенно, поэтому существующие `toMatch`/`toContain` проходят без правок.
- [ ] Строки успешных ответов (`Test email sent to …`) переводятся тем же `translate`; оценка длительности отдаётся числом `estimatedSeconds` (поле `estimatedDuration` сохраняется для совместимости).

### Задача 5: экраны (по разделам)

Для каждого раздела: вынести все видимые строки в ключи с префиксом раздела в `en.ts`, перевести в `ru.ts`, заменить в компонентах на `t()`, добавить SSR-тест на `ru` (ключевые фразы) и на `en` (без изменений).

- [ ] **5a.** `Nav`, `login`, дашборд `(admin)/page.tsx`, `NewCampaignForm`. Префиксы `nav.`, `login.`, `dashboard.`, `campaign.new.`.
- [ ] **5b.** Список кампаний: `CampaignsClient`, `CampaignsTable`, `CampaignReport`, `CampaignDetail`, `CancelScheduledDialog`. Префиксы `campaigns.`, `report.`, `cancel.`. Существующие `tests/campaign-list-ui.test.tsx` остаются зелёными на `en`.
- [ ] **5c.** Мастер `CampaignWizard` (шаги, расписание, неоднозначное время). Префикс `wizard.`. `tests/send-step-ui.test.tsx` остаётся зелёным на `en`; добавить ru-вариант.
- [ ] **5d.** `ContactsTable`, `ImportPanel`, `ListsClient`, `ListDetailClient`, `SuppressionsClient`. Префиксы `contacts.`, `import.`, `lists.`, `suppressions.`.
- [ ] **5e.** `SettingsForm` (включая подсказки по SMTP). Префикс `settings.`.
- [ ] **5f.** `Editor` (панель, `title`, `aria-label`, диалог ссылки). Префикс `editor.`.
- [ ] **5g.** Страница отписки и `UnsubscribeForm` (язык: cookie → `Accept-Language` → `EMAIL_LANGUAGE`, свой переключатель); `message-builder.ts` (подвал, текстовая строка, `EMAIL_LANGUAGE`); тестовые письма. Префиксы `unsubscribe.`, `email.`. Тесты: письмо на `ru` и на `en`.

### Задача 6: сканер хардкода и финальный паритет

**Files:** Create `tests/i18n-hardcoded.test.ts`.

- [ ] Сканер: через `typescript` (`ts.createSourceFile`) обойти `src/app/**/*.tsx`, `src/components/**/*.tsx`; собрать `JsxText` и значения атрибутов `title`, `placeholder`, `aria-label`, `alt`, `label`; если содержит слово из ≥3 латинских букв вне списка исключений (`HTML`, `SMTP`, `CSV`, `URL`, `API`, `Mailer`, `RU`, `EN`, `STARTTLS`, `TLS`, `SSL`, `SendPulse`, `Ctrl`, `H1`–`H3`, примеры адресов и т.п.), тест падает с `файл:строка`.
- [ ] Прогнать, исправить найденное, повторять до зелёного.

### Задача 7: документация и проверка

- [ ] `README.md` (раздел «Language / Язык»: переключатель, cookie, `EMAIL_LANGUAGE`, как добавить язык), `.env.example` (`EMAIL_LANGUAGE=ru`).
- [ ] `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`; проверка под `TZ=Pacific/Kiritimati`.
- [ ] Ручная проверка на запущенном dev-сервере: переключатель, обе локали на всех разделах, страница отписки, письмо в Mailpit/заглушке.
