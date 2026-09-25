import { cookies, headers } from "next/headers";
import {
  DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_HEADER, emailLocale, normalizeLocale, parseAcceptLanguage, type Locale,
} from "./locale";

/**
 * The language to render a page in: the visitor's cookie, else the default (Russian).
 * Called outside a request (as in unit tests) it does not throw; it gives the default.
 */
export async function getLocale(): Promise<Locale> {
  try {
    return normalizeLocale((await cookies()).get(LOCALE_COOKIE)?.value) ?? DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

/**
 * The language of a page a recipient opens from an email, who has no account and no
 * preference yet: their own choice if they made one, else what their browser asks for,
 * else the language the mail was written in.
 */
export async function getPublicLocale(): Promise<Locale> {
  try {
    const chosen = normalizeLocale((await cookies()).get(LOCALE_COOKIE)?.value);
    if (chosen) return chosen;
    const asked = parseAcceptLanguage((await headers()).get("accept-language"));
    if (asked) return asked;
  } catch {
    // Outside a request there is nobody to ask.
  }
  return emailLocale();
}

/**
 * The language for text an API route sends back: the `x-locale` header the app's own
 * pages send, else the cookie, else English. English, not Russian, when nothing says
 * otherwise: cron jobs, scripts and tests are the callers that say nothing, and they
 * should get the stable, documented wording.
 */
export async function getApiLocale(): Promise<Locale> {
  try {
    const fromHeader = normalizeLocale((await headers()).get(LOCALE_HEADER));
    if (fromHeader) return fromHeader;
    return normalizeLocale((await cookies()).get(LOCALE_COOKIE)?.value) ?? "en";
  } catch {
    return "en";
  }
}
