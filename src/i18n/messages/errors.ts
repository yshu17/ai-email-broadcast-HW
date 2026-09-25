import type { Messages } from "../define";

/**
 * What the API says when it refuses a request. The English text is exactly what the
 * routes always said (scripts and tests read it); the Russian is what the interface
 * shows.
 *
 * `{status}` is filled with the interface's name for a campaign status («В очереди»),
 * and `{field}` with the form's label for a field, so a message never mixes languages.
 */
export const errors = {
  "err.auth.invalidCredentials": { en: "Invalid email or password", ru: "Неверная почта или пароль" },
  "err.auth.required": { en: "Authentication required", ru: "Требуется вход в систему" },
  "err.origin.invalid": { en: "Invalid origin", ru: "Недопустимый источник запроса" },
  "err.origin.crossOrigin": { en: "Cross-origin request rejected", ru: "Междоменный запрос отклонён" },
  "err.json": { en: "Request body must be valid JSON", ru: "Тело запроса должно быть корректным JSON" },
  "err.unexpected": { en: "Unexpected error", ru: "Непредвиденная ошибка" },
  "err.auth.tooManyAttempts": {
    en: "Too many failed sign-in attempts. Try again in a few minutes.",
    ru: "Слишком много неудачных попыток входа. Повторите через несколько минут.",
  },

  "err.field.string": { en: "{field} must be a string", ru: "{field}: должно быть строкой" },
  "err.field.required": { en: "{field} is required", ru: "{field}: обязательное поле" },
  "err.field.tooLong": { en: "{field} must be at most {max} characters", ru: "{field}: не более {max} символов" },
  "err.field.integer": { en: "{field} must be a whole number", ru: "{field}: должно быть целым числом" },
  "err.field.range": { en: "{field} must be between {min} and {max}", ru: "{field}: должно быть от {min} до {max}" },
  "err.field.array": { en: "{field} must be an array", ru: "{field}: должно быть списком" },
  "err.field.badId": { en: "{field} contains an invalid id", ru: "{field}: содержит недопустимый идентификатор" },

  "err.email.invalid": { en: "That is not a valid email address", ru: "Некорректный адрес электронной почты" },
  "err.replyTo.invalid": { en: "Reply-To is not a valid address", ru: "Адрес для ответов (Reply-To) некорректен" },
  "err.senderEmail.invalid": { en: "Sender email is not a valid address", ru: "Адрес отправителя некорректен" },

  "err.campaign.notFound": { en: "Campaign not found", ru: "Рассылка не найдена" },
  "err.campaign.cancelState": {
    en: "Only a queued, sending or paused campaign can be cancelled",
    ru: "Отменить можно только рассылку, которая в очереди, отправляется или на паузе",
  },
  "err.campaign.cancelScheduledState": {
    en: "Only a scheduled campaign can be cancelled here; this one is {status}",
    ru: "Здесь можно отменить только запланированную рассылку; эта в статусе «{status}»",
  },
  "err.campaign.rescheduleState": {
    en: "Only a scheduled campaign can be moved to another time; this one is {status}",
    ru: "Изменить время можно только у запланированной рассылки; эта в статусе «{status}»",
  },
  "err.campaign.rescheduleDue": {
    en: "This campaign is already due to start, so its time can no longer be changed",
    ru: "Время начала этой рассылки уже наступило, поэтому изменить его нельзя",
  },
  "err.campaign.pauseState": {
    en: "Only a queued or sending campaign can be paused",
    ru: "Поставить на паузу можно только рассылку, которая в очереди или отправляется",
  },
  "err.campaign.resumeState": { en: "Only a paused campaign can be resumed", ru: "Возобновить можно только рассылку на паузе" },
  "err.campaign.locked": {
    en: "This campaign is {status} and can no longer be edited",
    ru: "Рассылка в статусе «{status}», её больше нельзя редактировать",
  },
  "err.campaign.alreadyStatus": { en: "This campaign is already {status}", ru: "Рассылка уже в статусе «{status}»" },
  "err.campaign.cancelBeforeDelete": { en: "Cancel the campaign before deleting it", ru: "Сначала отмените рассылку, потом удаляйте" },
  "err.campaign.subjectRequired": { en: "Give the campaign a subject first", ru: "Сначала укажите тему рассылки" },
  "err.campaign.bodyEmpty": { en: "The email body is empty", ru: "Текст письма пуст" },
  "err.campaign.contentTooLarge": { en: "Email content is too large", ru: "Содержимое письма слишком большое" },
  "err.campaign.noRecipients": {
    en: "No recipients: the selected lists are empty or fully suppressed",
    ru: "Нет получателей: выбранные списки пусты или все адреса отписались",
  },
  "err.campaign.alreadyQueued": {
    en: "This campaign was already queued by another request",
    ru: "Эта рассылка уже поставлена в очередь другим запросом",
  },
  "err.campaign.alreadyScheduled": {
    en: "This campaign was already scheduled or queued by another request",
    ru: "Эта рассылка уже запланирована или поставлена в очередь другим запросом",
  },

  "err.smtp.configureBeforeSend": {
    en: "Configure SMTP in Settings before sending",
    ru: "Перед отправкой настройте SMTP на странице «Настройки»",
  },
  "err.smtp.configureFirst": { en: "Configure SMTP in Settings first", ru: "Сначала настройте SMTP на странице «Настройки»" },
  "err.smtp.notConfigured": {
    en: "SMTP is not configured yet. Fill in host, port and sender email first.",
    ru: "SMTP ещё не настроен. Сначала укажите хост, порт и адрес отправителя.",
  },
  "err.settings.encryption": { en: "Invalid encryption mode", ru: "Недопустимый режим шифрования" },
  "err.settings.recipientInvalid": {
    en: "Recipient is not a valid email address",
    ru: "Получатель — некорректный адрес электронной почты",
  },

  "err.contact.notFound": { en: "Contact not found", ru: "Контакт не найден" },
  "err.contact.suppressed": {
    en: "That address is on the suppression list and cannot be added.",
    ru: "Этот адрес в списке отписавшихся, его нельзя добавить.",
  },
  "err.contact.noneSelected": { en: "No contacts selected", ru: "Контакты не выбраны" },
  "err.contact.deleteLimit": { en: "Delete at most 5000 contacts at a time", ru: "За раз можно удалить не более 5000 контактов" },
  "err.contact.duplicate": {
    en: "Another contact already uses that email address",
    ru: "Другой контакт уже использует этот адрес",
  },
  "err.list.notFound": { en: "List not found", ru: "Список не найден" },

  "err.import.nothing": { en: "Nothing to import", ru: "Нечего импортировать" },
  "err.import.tooLarge": { en: "File is too large", ru: "Файл слишком большой" },
  "err.import.tooLargeLimit": { en: "File is too large (limit {mb} MB)", ru: "Файл слишком большой (лимит {mb} МБ)" },
  "err.import.emailColumn": {
    en: "Map one column to Email — it is mandatory",
    ru: "Сопоставьте один из столбцов с полем «Эл. почта» — оно обязательно",
  },
  "err.import.tooManyRows": {
    en: "That file has {rows} rows; the limit is {limit}",
    ru: "В файле строк: {rows}; лимит: {limit}",
  },
  "err.import.pasteEmpty": { en: "Paste at least one email address", ru: "Вставьте хотя бы один адрес электронной почты" },
  "err.import.pasteTooLong": {
    en: "That is too much text to paste at once — upload it as a file instead",
    ru: "Слишком много текста для вставки — загрузите его файлом",
  },
  "err.import.noFile": { en: "No file uploaded", ru: "Файл не загружен" },
  "err.import.fileEmpty": { en: "That file is empty", ru: "Файл пуст" },
  "err.import.fileType": { en: "Only .csv and .txt files are supported", ru: "Поддерживаются только файлы .csv и .txt" },
  "err.import.noRows": { en: "No rows found in that file", ru: "В файле не найдено строк" },

  "err.schedule.SCHEDULE_REQUIRED": {
    en: "scheduledAt is required to schedule a campaign.",
    ru: "Чтобы запланировать рассылку, нужно указать scheduledAt.",
  },
  "err.schedule.SCHEDULE_FORMAT": {
    en: "scheduledAt must be an ISO-8601 date and time with a time zone, e.g. 2026-10-15T07:30:00Z.",
    ru: "scheduledAt должен быть датой и временем ISO-8601 с часовым поясом, например 2026-10-15T07:30:00Z.",
  },
  "err.schedule.SCHEDULE_INVALID": {
    en: "scheduledAt is not a valid date and time.",
    ru: "scheduledAt — некорректные дата и время.",
  },
  "err.schedule.SCHEDULE_PAST": {
    en: "The scheduled time must be in the future.",
    ru: "Время отправки должно быть в будущем.",
  },

  "err.test.range": {
    en: "{field} must be a whole number from {min} to {max}",
    ru: "«{field}»: нужно целое число от {min} до {max}",
  },
  "err.test.required": { en: "{field} is required", ru: "Поле «{field}» обязательно" },
  "err.test.timeZone": { en: "Unknown time zone", ru: "Неизвестный часовой пояс" },
  "err.test.mode": { en: "Unknown send mode", ru: "Неизвестный способ отправки" },
  "err.test.scenario": { en: "Unknown SMTP scenario", ru: "Неизвестный сценарий SMTP" },
  "err.test.step": { en: "Unknown step", ru: "Неизвестный шаг" },
  "err.test.action": { en: "Unknown action", ru: "Неизвестное действие" },
  "err.test.notTestCampaign": {
    en: "Only campaigns created by the test panel can be used here",
    ru: "Здесь можно работать только с кампаниями, созданными тестовой панелью",
  },
  "err.test.clockNotHeld": {
    en: "The test clock is not held at a time. Set a fixed time first.",
    ru: "Тестовое время не зафиксировано. Сначала задайте фиксированное время.",
  },
  "err.test.clockRange": {
    en: "The test time must fall between the years {min} and {max}",
    ru: "Тестовое время должно быть между {min} и {max} годами",
  },

  "smtp.connected": { en: "Connected to {host}:{port}.", ru: "Соединение с {host}:{port} установлено." },
} satisfies Messages;
