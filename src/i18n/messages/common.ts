import { plural, type Messages } from "../define";

/** Words and phrases used all over the interface. */
export const common = {
  "common.cancel": { en: "Cancel", ru: "Отмена" },
  "common.close": { en: "Close", ru: "Закрыть" },
  "common.loading": { en: "Loading…", ru: "Загрузка…" },
  "common.save": { en: "Save", ru: "Сохранить" },
  "common.saving": { en: "Saving…", ru: "Сохранение…" },
  "common.saveFailed": { en: "Save failed", ru: "Не удалось сохранить" },
  "common.delete": { en: "Delete", ru: "Удалить" },
  "common.deleteFailed": { en: "Delete failed", ru: "Не удалось удалить" },
  "common.edit": { en: "Edit", ru: "Изменить" },
  "common.add": { en: "Add", ru: "Добавить" },
  "common.remove": { en: "Remove", ru: "Убрать" },
  "common.open": { en: "Open", ru: "Открыть" },
  "common.create": { en: "Create", ru: "Создать" },
  "common.previous": { en: "Previous", ru: "Назад" },
  "common.next": { en: "Next", ru: "Вперёд" },
  "common.page": { en: "Page {page} of {pages}", ru: "Страница {page} из {pages}" },
  "common.email": { en: "Email", ru: "Эл. почта" },
  "common.firstName": { en: "First name", ru: "Имя" },
  "common.lastName": { en: "Last name", ru: "Фамилия" },
  "err.notFound": { en: "Not found", ru: "Не найдено" },
  "error.request": { en: "Request failed", ru: "Запрос не выполнен" },
  "error.requestStatus": { en: "Request failed ({status})", ru: "Запрос не выполнен ({status})" },
  "common.testSentTo": { en: "Test email sent to {email}.", ru: "Тестовое письмо отправлено на {email}." },
  ...plural(
    "common.recipients",
    { one: "{count} recipient", other: "{count} recipients" },
    { one: "{count} получатель", few: "{count} получателя", many: "{count} получателей", other: "{count} получателя" },
  ),
} satisfies Messages;
