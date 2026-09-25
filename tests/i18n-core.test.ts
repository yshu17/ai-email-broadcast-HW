import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE, LOCALE_COOKIE, intlTag, normalizeLocale, parseAcceptLanguage,
} from "@/i18n/locale";
import { translate } from "@/i18n/translate";

describe("locale helpers", () => {
  it("defaults to Russian and names the cookie `locale`", () => {
    expect(DEFAULT_LOCALE).toBe("ru");
    expect(LOCALE_COOKIE).toBe("locale");
  });

  it.each([
    ["ru", "ru"], ["RU", "ru"], ["en", "en"], [" en ", "en"], ["ru-RU", "ru"], ["en-GB", "en"],
    ["fr", null], ["", null], [undefined, null], [null, null], [42, null], ["русский", null],
  ])("normalises %j to %j", (value, expected) => {
    expect(normalizeLocale(value)).toBe(expected);
  });

  it("maps a locale to the BCP 47 tag Intl wants", () => {
    expect(intlTag("ru")).toBe("ru-RU");
    expect(intlTag("en")).toBe("en-US");
  });

  it.each([
    ["ru-RU,ru;q=0.9,en;q=0.8", "ru"],
    ["en-US,en;q=0.9,ru;q=0.8", "en"],
    ["de,en;q=0.5", "en"],
    ["de,fr", null],
    ["en;q=0.2,ru;q=0.9", "ru"],
    ["", null],
    [null, null],
    [undefined, null],
  ])("picks the best supported language from %j", (header, expected) => {
    expect(parseAcceptLanguage(header)).toBe(expected);
  });
});

describe("translate", () => {
  it("returns the text for the locale asked for", () => {
    expect(translate("en", "common.cancel")).toBe("Cancel");
    expect(translate("ru", "common.cancel")).toBe("Отмена");
  });

  it("fills {placeholders} and leaves unknown ones alone", () => {
    expect(translate("en", "common.testSentTo", { email: "a@b.test" })).toBe("Test email sent to a@b.test.");
    expect(translate("ru", "common.testSentTo", { email: "a@b.test" })).toBe("Тестовое письмо отправлено на a@b.test.");
    expect(translate("en", "common.testSentTo", {})).toBe("Test email sent to {email}.");
  });

  it.each([
    [0, "0 получателей"], [1, "1 получатель"], [2, "2 получателя"], [4, "4 получателя"], [5, "5 получателей"],
    [11, "11 получателей"], [12, "12 получателей"], [21, "21 получатель"], [22, "22 получателя"], [25, "25 получателей"],
    [101, "101 получатель"], [111, "111 получателей"], [1.5, "1,5 получателя"],
  ])("uses the right Russian plural form for %d", (count, expected) => {
    expect(translate("ru", "common.recipients", { count })).toBe(expected);
  });

  it.each([[0, "0 recipients"], [1, "1 recipient"], [2, "2 recipients"], [21, "21 recipients"]])(
    "uses the right English plural form for %d", (count, expected) => {
      expect(translate("en", "common.recipients", { count })).toBe(expected);
    },
  );

  it("formats big numbers the way the language writes them", () => {
    expect(translate("en", "common.recipients", { count: 4850 })).toBe("4,850 recipients");
    expect(translate("ru", "common.recipients", { count: 4850 })).toMatch(/^4\s850 получателей$/);
  });

  it("returns the key itself rather than throwing for an unknown key", () => {
    expect(translate("ru", "no.such.key" as never)).toBe("no.such.key");
  });
});
