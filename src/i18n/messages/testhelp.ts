import type { Messages } from "../define";

/**
 * The help of the developer test panel, in both languages. One block per element of the panel
 * (see `src/lib/testing/help.ts` for the registry that lists them, and how each is built).
 *
 * Numbers are never written here. Where a text needs one it has a placeholder — `{min}`, `{max}`,
 * `{recMin}`, `{longMax}`, `{yearMin}`, ... — filled from `TEST_LIMITS`, the same object the form
 * and the server check input against, so the help cannot say one thing and the code enforce another.
 *
 * A tooltip has a `title` and a `tip`. A popover has a `title`, `what` and `impact`, and, where the
 * registry says so, `recommended` (its own words) and `warning`.
 */
export const testhelp = {
  /* -------------------------------------------------------------- shared */
  "help.ariaLabel": { en: "More: {topic}", ru: "Подробнее: {topic}" },
  "help.close": { en: "Close help", ru: "Закрыть справку" },
  "help.section.what": { en: "What it is", ru: "Что это" },
  "help.section.impact": { en: "What it affects", ru: "На что влияет" },
  "help.section.unit": { en: "Unit", ru: "Единицы измерения" },
  "help.section.range": { en: "Allowed values", ru: "Допустимые значения" },
  "help.section.recommended": { en: "Recommended", ru: "Рекомендуется" },
  "help.section.applies": { en: "When it applies", ru: "Когда применяется" },
  "help.section.lifetime": { en: "How long it lasts", ru: "Срок действия" },
  "help.section.warning": { en: "Important", ru: "Важно" },

  "help.range": { en: "{min}–{max} {unit}", ru: "{min}–{max} {unit}" },
  "help.recommended.range": { en: "{recMin}–{recMax} {unit}", ru: "{recMin}–{recMax} {unit}" },
  "help.recommended.two": {
    en: "Quick check: {recMin}–{recMax} {unit}. Leaving it running for a long time: {longMin}–{longMax} {unit}.",
    ru: "Быстрая проверка: {recMin}–{recMax} {unit}. Долгий локальный запуск: {longMin}–{longMax} {unit}.",
  },

  "help.unit.seconds": { en: "seconds", ru: "секунд" },
  "help.unit.minutes": { en: "minutes", ru: "минут" },
  "help.unit.emails": { en: "emails", ru: "писем" },
  "help.unit.recipients": { en: "recipients", ru: "получателей" },
  "help.unit.count": { en: "times", ru: "раз" },
  "help.unit.characters": { en: "characters", ru: "символов" },
  "help.unit.years": { en: "years", ru: "лет" },
  "help.unit.date": { en: "a calendar date", ru: "календарная дата" },
  "help.unit.time": { en: "time of day, 24-hour", ru: "время суток, 24-часовой формат" },
  "help.unit.zone": { en: "an IANA zone name, e.g. Europe/Warsaw", ru: "название зоны IANA, например Europe/Warsaw" },

  "help.applies.immediately": { en: "Right away.", ru: "Сразу." },
  "help.applies.onPress": { en: "The moment you press the button.", ru: "В момент нажатия кнопки." },
  "help.applies.onSet": { en: "When you press Set.", ru: "После нажатия «Задать»." },
  "help.applies.onApply": { en: "When you press Apply.", ru: "После нажатия «Применить»." },
  "help.applies.onCreate": { en: "When you press Create.", ru: "После нажатия «Создать»." },
  "help.applies.nextCycle": { en: "From the next scheduler cycle.", ru: "Со следующего цикла планировщика." },
  "help.applies.display": { en: "It is only shown; nothing to apply.", ru: "Только показывается, применять нечего." },

  "help.lifetime.untilReset": {
    en: "Until you press Reset, or the server restarts.",
    ru: "До сброса или перезапуска сервера.",
  },
  "help.lifetime.untilRestart": { en: "Until the server restarts.", ru: "До перезапуска сервера." },
  "help.lifetime.untilStop": {
    en: "Until you press Stop, or the server restarts.",
    ru: "До нажатия «Стоп» или перезапуска сервера.",
  },
  "help.lifetime.campaign": {
    en: "The test campaign stays until you reset it.",
    ru: "Тестовая кампания остаётся, пока вы её не сбросите.",
  },
  "help.lifetime.view": { en: "Only while you look at it; nothing is stored.", ru: "Только пока вы на это смотрите; ничего не сохраняется." },
  "help.lifetime.browser": { en: "Remembered in this browser only.", ru: "Запоминается только в этом браузере." },
  "help.lifetime.none": { en: "A one-off action; nothing stays behind.", ru: "Разовое действие, ничего не остаётся." },

  /* --------------------------------------------------------------- panel */
  "help.testMode.title": { en: "Test mode", ru: "Тестовый режим" },
  "help.testMode.what": {
    en: "Shows that the developer test tools are on, and lists what has been changed from normal: the test clock and the rate limit.",
    ru: "Показывает, что инструменты разработчика включены, и что изменено по сравнению с обычной работой: тестовое время и лимит отправки.",
  },
  "help.testMode.impact": {
    en: "Nothing by itself: it only reports. While the test clock is held, scheduled times are judged by it instead of the computer's clock.",
    ru: "Сам ничего не меняет, только сообщает. Пока тестовые часы зафиксированы, время запуска проверяется по ним, а не по часам компьютера.",
  },
  "help.testMode.warning": {
    en: "These tools exist only in development and test. In production none of this is available.",
    ru: "Эти инструменты есть только в режимах разработки и тестирования. В production ничего из этого нет.",
  },
  "help.tourButton.title": { en: "How to test scheduling", ru: "Как протестировать планирование" },
  "help.tourButton.tip": {
    en: "A step-by-step walk through testing a scheduled campaign. It changes nothing by itself: you press every button yourself.",
    ru: "Пошаговая обучалка по проверке запланированной рассылки. Сама ничего не меняет: все кнопки вы нажимаете сами.",
  },

  /* ---------------------------------------------------------- test clock */
  "help.clockRealNow.title": { en: "Real time", ru: "Реальное время" },
  "help.clockRealNow.tip": {
    en: "The computer's own clock, right now. The test clock never changes it.",
    ru: "Часы самого компьютера прямо сейчас. Тестовые часы их не меняют.",
  },
  "help.clockEffectiveNow.title": { en: "Application time", ru: "Время приложения" },
  "help.clockEffectiveNow.tip": {
    en: "The time the schedule checks and the scheduler use right now: the test time while it is held, otherwise the real time.",
    ru: "Время, по которому сейчас работают проверка запланированных дат и планировщик: тестовое, пока оно зафиксировано, иначе реальное.",
  },
  "help.clockUserZone.title": { en: "Your time zone", ru: "Ваш часовой пояс" },
  "help.clockUserZone.tip": {
    en: "The time zone of this browser. Times in this panel are shown in it.",
    ru: "Часовой пояс этого браузера. Время в этой панели показывается в нём.",
  },
  "help.clockMode.title": { en: "Clock mode", ru: "Режим часов" },
  "help.clockMode.tip": {
    en: "Real time: the app uses the computer's clock. Fixed test time: the app's clock is held at the moment you set.",
    ru: "Реальное время: приложение использует часы компьютера. Фиксированное тестовое время: часы приложения удержаны на заданном моменте.",
  },
  "help.clockModeReal.title": { en: "Real time", ru: "Реальное время" },
  "help.clockModeReal.what": {
    en: "The app follows the computer's clock, as it always does outside testing.",
    ru: "Приложение идёт по часам компьютера, как и всегда вне тестирования.",
  },
  "help.clockModeReal.impact": {
    en: "Scheduled times are judged by the real time, and the scheduler starts a campaign when its time has really come. Choosing this while a test time is held ends the test time.",
    ru: "Запланированные даты проверяются по реальному времени, а планировщик запускает рассылку, когда её время действительно наступило. Если выбрать это при зафиксированном тестовом времени, оно будет сброшено.",
  },
  "help.clockModeFixed.title": { en: "Fixed test time", ru: "Фиксированное тестовое время" },
  "help.clockModeFixed.what": {
    en: "The app's clock is held at a moment you choose. It does not tick: it moves only when you press Advance.",
    ru: "Часы приложения удержаны на выбранном вами моменте. Они не идут сами: сдвигаются только по кнопке «Продвинуть».",
  },
  "help.clockModeFixed.impact": {
    en: "It changes what counts as “now” for the checks that decide about scheduled times, and for the scheduler when it looks for campaigns that are due. It does not change mail delivery, retry waits or the rate-limit window.",
    ru: "Меняет, что считается «сейчас» при проверке запланированных дат и когда планировщик ищет готовые кампании. Не влияет на доставку писем, паузы между повторами и окно rate limit.",
  },
  "help.clockModeFixed.warning": {
    en: "It never changes the computer's clock, and it works only in development and test.",
    ru: "Системное время компьютера не меняется, и это работает только в режимах разработки и тестирования.",
  },
  "help.clockDate.title": { en: "Test date", ru: "Тестовая дата" },
  "help.clockDate.what": {
    en: "The calendar date the test clock is held at.",
    ru: "Календарная дата, на которой удержаны тестовые часы.",
  },
  "help.clockDate.impact": {
    en: "The date part of the app's time. Years from {yearMin} to {yearMax} are accepted.",
    ru: "Дата, которую примет время приложения. Допустимы годы с {yearMin} по {yearMax}.",
  },
  "help.clockTime.title": { en: "Test time of day", ru: "Тестовое время суток" },
  "help.clockTime.what": {
    en: "The time of day the test clock is held at, in the zone chosen next to it.",
    ru: "Время суток, на котором удержаны тестовые часы, в выбранном рядом часовом поясе.",
  },
  "help.clockTime.impact": {
    en: "The time part of the app's time. To test a campaign due at 10:30, set a time just before it, such as 10:25, and advance.",
    ru: "Время суток, которое примет время приложения. Чтобы проверить рассылку на 10:30, задайте время чуть раньше, например 10:25, и продвиньте.",
  },
  "help.clockTimeZone.title": { en: "Time zone of the test time", ru: "Часовой пояс тестового времени" },
  "help.clockTimeZone.what": {
    en: "The time zone in which the date and time above are read.",
    ru: "Часовой пояс, в котором читаются дата и время выше.",
  },
  "help.clockTimeZone.impact": {
    en: "Decides which moment “date and time” means. Times elsewhere in this panel are still shown in your own zone.",
    ru: "Определяет, какой именно момент означают «дата и время». Время в других местах панели по-прежнему показывается в вашем поясе.",
  },
  "help.clockTimeZone.warning": {
    en: "On the day the clocks change, a skipped time is refused, and a repeated time means the earlier of the two.",
    ru: "В день перевода часов пропущенное время отклоняется, а повторяющееся означает более раннее из двух.",
  },
  "help.clockStep.title": { en: "Advance step", ru: "Шаг продвижения" },
  "help.clockStep.what": {
    en: "How far Advance moves the test clock: the step chosen from the list.",
    ru: "На сколько «Продвинуть» сдвигает тестовые часы: на шаг, выбранный из списка.",
  },
  "help.clockStep.impact": {
    en: "Only the size of the next jump. Example: test time 10:25, step 5 minutes: after Advance it is 10:30.",
    ru: "Только размер следующего сдвига. Пример: тестовое время 10:25, шаг 5 минут: после «Продвинуть» будет 10:30.",
  },
  "help.clockSet.title": { en: "Set", ru: "Задать" },
  "help.clockSet.what": {
    en: "Holds the app's clock at the date, time and zone entered above.",
    ru: "Удерживает часы приложения на введённых выше дате, времени и поясе.",
  },
  "help.clockSet.impact": {
    en: "From now on the schedule checks and the scheduler read that time. A campaign scheduled for a moment after it will not start until you advance to it.",
    ru: "С этого момента проверка дат и планировщик читают это время. Рассылка, запланированная на более поздний момент, не запустится, пока вы не продвинете часы до него.",
  },
  "help.clockSet.warning": {
    en: "A moment that is already past for the schedule checks is refused when you schedule; setting the clock back does not start anything by itself.",
    ru: "Момент, который для проверки уже прошёл, при планировании отклоняется; перевод часов назад сам ничего не запускает.",
  },
  "help.clockAdvance.title": { en: "Advance", ru: "Продвинуть" },
  "help.clockAdvance.what": {
    en: "Moves the held test clock forward by the chosen step.",
    ru: "Сдвигает зафиксированные тестовые часы вперёд на выбранный шаг.",
  },
  "help.clockAdvance.impact": {
    en: "Example: current test time 10:25, step 5 minutes, after pressing: 10:30. If a campaign is scheduled for 10:30, the next scheduler cycle can put it in the queue.",
    ru: "Пример: текущее тестовое время 10:25, шаг 5 минут, после нажатия: 10:30. Если кампания запланирована на 10:30, следующий цикл планировщика сможет поставить её в очередь.",
  },
  "help.clockAdvance.warning": {
    en: "Works only while the clock is held (Fixed test time). It does not run a cycle: press Run now, or wait for the next one.",
    ru: "Работает только при зафиксированном времени. Цикл сам не запускается: нажмите «Запустить сейчас» или дождитесь следующего.",
  },
  "help.clockReset.title": { en: "Reset to real time", ru: "Сбросить на реальное время" },
  "help.clockReset.what": {
    en: "Releases the test clock: the app follows the computer's clock again.",
    ru: "Отпускает тестовые часы: приложение снова идёт по часам компьютера.",
  },
  "help.clockReset.impact": {
    en: "Schedule checks and the scheduler go back to the real time at once. Campaigns keep their stored times; whichever are due by the real clock start on the next cycle.",
    ru: "Проверка дат и планировщик сразу возвращаются к реальному времени. Сохранённые даты рассылок не меняются; те, чьё время по реальным часам наступило, стартуют в следующем цикле.",
  },

  /* ----------------------------------------------------------- scheduler */
  "help.schedRunning.title": { en: "Scheduler state", ru: "Состояние планировщика" },
  "help.schedRunning.tip": {
    en: "Running: cycles run on their own. Stopped: no automatic cycles, whoever asks; Run now still works.",
    ru: "Работает: циклы идут сами. Остановлен: автоматических циклов нет, кто бы ни просил; «Запустить сейчас» работает.",
  },
  "help.schedInterval.title": { en: "Scheduler interval", ru: "Интервал планировщика" },
  "help.schedInterval.what": {
    en: "How often the scheduler looks in the database for campaigns whose scheduled time has come.",
    ru: "Как часто планировщик проверяет базу данных и ищет кампании, у которых наступило время запуска.",
  },
  "help.schedInterval.impact": {
    en: "How soon a campaign starts after its time. A shorter interval speeds up testing but means more database queries. It does not speed up sending through SMTP: the rate limit decides that.",
    ru: "Как быстро кампания стартует после своего времени. Меньшее значение ускоряет тестирование, но увеличивает число запросов к базе данных. Отправку через SMTP оно не ускоряет: это решает rate limit.",
  },
  "help.schedInterval.warning": {
    en: "The wait already under way is re-timed at once, counted from the end of the last cycle.",
    ru: "Уже идущее ожидание пересчитывается сразу, от конца последнего цикла.",
  },
  "help.schedLastCycle.title": { en: "Last cycle", ru: "Последний цикл" },
  "help.schedLastCycle.tip": {
    en: "When the last scheduler cycle ran and how long it took. Empty until one has run.",
    ru: "Когда прошёл последний цикл планировщика и сколько он длился. Пусто, пока цикл не выполнялся.",
  },
  "help.schedNextCycle.title": { en: "Next cycle", ru: "Следующий цикл" },
  "help.schedNextCycle.tip": {
    en: "When the next automatic cycle is due. Empty while the scheduler is stopped.",
    ru: "Когда должен пройти следующий автоматический цикл. Пусто, пока планировщик остановлен.",
  },
  "help.schedDue.title": { en: "Due campaigns found", ru: "Найдено готовых кампаний" },
  "help.schedDue.tip": {
    en: "How many scheduled campaigns had reached their time in the last cycle, by the application's clock.",
    ru: "Сколько запланированных кампаний в последнем цикле достигли своего времени по часам приложения.",
  },
  "help.schedLastResult.title": { en: "Last cycle result", ru: "Результат последнего цикла" },
  "help.schedLastResult.what": {
    en: "What the last cycle did: due campaigns found, started, and the emails the queue claimed, sent, failed and put back for a retry.",
    ru: "Что сделал последний цикл: сколько нашёл готовых кампаний, сколько запустил, и сколько писем очередь взяла, отправила, не смогла отправить и вернула на повтор.",
  },
  "help.schedLastResult.impact": {
    en: "Started means moved from SCHEDULED to QUEUED. Sent and failed come from the queue's own work in that cycle, under the rate limit.",
    ru: "«Запущено» — переведено из «Запланирована» в «В очереди». Отправленные и неудачные письма — результат работы самой очереди в этом цикле с учётом rate limit.",
  },
  "help.schedLastError.title": { en: "Last error", ru: "Последняя ошибка" },
  "help.schedLastError.tip": {
    en: "The last problem a cycle reported, with connection details and passwords removed. Empty when the last cycle went well.",
    ru: "Последняя проблема, о которой сообщил цикл, без данных подключения и паролей. Пусто, если последний цикл прошёл нормально.",
  },
  "help.schedStart.title": { en: "Start", ru: "Старт" },
  "help.schedStart.what": {
    en: "Starts the automatic cycles: one right away, then one every interval.",
    ru: "Запускает автоматические циклы: один сразу, затем по одному в каждый интервал.",
  },
  "help.schedStart.impact": {
    en: "The scheduler looks in the database again, so it finds whatever became due while it was stopped. Nothing is changed by pressing it except that cycles resume.",
    ru: "Планировщик снова смотрит в базу данных и находит всё, что стало готово, пока он был остановлен. Кроме возобновления циклов, ничего не меняется.",
  },
  "help.schedStop.title": { en: "Stop", ru: "Стоп" },
  "help.schedStop.what": {
    en: "Stops the automatic cycles of the local test scheduler.",
    ru: "Останавливает автоматические циклы локального тестового планировщика.",
  },
  "help.schedStop.impact": {
    en: "No campaign changes status and the queue is left as it is; a cycle that is already running finishes. Campaigns that come due while stopped wait.",
    ru: "Статусы кампаний не меняются, очередь остаётся как есть; уже идущий цикл дорабатывает. Кампании, чьё время наступит во время остановки, ждут.",
  },
  "help.schedStop.warning": {
    en: "While stopped, the worker endpoint (used by “npm run worker” or cron) is refused too, so nothing runs behind your back. Run now still works.",
    ru: "Пока планировщик остановлен, worker-эндпоинт («npm run worker» или cron) тоже отклоняется, так что за вашей спиной ничего не выполняется. «Запустить сейчас» работает.",
  },
  "help.schedRunNow.title": { en: "Run now", ru: "Запустить сейчас" },
  "help.schedRunNow.what": {
    en: "Runs exactly one scheduler cycle right now: starts the campaigns that are due, repairs stuck ones, and lets the queue send what the rate limit allows.",
    ru: "Запускает ровно один цикл планировщика прямо сейчас: запускает готовые кампании, чинит зависшие и даёт очереди отправить столько, сколько разрешает rate limit.",
  },
  "help.schedRunNow.impact": {
    en: "It is the same cycle the automatic ones run, by the same service. It sends nothing on its own and bypasses neither the queue nor the rate limit, and it cannot start a campaign twice.",
    ru: "Это тот же цикл, что и автоматические, через тот же сервис. Сам ничего не отправляет, не обходит ни очередь, ни rate limit и не может запустить кампанию дважды.",
  },
  "help.schedRunNow.warning": {
    en: "If a cycle is already running, the press does nothing and says so.",
    ru: "Если цикл уже идёт, нажатие ничего не делает и сообщает об этом.",
  },

  /* ---------------------------------------------- queue and rate limiter */
  "help.queueState.title": { en: "Queue state", ru: "Состояние очереди" },
  "help.queueState.tip": {
    en: "Idle: nothing waiting. Waiting: emails are queued. Sending: emails are being sent now. Limited: emails wait because the rate-limit window is full.",
    ru: "Простой: ничего не ждёт. Ожидание: письма в очереди. Отправка: письма отправляются сейчас. Ограничено: письма ждут, потому что окно rate limit заполнено.",
  },
  "help.queueWaiting.title": { en: "Waiting jobs", ru: "Ожидающие задания" },
  "help.queueWaiting.tip": {
    en: "Emails in the queue that have not started yet (QUEUED).",
    ru: "Письма в очереди, которые ещё не начали отправляться (QUEUED).",
  },
  "help.queueActive.title": { en: "Active jobs", ru: "Активные задания" },
  "help.queueActive.tip": {
    en: "Emails a worker has taken and is sending right now (SENDING).",
    ru: "Письма, которые воркер взял и отправляет прямо сейчас (SENDING).",
  },
  "help.queueDone.title": { en: "Completed jobs", ru: "Выполненные задания" },
  "help.queueDone.tip": {
    en: "Emails handed to the test SMTP server (SENT).",
    ru: "Письма, принятые тестовым SMTP-сервером (SENT).",
  },
  "help.queueFailed.title": { en: "Failed jobs", ru: "Ошибочные задания" },
  "help.queueFailed.tip": {
    en: "Emails given up on (FAILED): refused for good, or the attempts ran out.",
    ru: "Письма, от которых отказались (FAILED): окончательный отказ или закончились попытки.",
  },
  "help.rateCurrent.title": { en: "Current limit", ru: "Текущий лимит" },
  "help.rateCurrent.tip": {
    en: "The most emails the queue may start in one window: your test setting, or the configured hourly ceiling when none is applied.",
    ru: "Сколько писем очередь может начать за одно окно: ваш тестовый лимит или настроенный часовой потолок, если тестовый не применён.",
  },
  "help.rateWindow.title": { en: "Window length", ru: "Длина окна" },
  "help.rateWindow.tip": {
    en: "How long the limit is counted over: an hour unless you set your own.",
    ru: "За какой период считается лимит: час, пока вы не задали свой.",
  },
  "help.rateSent.title": { en: "Sent in this window", ru: "Отправлено в этом окне" },
  "help.rateSent.tip": {
    en: "Emails the limiter has counted in the current window. When it reaches the limit, the queue waits.",
    ru: "Писем, которые лимитер насчитал в текущем окне. Когда число достигает лимита, очередь ждёт.",
  },
  "help.rateFormula.title": { en: "Rate formula", ru: "Формула скорости" },
  "help.rateFormula.what": {
    en: "Rate = Max emails / Interval. Example: Max emails 2, Interval 10 seconds. The queue may start at most 2 emails in any 10 seconds.",
    ru: "Скорость = Макс. писем / Интервал. Пример: 2 письма, интервал 10 секунд. Очередь может начать отправку не более 2 писем за 10 секунд.",
  },
  "help.rateFormula.impact": {
    en: "It is the same limiter as in normal work, only counted over your window instead of an hour. It is calculated from what has actually been sent, so it holds however many cycles run.",
    ru: "Это тот же лимитер, что и в обычной работе, только со счётом за ваше окно вместо часа. Он считается по реально отправленным письмам, поэтому держится при любом числе циклов.",
  },
  "help.rateFormula.warning": {
    en: "scheduledAt sets when processing starts, not when everything is delivered: a big campaign still goes out at this rate, so delivery finishes later.",
    ru: "scheduledAt задаёт начало обработки, а не момент доставки всех писем: большая кампания всё равно уходит с этой скоростью, поэтому доставка заканчивается позже.",
  },
  "help.rateMaxEmails.title": { en: "Max emails", ru: "Макс. писем" },
  "help.rateMaxEmails.what": {
    en: "The most emails the queue may start within one interval.",
    ru: "Наибольшее число писем, которое очередь может начать за один интервал.",
  },
  "help.rateMaxEmails.impact": {
    en: "Together with Interval it sets the speed. Higher is faster and shows less of the limiting; lower shows the queue waiting between batches.",
    ru: "Вместе с интервалом задаёт скорость. Больше — быстрее и меньше видно ограничение; меньше — видно, как очередь ждёт между пачками.",
  },
  "help.rateMaxEmails.warning": {
    en: "For the test SMTP only. It never shows or changes SMTP or production settings.",
    ru: "Только для тестового SMTP. Настройки SMTP и production не показываются и не меняются.",
  },
  "help.rateInterval.title": { en: "Interval", ru: "Интервал" },
  "help.rateInterval.what": {
    en: "The length of the window the limit is counted over.",
    ru: "Длина окна, за которое считается лимит.",
  },
  "help.rateInterval.impact": {
    en: "A short window lets the limit reset quickly and is easy to watch; a long one holds the queue back longer. The normal window is an hour.",
    ru: "Короткое окно быстро освобождает лимит и удобно для наблюдения; длинное дольше удерживает очередь. Обычное окно — час.",
  },
  "help.rateApply.title": { en: "Apply", ru: "Применить" },
  "help.rateApply.what": {
    en: "Puts Max emails and Interval to work as the queue's limit.",
    ru: "Вводит «Макс. писем» и «Интервал» в действие как лимит очереди.",
  },
  "help.rateApply.impact": {
    en: "The existing rate limiter reads the new numbers on its next cycle; emails already sent are counted as before. No second sending path is created.",
    ru: "Существующий rate limiter читает новые числа в следующем цикле; уже отправленные письма учитываются как раньше. Отдельного пути отправки не создаётся.",
  },
  "help.rateApply.warning": {
    en: "Values outside the allowed range are refused, in the browser and again by the server.",
    ru: "Значения вне допустимого диапазона отклоняются и в браузере, и повторно на сервере.",
  },
  "help.rateReset.title": { en: "Reset to defaults", ru: "Сбросить на стандартные" },
  "help.rateReset.what": {
    en: "Removes the test limit: the queue goes back to the app's configured hourly ceiling.",
    ru: "Убирает тестовый лимит: очередь возвращается к настроенному часовому потолку приложения.",
  },
  "help.rateReset.impact": {
    en: "Taken up on the next cycle. Nothing already sent or queued is changed.",
    ru: "Подхватывается в следующем цикле. Уже отправленное и стоящее в очереди не меняется.",
  },
  "help.ratePresetQuick.title": { en: "Emails: {maxEmails} / {windowSeconds} s", ru: "Писем: {maxEmails} / {windowSeconds} с" },
  "help.ratePresetQuick.tip": {
    en: "Quick functional check: fast enough not to get in the way. Fills the fields; press Apply to use it.",
    ru: "Быстрая функциональная проверка: достаточно быстро, чтобы не мешать. Заполняет поля; чтобы применить, нажмите «Применить».",
  },
  "help.ratePresetVisible.title": { en: "Emails: {maxEmails} / {windowSeconds} s", ru: "Писем: {maxEmails} / {windowSeconds} с" },
  "help.ratePresetVisible.tip": {
    en: "Watching the limit at work: the queue visibly waits between pairs. Fills the fields; press Apply to use it.",
    ru: "Наглядная проверка rate limiting: очередь заметно ждёт между парами. Заполняет поля; чтобы применить, нажмите «Применить».",
  },
  "help.ratePresetLarge.title": { en: "Emails: {maxEmails} / {windowSeconds} s", ru: "Писем: {maxEmails} / {windowSeconds} с" },
  "help.ratePresetLarge.tip": {
    en: "A large queue: a steady stream. Fills the fields; press Apply to use it.",
    ru: "Большая очередь: ровный поток. Заполняет поля; чтобы применить, нажмите «Применить».",
  },
  "help.smtpServer.title": { en: "Built-in test SMTP server", ru: "Встроенный тестовый SMTP-сервер" },
  "help.smtpServer.what": {
    en: "A mail server inside this app that accepts only made-up @test.invalid addresses and saves each message as an .eml file in the folder shown.",
    ru: "Почтовый сервер внутри приложения: принимает только выдуманные адреса @test.invalid и сохраняет каждое письмо файлом .eml в показанную папку.",
  },
  "help.smtpServer.impact": {
    en: "While the panel is on, every email the app sends goes here, including the test email on the Settings page, so nothing real can be delivered.",
    ru: "Пока панель включена, все письма приложения (включая тестовое письмо на странице настроек) уходят сюда, поэтому реальная доставка невозможна.",
  },
  "help.smtpServer.warning": {
    en: "The configured SMTP is neither shown nor changed. The saved files are yours to delete; Git ignores the folder.",
    ru: "Настроенный SMTP не показывается и не меняется. Сохранённые файлы можно удалять; Git эту папку игнорирует.",
  },

  /* ---------------------------------------------- create a test campaign */
  "help.newName.title": { en: "Campaign name", ru: "Название кампании" },
  "help.newName.what": {
    en: "What the test campaign is called in the campaign list.",
    ru: "Как тестовая кампания называется в списке рассылок.",
  },
  "help.newName.impact": {
    en: "Only the label. “[TEST] ” is put in front automatically, which is what marks it as a test campaign. Up to {nameMax} characters.",
    ru: "Только подпись. Перед названием автоматически ставится «[TEST] », это и есть пометка тестовой кампании. До {nameMax} символов.",
  },
  "help.newName.recommended": {
    en: "Leave it empty: a name is made from the way and scenario.",
    ru: "Оставьте пустым: название составится из способа отправки и сценария.",
  },
  "help.newRecipients.title": { en: "Number of recipients", ru: "Количество получателей" },
  "help.newRecipients.what": {
    en: "How many made-up test recipients the campaign has. Their addresses are generated; you never type an address.",
    ru: "Сколько выдуманных тестовых получателей у кампании. Адреса генерируются; вводить адрес не нужно и нельзя.",
  },
  "help.newRecipients.impact": {
    en: "The size of the queue: the more recipients, the longer the rate limit takes to work through them.",
    ru: "Размер очереди: чем больше получателей, тем дольше rate limit её отрабатывает.",
  },
  "help.newRecipients.recommended": {
    en: "Quick check: {recMin}–{recMax}. Watching rate limiting: {rateMin}–{rateMax}. A longer local run: {longMin}–{longMax}.",
    ru: "Быстрая проверка: {recMin}–{recMax}. Проверка rate limiting: {rateMin}–{rateMax}. Продолжительная локальная проверка: {longMin}–{longMax}.",
  },
  "help.newRecipients.warning": {
    en: "This is a manual check, not a full load test: everything runs in one local process.",
    ru: "Это ручная проверка, а не полноценное нагрузочное тестирование: всё выполняется в одном локальном процессе.",
  },
  "help.newMode.title": { en: "How to send", ru: "Способ отправки" },
  "help.newMode.what": {
    en: "Send now: queue it at once, like the Send button. Schedule: start it at the date and time below. Overdue: create it already late, for testing a missed start.",
    ru: "Сейчас: сразу поставить в очередь, как кнопка отправки. По расписанию: запустить в указанные ниже дату и время. Просрочена: создать уже опоздавшей, для проверки пропущенного запуска.",
  },
  "help.newMode.impact": {
    en: "Send now and Schedule take the ordinary road: the same rules, the same queue. Only Overdue is written directly, because the normal API refuses a time that has already passed.",
    ru: "«Сейчас» и «По расписанию» идут обычным путём: те же правила, та же очередь. Напрямую создаётся только «Просрочена», потому что обычный API запрещает прошедшее время.",
  },
  "help.newMode.warning": {
    en: "An overdue campaign is picked up by the very next scheduler cycle.",
    ru: "Просроченную кампанию подхватит ближайший же цикл планировщика.",
  },
  "help.newDate.title": { en: "Start date", ru: "Дата запуска" },
  "help.newDate.what": {
    en: "The date the scheduled campaign should start, in the zone chosen next to it.",
    ru: "Дата, когда должна стартовать запланированная кампания, в выбранном рядом часовом поясе.",
  },
  "help.newDate.impact": {
    en: "Becomes part of scheduledAt, stored as one UTC moment. It must be after the application's time: the test time while it is held.",
    ru: "Становится частью scheduledAt, который хранится как один момент в UTC. Должна быть позже времени приложения: тестового, пока оно зафиксировано.",
  },
  "help.newTime.title": { en: "Start time", ru: "Время запуска" },
  "help.newTime.what": {
    en: "The time of day the scheduled campaign should start, in the zone chosen next to it.",
    ru: "Время суток, когда должна стартовать запланированная кампания, в выбранном рядом часовом поясе.",
  },
  "help.newTime.impact": {
    en: "Becomes part of scheduledAt. A time equal to the application's time is already too late.",
    ru: "Становится частью scheduledAt. Время, равное времени приложения, уже считается прошедшим.",
  },
  "help.newTimeZone.title": { en: "Time zone of the start", ru: "Часовой пояс запуска" },
  "help.newTimeZone.what": {
    en: "The time zone in which the start date and time are read.",
    ru: "Часовой пояс, в котором читаются дата и время запуска.",
  },
  "help.newTimeZone.impact": {
    en: "Decides which moment they mean; the stored scheduledAt is always UTC and is shown back in your zone.",
    ru: "Определяет, какой момент они означают; сохранённый scheduledAt всегда в UTC и показывается обратно в вашем поясе.",
  },
  "help.newScenario.title": { en: "Test SMTP scenario", ru: "Сценарий тестового SMTP" },
  "help.newScenario.what": {
    en: "How the built-in test SMTP server treats this campaign's recipients. Success: accepts every email. Temporary failure: refuses with a temporary error that should trigger retries. Permanent failure: refuses for good, with no endless retrying. Slow response: accepts, but only after a delay.",
    ru: "Как встроенный тестовый SMTP-сервер обращается с получателями кампании. Успех: принимает все письма. Временная ошибка: отвечает временной ошибкой, которая должна включить повторы. Постоянная ошибка: окончательный отказ без бесконечных повторов. Медленный ответ: принимает, но с задержкой.",
  },
  "help.newScenario.impact": {
    en: "It is decided by the recipients' generated addresses, so it survives a restart. Retries wait longer each time and stop after the attempt limit.",
    ru: "Определяется сгенерированными адресами получателей, поэтому переживает перезапуск. Повторы ждут всё дольше и прекращаются по достижении лимита попыток.",
  },
  "help.newScenario.warning": {
    en: "Only the built-in test server is used; the real SMTP is never contacted.",
    ru: "Используется только встроенный тестовый сервер; реальный SMTP не затрагивается.",
  },
  "help.newSlowDelay.title": { en: "Slow response delay", ru: "Задержка медленного ответа" },
  "help.newSlowDelay.what": {
    en: "How long the test SMTP server waits before accepting each email of a slow campaign.",
    ru: "Сколько тестовый SMTP-сервер ждёт перед приёмом каждого письма медленной кампании.",
  },
  "help.newSlowDelay.impact": {
    en: "Lets you see the queue hold emails in “sending”. Kept under the mail client's 30-second timeout, above which a slow answer would look like a broken connection.",
    ru: "Позволяет увидеть, как очередь держит письма в состоянии «отправляется». Ограничена значением меньше 30-секундного тайм-аута почтового клиента: иначе медленный ответ выглядел бы как обрыв соединения.",
  },
  "help.newTempFailures.title": { en: "Temporary failures", ru: "Число временных ошибок" },
  "help.newTempFailures.what": {
    en: "How many times the test SMTP server refuses each recipient with a temporary error before accepting.",
    ru: "Сколько раз тестовый SMTP-сервер отклоняет каждого получателя временной ошибкой, прежде чем принять письмо.",
  },
  "help.newTempFailures.recommended": {
    en: "{recMin}–{recMax} is usually enough.",
    ru: "Обычно достаточно {recMin}–{recMax}.",
  },
  "help.newTempFailures.impact": {
    en: "One failure: the first attempt fails and the first retry succeeds. As many as the attempt limit, or more: every attempt fails and the email is given up on.",
    ru: "Одна ошибка: первая попытка неудачна, первый повтор успешен. Столько, сколько лимит попыток, или больше: неудачны все попытки, и письмо признаётся ошибочным.",
  },
  "help.newOverdueMinutes.title": { en: "Overdue by", ru: "Просрочена на" },
  "help.newOverdueMinutes.what": {
    en: "How long ago, by the application's clock, the overdue campaign should have started.",
    ru: "Как давно по часам приложения кампания должна была стартовать.",
  },
  "help.newOverdueMinutes.impact": {
    en: "Sets its scheduledAt in the past. The next scheduler cycle finds it and starts it, however late.",
    ru: "Задаёт её scheduledAt в прошлом. Следующий цикл планировщика найдёт её и запустит, как бы поздно это ни было.",
  },
  "help.tplIn1min.title": { en: "Starts in {minutes} min", ru: "Запуск через {minutes} мин" },
  "help.tplIn1min.tip": { en: "Fills the form: {recipients} recipients, scheduled {minutes} min after the application's time. Nothing is created until you press Create.", ru: "Заполняет форму: получателей — {recipients}, запуск через {minutes} мин после времени приложения. Пока вы не нажмёте «Создать», ничего не создаётся." },
  "help.tplIn5min.title": { en: "Starts in {minutes} min", ru: "Запуск через {minutes} мин" },
  "help.tplIn5min.tip": { en: "Fills the form: {recipients} recipients, scheduled {minutes} min after the application's time. Pairs well with Advance by that step. Nothing is created until you press Create.", ru: "Заполняет форму: получателей — {recipients}, запуск через {minutes} мин после времени приложения. Хорошо сочетается с «Продвинуть» на такой же шаг. Пока вы не нажмёте «Создать», ничего не создаётся." },
  "help.tplOverdue5min.title": { en: "Overdue by {minutes} min", ru: "Просрочена на {minutes} мин" },
  "help.tplOverdue5min.tip": {
    en: "Fills the form with an already late campaign, for testing a missed start. Nothing is created until you press Create.",
    ru: "Заполняет форму уже опоздавшей кампанией, для проверки пропущенного запуска. Пока вы не нажмёте «Создать», ничего не создаётся.",
  },
  "help.tplBigRate.title": { en: "Large campaign for the rate limit", ru: "Большая кампания для проверки rate limit" },
  "help.tplBigRate.tip": { en: "Fills the form: {recipients} recipients, sent now. Use it with a small limit, so the queue visibly waits.", ru: "Заполняет форму: получателей — {recipients}, отправка сразу. Используйте с малым лимитом, чтобы было видно, как очередь ждёт." },
  "help.tplTempFail.title": { en: "Temporary SMTP failure", ru: "Временная ошибка SMTP" },
  "help.tplTempFail.tip": { en: "Fills the form: sent now, each recipient refused {failures} time(s) with a temporary error, then accepted on a retry.", ru: "Заполняет форму: отправка сразу, каждого получателя отклоняют временной ошибкой (раз: {failures}), затем принимают при повторе." },
  "help.tplPermFail.title": { en: "Permanent SMTP failure", ru: "Постоянная ошибка SMTP" },
  "help.tplPermFail.tip": {
    en: "Fills the form: sent now, every recipient refused for good, so each email fails after one attempt with no retries.",
    ru: "Заполняет форму: отправка сразу, каждого получателя отклоняют окончательно, поэтому каждое письмо становится ошибочным после одной попытки без повторов.",
  },
  "help.tplSlowSmtp.title": { en: "Slow SMTP", ru: "Медленный SMTP" },
  "help.tplSlowSmtp.tip": { en: "Fills the form: sent now, the test server answers each email only after {delay} s.", ru: "Заполняет форму: отправка сразу, тестовый сервер отвечает на каждое письмо лишь через {delay} с." },
  "help.newCreate.title": { en: "Create test campaign", ru: "Создать тестовую кампанию" },
  "help.newCreate.what": {
    en: "Creates the campaign with its made-up recipients and sends or schedules it the way you chose.",
    ru: "Создаёт кампанию с выдуманными получателями и отправляет или планирует её выбранным способом.",
  },
  "help.newCreate.impact": {
    en: "It uses the ordinary services: the list is imported like a real import, and the campaign is sent or scheduled by the same functions as the Send and Schedule buttons. It then goes through the scheduler, the queue, the rate limiter and the retry rules like any other.",
    ru: "Используются обычные сервисы: список импортируется как настоящий, а кампания отправляется или планируется теми же функциями, что и кнопки «Отправить» и «Запланировать». Затем она проходит планировщик, очередь, rate limiter и правила повторов, как любая другая.",
  },
  "help.newCreate.warning": {
    en: "Only test addresses are used and no real email can be typed in. The campaign is marked [TEST] in its name.",
    ru: "Используются только тестовые адреса, ввести настоящий адрес нельзя. Кампания помечена «[TEST]» в названии.",
  },

  /* ------------------------------------------------- the selected campaign */
  "help.campSelect.title": { en: "Selected test campaign", ru: "Выбранная тестовая кампания" },
  "help.campSelect.tip": {
    en: "Which test campaign the actions below work on. Only campaigns created by this panel are listed.",
    ru: "С какой тестовой кампанией работают действия ниже. В списке только кампании, созданные этой панелью.",
  },
  "help.campStatus.title": { en: "Status", ru: "Статус" },
  "help.campStatus.tip": {
    en: "Where the campaign is now: SCHEDULED, QUEUED, SENDING, COMPLETED or CANCELLED.",
    ru: "На каком этапе кампания сейчас: «Запланирована», «В очереди», «Отправляется», «Завершена» или «Отменена».",
  },
  "help.campUtc.title": { en: "scheduledAt in UTC", ru: "scheduledAt в UTC" },
  "help.campUtc.tip": {
    en: "The moment the campaign is due, as it is stored: one instant in UTC.",
    ru: "Момент запуска кампании в том виде, в каком он хранится: один момент в UTC.",
  },
  "help.campLocal.title": { en: "scheduledAt in your time zone", ru: "scheduledAt в вашем часовом поясе" },
  "help.campLocal.tip": {
    en: "The same moment, shown in this browser's time zone. It is only a display: nothing is stored in it.",
    ru: "Тот же момент, показанный в часовом поясе этого браузера. Это только отображение: в нём ничего не хранится.",
  },
  "help.campCounts.title": { en: "Queue counts", ru: "Счётчики очереди" },
  "help.campCounts.tip": {
    en: "Recipients of this campaign by state: waiting, sending, sent, failed. A scheduled campaign has none until it starts.",
    ru: "Получатели этой кампании по состояниям: ждут, отправляются, отправлены, ошибки. У запланированной кампании их нет, пока она не стартовала.",
  },
  "help.campOpen.title": { en: "Open campaign", ru: "Открыть кампанию" },
  "help.campOpen.what": {
    en: "Opens the campaign's own page in the app.",
    ru: "Открывает страницу кампании в приложении.",
  },
  "help.campOpen.impact": {
    en: "Navigation only: nothing is changed, and the panel stays where it is.",
    ru: "Только переход: ничего не меняется, панель остаётся на месте.",
  },
  "help.campRunCycle.title": { en: "Run scheduler cycle", ru: "Выполнить цикл планировщика" },
  "help.campRunCycle.what": {
    en: "Runs one scheduler cycle now, exactly like Run now in the Scheduler section.",
    ru: "Запускает один цикл планировщика, точно так же, как «Запустить сейчас» в разделе «Планировщик».",
  },
  "help.campRunCycle.impact": {
    en: "The cycle handles every due campaign, not only this one. It does not send anything by itself, and it cannot start this campaign twice.",
    ru: "Цикл обрабатывает все готовые кампании, а не только эту. Сам он ничего не отправляет и не может запустить эту кампанию дважды.",
  },
  "help.campReschedule.title": { en: "Change date and time", ru: "Изменить дату и время" },
  "help.campReschedule.what": {
    en: "Opens the ordinary change-time form for this campaign.",
    ru: "Открывает обычную форму изменения времени для этой кампании.",
  },
  "help.campReschedule.impact": {
    en: "Moves scheduledAt while the campaign is still SCHEDULED; the scheduler then starts it at the new time, with nothing else to do. Refused once its time has come.",
    ru: "Переносит scheduledAt, пока кампания ещё «Запланирована»; планировщик затем сам запустит её в новое время. Отклоняется, когда её время уже наступило.",
  },
  "help.campCancel.title": { en: "Cancel", ru: "Отменить" },
  "help.campCancel.what": {
    en: "Moves the campaign from SCHEDULED to CANCELLED. After that the scheduler will not queue it.",
    ru: "Переводит кампанию из «Запланирована» в «Отменена». После этого планировщик не поставит её в очередь.",
  },
  "help.campCancel.impact": {
    en: "Nothing is deleted and nothing is sent. Available only before processing has started; a campaign already in the queue is refused.",
    ru: "Ничего не удаляется и не отправляется. Доступно только до начала обработки; кампания, уже попавшая в очередь, отклоняется.",
  },
  "help.campCancel.warning": {
    en: "This cannot be undone.",
    ru: "Это действие нельзя отменить.",
  },
  "help.campQueue.title": { en: "Show queue rows", ru: "Показать записи очереди" },
  "help.campQueue.what": {
    en: "Lists this campaign's recipients in the queue with their state, attempts, next attempt and last error.",
    ru: "Показывает получателей кампании в очереди: состояние, число попыток, время следующей попытки и последнюю ошибку.",
  },
  "help.campQueue.impact": {
    en: "Read-only. The addresses are the made-up test ones; a scheduled campaign has no rows until it starts.",
    ru: "Только просмотр. Адреса — выдуманные тестовые; у запланированной кампании записей нет, пока она не стартовала.",
  },
  "help.campHistory.title": { en: "Show status history", ru: "Показать историю статусов" },
  "help.campHistory.what": {
    en: "Lists what happened to this campaign, in order: created, scheduled, moved, started, completed.",
    ru: "Показывает по порядку, что происходило с кампанией: создана, запланирована, перенесена, запущена, завершена.",
  },
  "help.campHistory.impact": {
    en: "Built from the campaign's own dates and from the events this server has seen since it started, so it may be shorter after a restart.",
    ru: "Собирается из собственных дат кампании и из событий, которые сервер видел с момента запуска, поэтому после перезапуска может быть короче.",
  },
  "help.campRefresh.title": { en: "Refresh", ru: "Обновить" },
  "help.campRefresh.tip": {
    en: "Reads the campaign's current state again. The panel also refreshes itself every few seconds.",
    ru: "Ещё раз читает текущее состояние кампании. Панель и сама обновляется каждые несколько секунд.",
  },
  "help.campReset.title": { en: "Reset test campaign", ru: "Сбросить тестовую кампанию" },
  "help.campReset.what": {
    en: "Deletes this test campaign, the list made for it and the made-up contacts nothing else uses.",
    ru: "Удаляет эту тестовую кампанию, созданный для неё список и выдуманные контакты, которые больше нигде не используются.",
  },
  "help.campReset.impact": {
    en: "Only for campaigns marked [TEST] whose every address is a test address; you are asked to confirm. Real campaigns, lists and contacts are never touched.",
    ru: "Только для кампаний с пометкой «[TEST]», все адреса которых тестовые; у вас запрашивается подтверждение. Настоящие кампании, списки и контакты никогда не затрагиваются.",
  },
  "help.campReset.warning": {
    en: "A campaign in the queue or sending must be cancelled first.",
    ru: "Кампанию, стоящую в очереди или отправляющуюся, сначала нужно отменить.",
  },

  /* -------------------------------------------------------------- journal */
  "help.journalEntry.title": { en: "Journal entry", ru: "Запись журнала" },
  "help.journalEntry.what": {
    en: "One thing that happened: the time, where it came from (scheduler, queue, rate limiter, API, panel), the campaign and, for a change of status, from which to which.",
    ru: "Одно событие: время, источник (планировщик, очередь, rate limiter, API, панель), кампания и, для смены статуса, из какого в какой.",
  },
  "help.journalEntry.impact": {
    en: "Read from the scheduler's and the queue's own log lines as they happen. While the test clock is held, the application's time is shown beside the real one.",
    ru: "Берётся из записей самих планировщика и очереди по мере их появления. Пока тестовые часы зафиксированы, время приложения показывается рядом с реальным.",
  },
  "help.journalEntry.warning": {
    en: "Only identifiers, statuses and counts: never an address, an email's content or a password.",
    ru: "Только идентификаторы, статусы и числа: никогда адрес, содержимое письма или пароль.",
  },
  "help.journalRefresh.title": { en: "Refresh the journal", ru: "Обновить журнал" },
  "help.journalRefresh.tip": {
    en: "Fetches the newest events now instead of waiting for the automatic refresh.",
    ru: "Сразу подтягивает новые события, не дожидаясь автоматического обновления.",
  },
  "help.journalAuto.title": { en: "Refresh automatically", ru: "Обновлять автоматически" },
  "help.journalAuto.what": {
    en: "When on, the journal fetches new events every few seconds while the panel is open.",
    ru: "Когда включено, журнал каждые несколько секунд подтягивает новые события, пока панель открыта.",
  },
  "help.journalAuto.impact": {
    en: "Only how this view updates. Turning it off does not stop events from being recorded.",
    ru: "Влияет только на обновление этого представления. Выключение не останавливает запись событий.",
  },
  "help.journalClear.title": { en: "Clear the view", ru: "Очистить вид" },
  "help.journalClear.tip": {
    en: "Hides what is shown now. Nothing is deleted: the server keeps its record, and new events still appear.",
    ru: "Скрывает то, что показано сейчас. Ничего не удаляется: сервер хранит свою запись, а новые события продолжают появляться.",
  },
  "help.journalLimit.title": { en: "Entries shown", ru: "Показано записей" },
  "help.journalLimit.tip": {
    en: "The panel shows at most the latest {show} events; the server keeps at most {keep}, oldest dropped first.",
    ru: "Панель показывает не более {show} последних событий; сервер хранит не более {keep}, самые старые отбрасываются первыми.",
  },

  /* --------------------------------------------------------------- guides */
  "help.guideScenario.title": { en: "Test scenario", ru: "Тестовый сценарий" },
  "help.guideScenario.tip": {
    en: "Opens the scenario: the settings to start from, the steps, the statuses and jobs to expect, and how to put everything back.",
    ru: "Открывает сценарий: с каких настроек начать, шаги, ожидаемые статусы и число заданий, а также как вернуть всё обратно.",
  },
} satisfies Messages;
