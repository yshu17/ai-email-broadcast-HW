import type { Messages } from "../define";

/**
 * The names of form fields as they appear inside validation messages
 * («Название рассылки: обязательное поле»). Routes pass the English label; the
 * API layer looks it up here.
 */
export const labels = {
  "label.Email": { en: "Email", ru: "Эл. почта" },
  "label.Password": { en: "Password", ru: "Пароль" },
  "label.Campaign name": { en: "Campaign name", ru: "Название рассылки" },
  "label.Subject": { en: "Subject", ru: "Тема" },
  "label.Sender name": { en: "Sender name", ru: "Имя отправителя" },
  "label.Sender email": { en: "Sender email", ru: "Адрес отправителя" },
  "label.Reply-To": { en: "Reply-To", ru: "Адрес для ответов" },
  "label.Plain text": { en: "Plain text", ru: "Простой текст" },
  "label.listIds": { en: "listIds", ru: "Списки" },
  "label.Recipient": { en: "Recipient", ru: "Получатель" },
  "label.First name": { en: "First name", ru: "Имя" },
  "label.Last name": { en: "Last name", ru: "Фамилия" },
  "label.List name": { en: "List name", ru: "Название списка" },
  "label.Description": { en: "Description", ru: "Описание" },
  "label.Encryption mode": { en: "Encryption mode", ru: "Режим шифрования" },
  "label.SMTP host": { en: "SMTP host", ru: "Хост SMTP" },
  "label.SMTP port": { en: "SMTP port", ru: "Порт SMTP" },
  "label.SMTP username": { en: "SMTP username", ru: "Логин SMTP" },
  "label.Hourly limit": { en: "Hourly limit", ru: "Лимит в час" },
  "label.Scheduler interval": { en: "Scheduler interval", ru: "Интервал планировщика" },
  "label.Max emails": { en: "Max emails", ru: "Макс. писем" },
  "label.Interval": { en: "Interval", ru: "Интервал" },
  "label.Recipients": { en: "Recipients", ru: "Получатели" },
  "label.Slow response delay": { en: "Slow response delay", ru: "Задержка ответа" },
  "label.Temporary failures": { en: "Temporary failures", ru: "Число временных ошибок" },
  "label.Overdue by": { en: "Overdue by", ru: "Просрочена на" },
} satisfies Messages;
