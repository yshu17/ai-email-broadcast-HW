/**
 * Which languages the interface speaks, and how a language is recognised.
 * Pure and dependency-free: used by the server, the browser and the tests.
 */

export type Locale = "ru" | "en";

export const LOCALES: readonly Locale[] = ["ru", "en"];

/** What a first-time visitor sees. */
export const DEFAULT_LOCALE: Locale = "ru";

/** The cookie the language switcher writes and the server reads. */
export const LOCALE_COOKIE = "locale";

/** The header the browser client sends with every API request. */
export const LOCALE_HEADER = "x-locale";

/** `"RU"`, `" ru-RU "` and `"ru"` are all Russian; anything else is not a language we have. */
export function normalizeLocale(value: unknown): Locale | null {
  if (typeof value !== "string") return null;
  const primary = value.trim().toLowerCase().split(/[-_]/)[0];
  return primary === "ru" || primary === "en" ? primary : null;
}

/** The first supported language in an `Accept-Language` header, best-liked first. */
export function parseAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => /^\s*q=([\d.]+)\s*$/.exec(p)).find(Boolean);
      return { tag, q: q ? Number(q[1]) : 1, index };
    })
    .filter((entry) => entry.tag && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const { tag } of ranked) {
    const locale = normalizeLocale(tag);
    if (locale) return locale;
  }
  return null;
}

/**
 * The language of everything the app writes into an email (the unsubscribe footer,
 * the plain-text line). It is a property of the deployment, not of whoever happens to
 * be logged in: switching the admin screen to English must not change what recipients
 * receive. Set EMAIL_LANGUAGE=en to keep the English wording.
 */
export function emailLocale(): Locale {
  return normalizeLocale(process.env.EMAIL_LANGUAGE) ?? DEFAULT_LOCALE;
}

/** The BCP 47 tag `Intl` wants for dates, numbers and plural rules. */
export function intlTag(locale: Locale): string {
  return locale === "ru" ? "ru-RU" : "en-US";
}
