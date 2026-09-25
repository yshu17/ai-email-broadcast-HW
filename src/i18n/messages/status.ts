import type { Messages } from "../define";

/**
 * How statuses read on screen. The values in the database and the API stay the
 * uppercase identifiers; only what is shown changes. In English they are shown as
 * they always were.
 */
export const status = {
  "status.DRAFT": { en: "DRAFT", ru: "Черновик" },
  "status.SCHEDULED": { en: "SCHEDULED", ru: "Запланирована" },
  "status.QUEUED": { en: "QUEUED", ru: "В очереди" },
  "status.SENDING": { en: "SENDING", ru: "Отправляется" },
  "status.PAUSED": { en: "PAUSED", ru: "На паузе" },
  "status.COMPLETED": { en: "COMPLETED", ru: "Завершена" },
  "status.CANCELLED": { en: "CANCELLED", ru: "Отменена" },
  "status.SENT": { en: "SENT", ru: "Отправлено" },
  "status.FAILED": { en: "FAILED", ru: "Ошибка" },
  "status.SUPPRESSED": { en: "SUPPRESSED", ru: "Отписан" },
} satisfies Messages;
