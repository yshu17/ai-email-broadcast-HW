import type { Messages } from "../define";

/** The email editor's toolbar and prompts. */
export const editor = {
  "editor.bold": { en: "Bold (Ctrl+B)", ru: "Жирный (Ctrl+B)" },
  "editor.italic": { en: "Italic (Ctrl+I)", ru: "Курсив (Ctrl+I)" },
  "editor.underline": { en: "Underline (Ctrl+U)", ru: "Подчёркнутый (Ctrl+U)" },
  "editor.paragraph": { en: "Paragraph", ru: "Абзац" },
  "editor.heading1": { en: "Heading 1", ru: "Заголовок 1" },
  "editor.heading2": { en: "Heading 2", ru: "Заголовок 2" },
  "editor.heading3": { en: "Heading 3", ru: "Заголовок 3" },
  "editor.bulletedList": { en: "Bulleted list", ru: "Маркированный список" },
  "editor.numberedList": { en: "Numbered list", ru: "Нумерованный список" },
  "editor.bulletedLabel": { en: "• List", ru: "• Список" },
  "editor.numberedLabel": { en: "1. List", ru: "1. Список" },
  "editor.alignLeft": { en: "Align left", ru: "По левому краю" },
  "editor.alignCenter": { en: "Align centre", ru: "По центру" },
  "editor.alignRight": { en: "Align right", ru: "По правому краю" },
  "editor.insertLink": { en: "Insert link", ru: "Вставить ссылку" },
  "editor.linkLabel": { en: "🔗 Link", ru: "🔗 Ссылка" },
  "editor.removeLink": { en: "Remove link", ru: "Удалить ссылку" },
  "editor.unlinkLabel": { en: "Unlink", ru: "Убрать ссылку" },
  "editor.undo": { en: "Undo (Ctrl+Z)", ru: "Отменить (Ctrl+Z)" },
  "editor.redo": { en: "Redo (Ctrl+Shift+Z)", ru: "Повторить (Ctrl+Shift+Z)" },
  "editor.visual": { en: "Visual", ru: "Визуально" },
  "editor.linkPrompt": { en: "Link URL (https://…)", ru: "Адрес ссылки (https://…)" },
  "editor.linkInvalid": {
    en: "Links must start with https://, http://, mailto: or tel:",
    ru: "Ссылка должна начинаться с https://, http://, mailto: или tel:",
  },
  "editor.sourceLabel": { en: "HTML source", ru: "HTML-код" },
  "editor.placeholder": {
    en: "Write your email… Use {variable} to personalize it.",
    ru: "Напишите письмо… Используйте {variable} для персонализации.",
  },
} satisfies Messages;
