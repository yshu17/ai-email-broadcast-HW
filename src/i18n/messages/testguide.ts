import type { Messages } from "../define";

/**
 * The tour "How to test scheduling" and the nine teaching scenarios of the developer test panel,
 * in both languages. The numbers in them are placeholders (`{minutes}`, `{rateMax}`, ...) filled
 * from the templates and presets they refer to, so they follow those if those change.
 *
 * A scenario's `setup`, `steps`, `statuses`, `jobs` and `reset` are lists: one item per line.
 */
export const testguide = {
  "tour.title": { en: "How to test scheduling", ru: "Как протестировать планирование" },
  "tour.stepOf": { en: "Step {n} of {total}", ru: "Шаг {n} из {total}" },
  "tour.expected": { en: "Expected result:", ru: "Ожидаемый результат:" },
  "tour.back": { en: "Back", ru: "Назад" },
  "tour.next": { en: "Next", ru: "Далее" },
  "tour.finish": { en: "Finish", ru: "Завершить" },
  "tour.close": { en: "Close", ru: "Закрыть" },
  "tour.restart": { en: "Start over", ru: "Сначала" },

  "tour.step.setClock.title": { en: "Hold the test clock", ru: "Зафиксируйте тестовое время" },
  "tour.step.setClock.body": {
    en: "In Test Clock choose Fixed test time, enter a date and a time (say today at 10:25) and press Set. Nothing changes until you press Set.",
    ru: "В разделе «Тестовое время» выберите «Фиксированное тестовое время», введите дату и время (например, сегодня 10:25) и нажмите «Задать». Пока вы не нажмёте «Задать», ничего не изменится.",
  },
  "tour.step.setClock.expected": {
    en: "Application time shows the moment you set, and the mode reads Fixed test time.",
    ru: "«Время приложения» показывает заданный момент, а режим — «Фиксированное тестовое время».",
  },
  "tour.step.rateLimit.title": { en: "Make the rate limit visible", ru: "Сделайте rate limit наглядным" },
  "tour.step.rateLimit.body": {
    en: "In Queue and Rate Limit enter Max emails {rateMax} and Interval {rateWindow} seconds (or press the matching preset) and press Apply.",
    ru: "В разделе «Очередь и rate limit» введите «Макс. писем» {rateMax} и «Интервал» {rateWindow} с (или нажмите подходящий готовый набор) и нажмите «Применить».",
  },
  "tour.step.rateLimit.expected": {
    en: "Current limit reads {rateMax} emails per {rateWindow} s, tagged “test”.",
    ru: "«Текущий лимит»: {rateMax} за {rateWindow} с, с пометкой «тест».",
  },
  "tour.step.createCampaign.title": {
    en: "Create a campaign that starts in {minutes} minutes",
    ru: "Создайте кампанию с запуском через {minutes} мин",
  },
  "tour.step.createCampaign.body": {
    en: "In Create Test Campaign press the template “Starts in {minutes} min”, look at the filled form, then press Create test campaign.",
    ru: "В разделе «Создать тестовую кампанию» нажмите шаблон «Запуск через {minutes} мин», посмотрите на заполненную форму и нажмите «Создать тестовую кампанию».",
  },
  "tour.step.createCampaign.expected": {
    en: "A new [TEST] campaign is selected in Test campaigns, with {recipients} recipients to come.",
    ru: "В «Тестовых кампаниях» выбрана новая кампания [TEST]; получателей будет {recipients}.",
  },
  "tour.step.checkScheduled.title": { en: "Check that it is scheduled", ru: "Проверьте, что она запланирована" },
  "tour.step.checkScheduled.body": {
    en: "In Test campaigns read the status and the moment it is due, in UTC and in your time zone.",
    ru: "В «Тестовых кампаниях» прочитайте статус и момент запуска: в UTC и в вашем часовом поясе.",
  },
  "tour.step.checkScheduled.expected": {
    en: "Status: SCHEDULED. The queue counts are zero, because a scheduled campaign has no queue yet.",
    ru: "Статус: «Запланирована». Счётчики очереди нулевые: у запланированной кампании очереди ещё нет.",
  },
  "tour.step.advance.title": { en: "Move the clock forward", ru: "Продвиньте время" },
  "tour.step.advance.body": {
    en: "In Test Clock choose the step “{minutes} minutes” and press Advance.",
    ru: "В разделе «Тестовое время» выберите шаг «{minutes} минут» и нажмите «Продвинуть».",
  },
  "tour.step.advance.expected": {
    en: "Application time is now the moment the campaign is due. The campaign itself has not changed yet.",
    ru: "«Время приложения» стало моментом запуска кампании. Сама кампания пока не изменилась.",
  },
  "tour.step.runCycle.title": { en: "Run a scheduler cycle", ru: "Запустите цикл планировщика" },
  "tour.step.runCycle.body": {
    en: "In Scheduler press Run now, or wait for the next automatic cycle.",
    ru: "В разделе «Планировщик» нажмите «Запустить сейчас» или дождитесь следующего автоматического цикла.",
  },
  "tour.step.runCycle.expected": {
    en: "Due campaigns found: 1, and the last result shows one campaign started.",
    ru: "«Найдено готовых кампаний»: 1, а в результате видно, что одна кампания запущена.",
  },
  "tour.step.seeQueued.title": { en: "See it go to the queue", ru: "Увидьте переход в очередь" },
  "tour.step.seeQueued.body": {
    en: "Look at the campaign's status again. Open Queue rows to see its recipients.",
    ru: "Ещё раз посмотрите на статус кампании. Откройте «Записи очереди», чтобы увидеть получателей.",
  },
  "tour.step.seeQueued.expected": {
    en: "Status: QUEUED, or SENDING once the queue starts. It has {recipients} recipient rows.",
    ru: "Статус: «В очереди» либо «Отправляется», когда очередь начнёт работу. Записей получателей: {recipients}.",
  },
  "tour.step.watchRate.title": { en: "Watch the rate limiter", ru: "Понаблюдайте за rate limiter" },
  "tour.step.watchRate.body": {
    en: "Watch the queue counts and the event journal. With {rateMax} emails per {rateWindow} seconds only {rateMax} go out per window: after the window passes, press Run now again to release the next ones.",
    ru: "Следите за счётчиками очереди и журналом событий. При лимите «{rateMax} за {rateWindow} с» уходит только {rateMax} за окно: когда окно пройдёт, снова нажмите «Запустить сейчас», чтобы выпустить следующие.",
  },
  "tour.step.watchRate.expected": {
    en: "Completed jobs rise by {rateMax} per window, and the journal says what the rate limiter allowed.",
    ru: "«Выполненные задания» растут на {rateMax} за окно, а журнал показывает, что разрешил rate limiter.",
  },
  "tour.step.finalStatus.title": { en: "Check the final status", ru: "Проверьте итоговый статус" },
  "tour.step.finalStatus.body": {
    en: "When the queue is empty, read the status of the campaign once more.",
    ru: "Когда очередь опустеет, ещё раз прочитайте статус кампании.",
  },
  "tour.step.finalStatus.expected": {
    en: "Status: COMPLETED, every recipient sent. The emails are saved as .eml files in the folder shown in Queue and Rate Limit.",
    ru: "Статус: «Завершена», все получатели отправлены. Письма сохранены файлами .eml в папке, показанной в «Очереди и rate limit».",
  },
  "tour.step.cleanup.title": { en: "Put everything back", ru: "Верните всё обратно" },
  "tour.step.cleanup.body": {
    en: "In Test Clock press Reset to real time, and in Queue and Rate Limit press Reset to defaults. You may also reset the test campaign.",
    ru: "В «Тестовом времени» нажмите «Сбросить на реальное время», а в «Очереди и rate limit» — «Сбросить на стандартные». Тестовую кампанию тоже можно сбросить.",
  },
  "tour.step.cleanup.expected": {
    en: "The mode reads Real time and the current limit is the configured one. The test banner shows nothing held.",
    ru: "Режим — «Реальное время», а текущий лимит — настроенный. В баннере тестового режима ничего не зафиксировано.",
  },

  /* ---------------------------------------------------------------- scenarios */
  "scenario.regular.title": { en: "Check a normal scheduled start", ru: "Проверить обычный запланированный запуск" },
  "scenario.regular.setup": {
    en: "Test Clock: choose Fixed test time, set a date and a time (say 10:25) and press Set.\nQueue and Rate Limit: leave the limit alone, or press Reset to defaults.\nScheduler: running, or use Run now.",
    ru: "Тестовое время: выберите «Фиксированное тестовое время», задайте дату и время (например, 10:25) и нажмите «Задать».\nОчередь и rate limit: оставьте лимит как есть или нажмите «Сбросить на стандартные».\nПланировщик: работает, либо используйте «Запустить сейчас».",
  },
  "scenario.regular.steps": {
    en: "In Create Test Campaign press “Starts in {minutes} min”, then Create test campaign.\nIn Test campaigns check that the status is SCHEDULED and scheduledAt is {minutes} minutes ahead.\nIn Test Clock choose the step “{minutes} minutes” and press Advance.\nIn Scheduler press Run now.\nWatch the status and the queue counts until the campaign completes.",
    ru: "В «Создать тестовую кампанию» нажмите «Запуск через {minutes} мин», затем «Создать тестовую кампанию».\nВ «Тестовых кампаниях» проверьте, что статус «Запланирована», а scheduledAt впереди на {minutes} мин.\nВ «Тестовом времени» выберите шаг «{minutes} минут» и нажмите «Продвинуть».\nВ «Планировщике» нажмите «Запустить сейчас».\nСледите за статусом и счётчиками очереди, пока кампания не завершится.",
  },
  "scenario.regular.statuses": {
    en: "SCHEDULED, then QUEUED, then SENDING, then COMPLETED.",
    ru: "«Запланирована», затем «В очереди», затем «Отправляется», затем «Завершена».",
  },
  "scenario.regular.jobs": {
    en: "0 queue rows while it is SCHEDULED.\nThen {recipients} rows, all SENT.",
    ru: "0 записей очереди, пока она «Запланирована».\nЗатем записей: {recipients}, все «Отправлено».",
  },
  "scenario.regular.reset": {
    en: "Test Clock: Reset to real time.\nOptionally, Reset campaign in Test campaigns.",
    ru: "Тестовое время: «Сбросить на реальное время».\nПри желании — «Сбросить кампанию» в «Тестовых кампаниях».",
  },

  "scenario.immediate.title": { en: "Check sending right away", ru: "Проверить немедленную отправку" },
  "scenario.immediate.setup": {
    en: "Nothing special: the test clock can stay on real time.",
    ru: "Ничего особенного: тестовое время может оставаться реальным.",
  },
  "scenario.immediate.steps": {
    en: "In Create Test Campaign choose “Send now” and the SMTP scenario Success, then press Create.\nThe status is QUEUED at once: it took the ordinary Send path.\nPress Run now, or wait for the next cycle.\nWatch it become SENDING, then COMPLETED.",
    ru: "В «Создать тестовую кампанию» выберите «Отправить сейчас» и сценарий SMTP «Успех», затем нажмите «Создать».\nСтатус сразу «В очереди»: она пошла обычным путём отправки.\nНажмите «Запустить сейчас» или дождитесь следующего цикла.\nНаблюдайте, как она становится «Отправляется», затем «Завершена».",
  },
  "scenario.immediate.statuses": {
    en: "QUEUED, then SENDING, then COMPLETED.",
    ru: "«В очереди», затем «Отправляется», затем «Завершена».",
  },
  "scenario.immediate.jobs": {
    en: "As many queue rows as recipients you chose, all SENT.",
    ru: "Столько записей очереди, сколько получателей вы выбрали, все «Отправлено».",
  },
  "scenario.immediate.reset": { en: "Reset campaign in Test campaigns.", ru: "«Сбросить кампанию» в «Тестовых кампаниях»." },

  "scenario.cancel.title": { en: "Check cancelling", ru: "Проверить отмену" },
  "scenario.cancel.setup": {
    en: "Test Clock: fixed test time, as in the first scenario.",
    ru: "Тестовое время: фиксированное, как в первом сценарии.",
  },
  "scenario.cancel.steps": {
    en: "Press the template “Starts in {minutes} min”, then Create test campaign.\nWith the campaign selected press Cancel and confirm.\nAdvance the clock by “{minutes} minutes”, then press Run now.",
    ru: "Нажмите шаблон «Запуск через {minutes} мин», затем «Создать тестовую кампанию».\nПри выбранной кампании нажмите «Отменить» и подтвердите.\nПродвиньте часы на «{minutes} минут», затем нажмите «Запустить сейчас».",
  },
  "scenario.cancel.statuses": {
    en: "SCHEDULED, then CANCELLED. It never becomes QUEUED.",
    ru: "«Запланирована», затем «Отменена». В очередь она не попадает.",
  },
  "scenario.cancel.jobs": {
    en: "0 queue rows, and no .eml file appears.",
    ru: "0 записей очереди, и файл .eml не появляется.",
  },
  "scenario.cancel.reset": {
    en: "Test Clock: Reset to real time.\nReset campaign in Test campaigns.",
    ru: "Тестовое время: «Сбросить на реальное время».\n«Сбросить кампанию» в «Тестовых кампаниях».",
  },

  "scenario.reschedule.title": { en: "Check moving the start time", ru: "Проверить перенос времени" },
  "scenario.reschedule.setup": {
    en: "Test Clock: fixed test time, say 10:25.",
    ru: "Тестовое время: фиксированное, например 10:25.",
  },
  "scenario.reschedule.steps": {
    en: "Press “Starts in {minutes} min” and Create: it is due at 10:30.\nPress Change time and choose a later time, say 10:40, then Save.\nAdvance by “{minutes} minutes” and press Run now: the old time has passed, but the campaign stays SCHEDULED.\nAdvance until the new time (10:40), pressing Run now: it starts.",
    ru: "Нажмите «Запуск через {minutes} мин» и «Создать»: запуск на 10:30.\nНажмите «Изменить время», выберите более позднее время, например 10:40, и сохраните.\nПродвиньте на «{minutes} минут» и нажмите «Запустить сейчас»: старое время прошло, но кампания остаётся «Запланирована».\nПродвигайте до нового времени (10:40), нажимая «Запустить сейчас»: она запустится.",
  },
  "scenario.reschedule.statuses": {
    en: "SCHEDULED at the old time, still SCHEDULED after it, then QUEUED at the new time.",
    ru: "«Запланирована» на старое время, по его прошествии по-прежнему «Запланирована», затем «В очереди» в новое время.",
  },
  "scenario.reschedule.jobs": {
    en: "0 queue rows before the new time.\nThen {recipients} rows.",
    ru: "0 записей очереди до нового времени.\nЗатем записей: {recipients}.",
  },
  "scenario.reschedule.reset": {
    en: "Test Clock: Reset to real time.\nReset campaign in Test campaigns.",
    ru: "Тестовое время: «Сбросить на реальное время».\n«Сбросить кампанию» в «Тестовых кампаниях».",
  },

  "scenario.missed.title": { en: "Check a missed start", ru: "Проверить пропущенный запуск" },
  "scenario.missed.setup": {
    en: "Nothing special: the test clock can stay on real time.",
    ru: "Ничего особенного: тестовое время может оставаться реальным.",
  },
  "scenario.missed.steps": {
    en: "Press the template “Overdue by {overdueMinutes} min”, then Create test campaign.\nThe status is SCHEDULED and scheduledAt is in the past, which the normal API would refuse.\nPress Run now: the scheduler finds it, however late it is.",
    ru: "Нажмите шаблон «Просрочена на {overdueMinutes} мин», затем «Создать тестовую кампанию».\nСтатус «Запланирована», а scheduledAt в прошлом: обычный API такое запретил бы.\nНажмите «Запустить сейчас»: планировщик находит её, как бы поздно это ни было.",
  },
  "scenario.missed.statuses": {
    en: "SCHEDULED, then QUEUED, SENDING and COMPLETED.",
    ru: "«Запланирована», затем «В очереди», «Отправляется» и «Завершена».",
  },
  "scenario.missed.jobs": {
    en: "{overdueRecipients} queue rows, all SENT.",
    ru: "Записей очереди: {overdueRecipients}, все «Отправлено».",
  },
  "scenario.missed.reset": { en: "Reset campaign in Test campaigns.", ru: "«Сбросить кампанию» в «Тестовых кампаниях»." },

  "scenario.restart.title": { en: "Check recovery after a restart", ru: "Проверить восстановление после перезапуска" },
  "scenario.restart.setup": {
    en: "Test Clock: fixed test time.\nCreate the template “Starts in {minutes} min” and note its scheduledAt (UTC).",
    ru: "Тестовое время: фиксированное.\nСоздайте шаблон «Запуск через {minutes} мин» и запишите его scheduledAt (UTC).",
  },
  "scenario.restart.steps": {
    en: "Stop the server (Ctrl+C in the terminal running “npm run dev”) and start it again.\nOpen the panel. The test clock is back to real time (it lives only in memory), the test scheduler is running again, and the campaign is still SCHEDULED with the same scheduledAt.\nSet the test time to just before that moment and Advance, then press Run now: the campaign starts.",
    ru: "Остановите сервер (Ctrl+C в терминале с «npm run dev») и запустите снова.\nОткройте панель. Тестовое время снова реальное (оно живёт только в памяти), тестовый планировщик опять работает, а кампания по-прежнему «Запланирована» с тем же scheduledAt.\nЗадайте тестовое время чуть раньше этого момента и продвиньте, затем нажмите «Запустить сейчас»: кампания запустится.",
  },
  "scenario.restart.statuses": {
    en: "SCHEDULED before and after the restart, then QUEUED and COMPLETED.",
    ru: "«Запланирована» до и после перезапуска, затем «В очереди» и «Завершена».",
  },
  "scenario.restart.jobs": {
    en: "0 queue rows until it starts.\nThen {recipients} rows, none duplicated.",
    ru: "0 записей очереди, пока она не стартует.\nЗатем записей: {recipients}, без дублей.",
  },
  "scenario.restart.reset": {
    en: "Test Clock: Reset to real time.\nReset campaign in Test campaigns.",
    ru: "Тестовое время: «Сбросить на реальное время».\n«Сбросить кампанию» в «Тестовых кампаниях».",
  },

  "scenario.rate.title": { en: "Check rate limiting", ru: "Проверить rate limiting" },
  "scenario.rate.setup": {
    en: "Queue and Rate Limit: Max emails {rateMax}, Interval {rateWindow} seconds, then press Apply.",
    ru: "«Очередь и rate limit»: «Макс. писем» {rateMax}, «Интервал» {rateWindow} с, затем «Применить».",
  },
  "scenario.rate.steps": {
    en: "Press the template “Large campaign for the rate limit” ({bigRecipients} recipients, sent now), then Create.\nPress Run now: {rateMax} emails go out.\nPress Run now again at once: nothing more is sent, the queue state reads Limited and the journal says the limit was reached.\nWait {rateWindow} seconds and press Run now: the next {rateMax} go.",
    ru: "Нажмите шаблон «Большая кампания для rate limit» (получателей: {bigRecipients}, отправка сразу), затем «Создать».\nНажмите «Запустить сейчас»: уходит писем: {rateMax}.\nСразу снова нажмите «Запустить сейчас»: больше ничего не отправляется, состояние очереди — «Ограничено», а журнал сообщает о достижении лимита.\nПодождите {rateWindow} с и нажмите «Запустить сейчас»: уходят следующие {rateMax}.",
  },
  "scenario.rate.statuses": {
    en: "QUEUED, then SENDING for a while, then COMPLETED once all {bigRecipients} are done.",
    ru: "«В очереди», затем некоторое время «Отправляется», затем «Завершена», когда все {bigRecipients} обработаны.",
  },
  "scenario.rate.jobs": {
    en: "{rateMax} more SENT per {rateWindow}-second window.\nWaiting jobs fall from {bigRecipients} to 0.",
    ru: "Ещё по {rateMax} «Отправлено» за окно в {rateWindow} с.\nОжидающие задания снижаются с {bigRecipients} до 0.",
  },
  "scenario.rate.reset": {
    en: "Queue and Rate Limit: Reset to defaults.\nReset campaign in Test campaigns.",
    ru: "«Очередь и rate limit»: «Сбросить на стандартные».\n«Сбросить кампанию» в «Тестовых кампаниях».",
  },

  "scenario.tempfail.title": { en: "Check a temporary SMTP failure", ru: "Проверить временную ошибку SMTP" },
  "scenario.tempfail.setup": {
    en: "Nothing special: the test clock can stay on real time.",
    ru: "Ничего особенного: тестовое время может оставаться реальным.",
  },
  "scenario.tempfail.steps": {
    en: "Press the template “Temporary SMTP failure” ({tempRecipients} recipients), then Create.\nPress Run now: every email is refused with a temporary 451.\nOpen Queue rows: each is waiting, with 1 attempt, a last error and a next attempt about a minute ahead (real time, not the test clock).\nPress Run now again: nothing is tried before that time.\nAfter it, press Run now: the retry succeeds.",
    ru: "Нажмите шаблон «Временная ошибка SMTP» (получателей: {tempRecipients}), затем «Создать».\nНажмите «Запустить сейчас»: каждое письмо отклоняется временной ошибкой 451.\nОткройте «Записи очереди»: каждое ждёт, с 1 попыткой, последней ошибкой и следующей попыткой примерно через минуту (реальное время, а не тестовое).\nСнова нажмите «Запустить сейчас»: до этого времени ничего не пробуется.\nПосле него нажмите «Запустить сейчас»: повтор проходит успешно.",
  },
  "scenario.tempfail.statuses": {
    en: "QUEUED, then SENDING, then COMPLETED after the retry.",
    ru: "«В очереди», затем «Отправляется», затем «Завершена» после повтора.",
  },
  "scenario.tempfail.jobs": {
    en: "{tempRecipients} rows: after {tempFailures} refusal(s) each waits, and its next attempt is SENT (2 attempts in all).",
    ru: "Записей очереди: {tempRecipients}; после отказов ({tempFailures}) каждая ждёт, а следующая попытка — «Отправлено» (всего 2 попытки).",
  },
  "scenario.tempfail.reset": { en: "Reset campaign in Test campaigns.", ru: "«Сбросить кампанию» в «Тестовых кампаниях»." },

  "scenario.permfail.title": { en: "Check a permanent SMTP failure", ru: "Проверить постоянную ошибку SMTP" },
  "scenario.permfail.setup": {
    en: "Nothing special: the test clock can stay on real time.",
    ru: "Ничего особенного: тестовое время может оставаться реальным.",
  },
  "scenario.permfail.steps": {
    en: "Press the template “Permanent SMTP failure” ({permRecipients} recipients), then Create.\nPress Run now: every email is refused with a permanent 550.\nOpen Queue rows: each is FAILED after one attempt, with no next attempt.\nPress Run now again: nothing is retried.",
    ru: "Нажмите шаблон «Постоянная ошибка SMTP» (получателей: {permRecipients}), затем «Создать».\nНажмите «Запустить сейчас»: каждое письмо отклоняется окончательной ошибкой 550.\nОткройте «Записи очереди»: каждое «Ошибка» после одной попытки, без следующей.\nСнова нажмите «Запустить сейчас»: повторов нет.",
  },
  "scenario.permfail.statuses": {
    en: "QUEUED, then SENDING, then COMPLETED, with every recipient FAILED.",
    ru: "«В очереди», затем «Отправляется», затем «Завершена», при этом все получатели «Ошибка».",
  },
  "scenario.permfail.jobs": {
    en: "{permRecipients} rows, all FAILED, 1 attempt each.",
    ru: "Записей очереди: {permRecipients}, все «Ошибка», по 1 попытке.",
  },
  "scenario.permfail.reset": { en: "Reset campaign in Test campaigns.", ru: "«Сбросить кампанию» в «Тестовых кампаниях»." },
} satisfies Messages;
