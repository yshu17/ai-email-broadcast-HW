import type { Messages } from "../define";

/** The application shell: page title, language switcher, navigation, sign-in. */
export const app = {
  "app.title": { en: "Mailer", ru: "Mailer" },
  "app.description": { en: "Self-hosted email campaign manager", ru: "Менеджер email-рассылок на своём сервере" },

  "lang.label": { en: "Language", ru: "Язык" },

  "nav.dashboard": { en: "Dashboard", ru: "Главная" },
  "nav.contacts": { en: "Contacts", ru: "Контакты" },
  "nav.lists": { en: "Lists", ru: "Списки" },
  "nav.campaigns": { en: "Campaigns", ru: "Рассылки" },
  "nav.suppressions": { en: "Unsubscribed", ru: "Отписавшиеся" },
  "nav.settings": { en: "Settings", ru: "Настройки" },
  "nav.signOut": { en: "Sign out", ru: "Выйти" },
  "nav.toggleThemeTitle": { en: "Toggle light/dark", ru: "Светлая/тёмная тема" },
  "nav.toggleThemeLabel": { en: "Toggle theme", ru: "Переключить тему" },
  "nav.menu": { en: "Menu", ru: "Меню" },

  "login.subtitle": { en: "Sign in to manage your campaigns.", ru: "Войдите, чтобы управлять рассылками." },
  "login.email": { en: "Email", ru: "Эл. почта" },
  "login.password": { en: "Password", ru: "Пароль" },
  "login.submit": { en: "Sign in", ru: "Войти" },
  "login.submitting": { en: "Signing in…", ru: "Вход…" },
  "login.failed": { en: "Sign-in failed", ru: "Не удалось войти" },
} satisfies Messages;
