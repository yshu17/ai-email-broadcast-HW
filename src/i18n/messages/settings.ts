import type { Messages } from "../define";

/** The Settings page. */
export const settings = {
  "settings.saved": { en: "Settings saved.", ru: "Настройки сохранены." },
  "settings.testFailed": { en: "Test failed", ru: "Проверка не удалась" },
  "settings.envOverride": {
    en: "Some settings come from environment variables and take precedence over anything saved here: <b>{names}</b>. Editing them below has no effect until the variables are removed.",
    ru: "Часть настроек берётся из переменных окружения и важнее сохранённых здесь: <b>{names}</b>. Изменения ниже не действуют, пока эти переменные не будут убраны.",
  },
  "settings.overrideNote": {
    en: "Overridden by an environment variable — this value is ignored until that variable is removed.",
    ru: "Переопределено переменной окружения — это значение игнорируется, пока переменная не будет убрана.",
  },
  "settings.smtp.title": { en: "SMTP server", ru: "SMTP-сервер" },
  "settings.smtp.host": { en: "Hostname", ru: "Адрес сервера" },
  "settings.smtp.port": { en: "Port", ru: "Порт" },
  "settings.smtp.encryption": { en: "Encryption", ru: "Шифрование" },
  "settings.smtp.starttls": { en: "STARTTLS (usually port 587)", ru: "STARTTLS (обычно порт 587)" },
  "settings.smtp.tls": { en: "TLS/SSL (usually port 465)", ru: "TLS/SSL (обычно порт 465)" },
  "settings.smtp.none": { en: "None (unencrypted)", ru: "Без шифрования" },
  "settings.smtp.username": { en: "Username", ru: "Логин" },
  "settings.smtp.passwordStored": {
    en: "•••••••• (stored — leave blank to keep)",
    ru: "•••••••• (сохранён — оставьте пустым, чтобы не менять)",
  },
  "settings.smtp.passwordPlaceholder": { en: "SMTP password", ru: "Пароль SMTP" },
  "settings.smtp.passwordHint": {
    en: "Encrypted with AES-256-GCM before it is stored and never sent back to the browser.",
    ru: "Шифруется AES-256-GCM перед сохранением и никогда не отправляется обратно в браузер.",
  },
  "settings.smtp.passwordCurrent": { en: " A password is currently stored.", ru: " Сейчас пароль сохранён." },
  "settings.sender.title": { en: "Sender", ru: "Отправитель" },
  "settings.sender.email": { en: "Sender email", ru: "Адрес отправителя" },
  "settings.sender.emailHint": {
    en: "Must be a sender address your SMTP provider has verified.",
    ru: "Это должен быть адрес отправителя, подтверждённый вашим SMTP-провайдером.",
  },
  "settings.sender.name": { en: "Display name", ru: "Отображаемое имя" },
  "settings.sender.replyTo": { en: "Reply-To (optional)", ru: "Адрес для ответов (необязательно)" },
  "settings.rate.title": { en: "Sending rate", ru: "Скорость отправки" },
  "settings.rate.max": { en: "Maximum emails per hour", ru: "Максимум писем в час" },
  "settings.rate.hint": {
    en: "SendPulse allows roughly 5,000 SMTP emails per hour. The worker sends slightly below this ceiling as a safety margin, and counts a rolling hour rather than resetting on the clock.",
    ru: "SendPulse разрешает примерно 5 000 SMTP-писем в час. Воркер отправляет чуть меньше этого потолка для запаса и считает скользящий час, а не сбрасывает счётчик по часам.",
  },
  "settings.test.title": { en: "Test", ru: "Проверка" },
  "settings.test.sendTo": { en: "Send a test email to", ru: "Отправить тестовое письмо на" },
  "settings.test.connection": { en: "Test connection", ru: "Проверить соединение" },
  "settings.test.checking": { en: "Checking…", ru: "Проверка…" },
  "settings.test.send": { en: "Send test email", ru: "Отправить тестовое письмо" },
  "settings.test.sending": { en: "Sending…", ru: "Отправка…" },
  "settings.test.saveFirst": {
    en: "Save your changes first — tests use the stored settings.",
    ru: "Сначала сохраните изменения — проверка использует сохранённые настройки.",
  },
  "settings.save": { en: "Save settings", ru: "Сохранить настройки" },
} satisfies Messages;
