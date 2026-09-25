import type { Messages } from "../define";

/** The pages Next shows when something is missing or breaks. */
export const pages = {
  "notFound.title": { en: "Page not found", ru: "Страница не найдена" },
  "notFound.body": {
    en: "There is nothing at this address. It may have been deleted, or the link may be wrong.",
    ru: "По этому адресу ничего нет. Возможно, страницу удалили или ссылка неверна.",
  },
  "notFound.home": { en: "Back to the dashboard", ru: "На главную" },
  "crash.title": { en: "Something went wrong", ru: "Что-то пошло не так" },
  "crash.body": {
    en: "The page could not be shown. Your data is safe. Try again, and if it keeps happening, check the server log.",
    ru: "Не удалось показать страницу. Ваши данные в безопасности. Повторите попытку, а если это повторяется, загляните в журнал сервера.",
  },
  "crash.retry": { en: "Try again", ru: "Повторить" },
} satisfies Messages;
