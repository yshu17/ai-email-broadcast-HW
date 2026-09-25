"use client";

import { useRouter } from "next/navigation";
import { useLocale, useT, writeLocaleCookie } from "@/i18n/client";
import { LOCALES, type Locale } from "@/i18n/locale";

/** Each language is named in itself, whichever language is on screen. */
const ENDONYM: Record<Locale, string> = { ru: "Русский", en: "English" };

/**
 * RU | EN. Remembers the choice in a cookie and asks the server to render the page
 * again in that language; nothing on the client needs to reload.
 */
export default function LanguageSwitcher() {
  const current = useLocale();
  const { t } = useT();
  const router = useRouter();

  const choose = (locale: Locale) => {
    if (locale === current) return;
    writeLocaleCookie(document, locale);
    router.refresh();
  };

  return (
    <div role="group" aria-label={t("lang.label")} className="inline-flex overflow-hidden rounded-lg border">
      {LOCALES.map((locale) => (
        <button
          key={locale}
          type="button"
          lang={locale}
          title={ENDONYM[locale]}
          aria-pressed={locale === current}
          onClick={() => choose(locale)}
          className={`px-2 py-1 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 ${
            locale === current ? "btn-active" : ""
          }`}
        >
          {locale.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
