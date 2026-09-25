import type { Messages } from "../define";

/**
 * Text that goes into emails themselves, and the public unsubscribe page a recipient
 * lands on. Neither is the admin interface: the mail speaks EMAIL_LANGUAGE, and the
 * page speaks the visitor's own language.
 */
export const email = {
  "email.smtpTest.subject": { en: "SMTP test message", ru: "Тестовое сообщение SMTP" },
  "email.smtpTest.body": {
    en: "This is a test message confirming your SMTP settings work.",
    ru: "Это тестовое сообщение: оно подтверждает, что настройки SMTP работают.",
  },
  "email.footer.reason": {
    en: "You are receiving this email because you subscribed to our list.",
    ru: "Вы получаете это письмо, потому что подписались на нашу рассылку.",
  },
  "email.footer.unsubscribe": { en: "Unsubscribe", ru: "Отписаться" },
  "email.text.unsubscribe": { en: "Unsubscribe: {url}", ru: "Отписаться: {url}" },

  "unsubscribe.invalid.title": { en: "Link not recognised", ru: "Ссылка не распознана" },
  "unsubscribe.invalid.body": {
    en: "This unsubscribe link is invalid or has expired. If you keep receiving mail you did not ask for, reply to one of the messages and we will remove you.",
    ru: "Эта ссылка для отписки недействительна или устарела. Если вы продолжаете получать письма, которых не просили, ответьте на любое из них — и мы вас удалим.",
  },
  "unsubscribe.done.title": { en: "You are unsubscribed", ru: "Вы отписались" },
  "unsubscribe.done.body": {
    en: "<b>{email}</b> will not receive further emails from us.",
    ru: "На адрес <b>{email}</b> мы больше не будем отправлять письма.",
  },
  "unsubscribe.title": { en: "Unsubscribe", ru: "Отписка" },
  "unsubscribe.question": {
    en: "Stop sending emails to <b>{email}</b>?",
    ru: "Перестать отправлять письма на адрес <b>{email}</b>?",
  },
  "unsubscribe.error": { en: "Something went wrong. Please try again.", ru: "Что-то пошло не так. Попробуйте ещё раз." },
  "unsubscribe.button": { en: "Yes, unsubscribe me", ru: "Да, отписать меня" },
  "unsubscribe.busy": { en: "Unsubscribing…", ru: "Отписка…" },
} satisfies Messages;
