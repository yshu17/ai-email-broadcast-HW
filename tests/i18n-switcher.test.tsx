import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));

import LanguageSwitcher from "@/components/LanguageSwitcher";
import { LocaleProvider, useT, writeLocaleCookie } from "@/i18n/client";

afterEach(() => {
  vi.doUnmock("next/headers");
  vi.resetModules();
});

function Probe() {
  const { t, locale } = useT();
  return <p data-locale={locale}>{t("common.cancel")}</p>;
}

describe("the language switcher", () => {
  it("offers RU and EN, and marks the current language as pressed", () => {
    const ru = renderToStaticMarkup(<LocaleProvider locale="ru"><LanguageSwitcher /></LocaleProvider>);
    expect(ru).toMatch(/<button[^>]*aria-pressed="true"[^>]*>RU</);
    expect(ru).toMatch(/<button[^>]*aria-pressed="false"[^>]*>EN</);

    const en = renderToStaticMarkup(<LocaleProvider locale="en"><LanguageSwitcher /></LocaleProvider>);
    expect(en).toMatch(/<button[^>]*aria-pressed="true"[^>]*>EN</);
    expect(en).toMatch(/<button[^>]*aria-pressed="false"[^>]*>RU</);
  });

  it("names the group in the current language, for screen readers", () => {
    expect(renderToStaticMarkup(<LocaleProvider locale="ru"><LanguageSwitcher /></LocaleProvider>)).toContain('aria-label="Язык"');
    expect(renderToStaticMarkup(<LocaleProvider locale="en"><LanguageSwitcher /></LocaleProvider>)).toContain('aria-label="Language"');
  });

  it("gives each button the language's own name as a tooltip", () => {
    const html = renderToStaticMarkup(<LocaleProvider locale="en"><LanguageSwitcher /></LocaleProvider>);
    expect(html).toContain('title="Русский"');
    expect(html).toContain('title="English"');
  });

  it("remembers the choice in a year-long cookie the server can read", () => {
    const doc = { cookie: "" };
    writeLocaleCookie(doc, "en");
    expect(doc.cookie).toBe("locale=en; path=/; max-age=31536000; SameSite=Lax");
    writeLocaleCookie(doc, "ru");
    expect(doc.cookie).toBe("locale=ru; path=/; max-age=31536000; SameSite=Lax");
  });
});

describe("useT", () => {
  it("speaks the provider's language", () => {
    expect(renderToStaticMarkup(<LocaleProvider locale="ru"><Probe /></LocaleProvider>)).toBe('<p data-locale="ru">Отмена</p>');
    expect(renderToStaticMarkup(<LocaleProvider locale="en"><Probe /></LocaleProvider>)).toBe('<p data-locale="en">Cancel</p>');
  });

  it("falls back to English without a provider, so plain markup tests keep reading English", () => {
    expect(renderToStaticMarkup(<Probe />)).toBe('<p data-locale="en">Cancel</p>');
  });
});

describe("which language the server uses", () => {
  const withRequest = async (headers: Record<string, string>, cookies: Record<string, string>) => {
    vi.resetModules();
    vi.doMock("next/headers", () => ({
      headers: async () => new Headers(headers),
      cookies: async () => ({ get: (name: string) => (name in cookies ? { value: cookies[name] } : undefined) }),
    }));
    return import("@/i18n/server");
  };

  it("pages: the cookie decides, and Russian is the default", async () => {
    expect(await (await withRequest({}, { locale: "en" })).getLocale()).toBe("en");
    expect(await (await withRequest({}, { locale: "ru" })).getLocale()).toBe("ru");
    expect(await (await withRequest({}, {})).getLocale()).toBe("ru");
    expect(await (await withRequest({}, { locale: "klingon" })).getLocale()).toBe("ru");
  });

  it("pages: outside a request (as in tests) it does not throw and gives the default", async () => {
    vi.resetModules();
    const { getLocale } = await import("@/i18n/server");
    expect(await getLocale()).toBe("ru");
  });

  it("API: the x-locale header wins, then the cookie, then English", async () => {
    expect(await (await withRequest({ "x-locale": "ru" }, { locale: "en" })).getApiLocale()).toBe("ru");
    expect(await (await withRequest({}, { locale: "ru" })).getApiLocale()).toBe("ru");
    expect(await (await withRequest({}, {})).getApiLocale()).toBe("en");
    expect(await (await withRequest({ "x-locale": "xx" }, {})).getApiLocale()).toBe("en");
  });

  it("API: outside a request it is English, which is what machine clients and existing tests expect", async () => {
    vi.resetModules();
    const { getApiLocale } = await import("@/i18n/server");
    expect(await getApiLocale()).toBe("en");
  });

  it("API: a session cookie that is not a language is ignored", async () => {
    expect(await (await withRequest({}, { locale: "session-token" })).getApiLocale()).toBe("en");
  });
});
