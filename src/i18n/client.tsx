"use client";

import { createContext, useContext, useMemo } from "react";
import { setActiveLocale } from "./active";
import { formatDateTime, formatNumber } from "./format";
import { LOCALE_COOKIE, type Locale } from "./locale";
import { translate, type MessageKey, type Params } from "./translate";

/**
 * English when there is no provider, so markup rendered in tests without one keeps
 * reading as it always did. In the app the root layout always provides the visitor's
 * language.
 */
const LocaleContext = createContext<Locale>("en");

export function LocaleProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  setActiveLocale(locale); // for code outside React (see active.ts); the same value on every render
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export type Translator = {
  locale: Locale;
  t: (key: MessageKey, params?: Params) => string;
  formatDate: (value: string | Date | null | undefined) => string;
  formatNumber: (value: number) => string;
};

/** Text, dates and numbers in the visitor's language. */
export function useT(): Translator {
  const locale = useLocale();
  return useMemo(
    () => ({
      locale,
      t: (key, params) => translate(locale, key, params),
      formatDate: (value) => formatDateTime(value, locale),
      formatNumber: (value) => formatNumber(value, locale),
    }),
    [locale],
  );
}

/** Remembers the choice for a year, in the cookie the server reads. */
export function writeLocaleCookie(target: { cookie: string }, locale: Locale): void {
  target.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; SameSite=Lax`;
}
