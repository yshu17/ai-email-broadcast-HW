import type { Messages } from "../define";

/** The dashboard and the "new campaign" form. */
export const dashboard = {
  "dashboard.title": { en: "Dashboard", ru: "Главная" },
  "dashboard.newCampaign": { en: "New campaign", ru: "Новая рассылка" },
  "dashboard.smtpMissing": { en: "SMTP is not configured yet.", ru: "SMTP ещё не настроен." },
  "dashboard.smtpSetUp": { en: "Set it up", ru: "Настройте его" },
  "dashboard.smtpBeforeSending": { en: "before sending.", ru: "перед отправкой." },
  "dashboard.sent7d": { en: "Sent (last 7 days)", ru: "Отправлено (за 7 дней)" },
  "dashboard.sentAllTime": { en: "{count} sent all time", ru: "Всего отправлено: {count}" },
  "dashboard.queue": { en: "Current queue", ru: "Очередь сейчас" },
  "dashboard.queueDetail": {
    en: "{sending} in flight · {used} of {limit} used this hour",
    ru: "{sending} отправляется · {used} из {limit} за этот час",
  },
  "dashboard.openRate": { en: "Open rate", ru: "Доля открытий" },
  "dashboard.opensApproximate": {
    en: "Opens are approximate — see a campaign for detail",
    ru: "Открытия приблизительные — подробности в самой рассылке",
  },
  "dashboard.gettingStarted": { en: "Getting started", ru: "С чего начать" },
  "dashboard.step1.before": {
    en: "Configure SMTP and send yourself a test message in",
    ru: "Настройте SMTP и отправьте себе тестовое письмо на странице",
  },
  "dashboard.step2.before": {
    en: "Create a list and import contacts in",
    ru: "Создайте список и импортируйте контакты на странице",
  },
  "dashboard.step3.before": {
    en: "Compose and queue a campaign in",
    ru: "Составьте рассылку и поставьте её в очередь на странице",
  },

  "campaignNew.title": { en: "New campaign", ru: "Новая рассылка" },
  "campaignNew.name": { en: "Internal name", ru: "Внутреннее название" },
  "campaignNew.namePlaceholder": { en: "October newsletter", ru: "Октябрьская рассылка" },
  "campaignNew.nameHint": { en: "Only you see this.", ru: "Видно только вам." },
  "campaignNew.subject": { en: "Email subject", ru: "Тема письма" },
  "campaignNew.subjectPlaceholder": { en: "What's new this month", ru: "Что нового в этом месяце" },
  "campaignNew.subjectHint": { en: "You can change this in the next step.", ru: "Её можно изменить на следующем шаге." },
  "campaignNew.create": { en: "Create draft", ru: "Создать черновик" },
  "campaignNew.creating": { en: "Creating…", ru: "Создание…" },
  "campaignNew.failed": { en: "Could not create the campaign", ru: "Не удалось создать рассылку" },
} satisfies Messages;
