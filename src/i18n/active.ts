import type { Locale } from "./locale";

/**
 * The language of the page currently on screen, for code that runs outside React
 * (the `api()` fetch wrapper, error fallbacks). `LocaleProvider` records it on every
 * render, so it is right before any child effect fires and follows a language switch.
 * Only the browser reads it; the server passes the language explicitly.
 */
let active: Locale = "en";

export function setActiveLocale(locale: Locale): void {
  active = locale;
}

export function getActiveLocale(): Locale {
  return active;
}
