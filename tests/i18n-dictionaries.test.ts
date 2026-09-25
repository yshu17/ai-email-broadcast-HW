import { describe, expect, it } from "vitest";
import * as allDomains from "@/i18n/messages/domains";
import { messages } from "@/i18n/messages";
// The developer panel's words are kept out of `domains` on purpose (see there), so they are added here.
import { testguide } from "@/i18n/messages/testguide";
import { testhelp } from "@/i18n/messages/testhelp";
import { testpanel } from "@/i18n/messages/testpanel";

/**
 * The dictionary is the single place UI text lives, so its shape is checked hard:
 * nothing may be missing in either language, nothing empty, no placeholder may
 * appear in only one translation, and plural sets must be complete.
 */
const entries = Object.entries(messages) as [string, { en: string; ru: string }][];
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("the message dictionary", () => {
  it("has messages", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it("has no key defined in two domain files", () => {
    const domains = [...Object.values(allDomains), testhelp, testpanel, testguide] as Record<string, unknown>[];
    const total = domains.reduce((sum, domain) => sum + Object.keys(domain).length, 0);
    expect(Object.keys(messages)).toHaveLength(total);
  });

  it("gives every key a non-empty English and Russian text", () => {
    const empty = entries.filter(([, value]) => !value.en?.trim() || !value.ru?.trim()).map(([key]) => key);
    expect(empty).toEqual([]);
  });

  it("uses the same {placeholders} in both languages", () => {
    const mismatched = entries
      .filter(([, value]) => placeholders(value.en).join() !== placeholders(value.ru).join())
      .map(([key, value]) => `${key}: en ${JSON.stringify(placeholders(value.en))} vs ru ${JSON.stringify(placeholders(value.ru))}`);
    expect(mismatched).toEqual([]);
  });

  it("gives every plural set all the forms Russian needs", () => {
    const bases = new Set(entries.map(([key]) => key).filter((key) => /\.(one|few|many|other)$/.test(key)).map((key) => key.replace(/\.(one|few|many|other)$/, "")));
    const incomplete = [...bases].filter((base) => !["one", "few", "many", "other"].every((form) => `${base}.${form}` in messages));
    expect(incomplete).toEqual([]);
  });

  it("does not leave the Russian text identical to the English one for anything with real words", () => {
    // Identical is fine for brand names, protocol names and the like; those are listed here on purpose.
    // The developer panel's `API`, `scheduledAt` (a field name) and `Rate limiter` (a term of the trade) are the same on purpose.
    const allowed = new Set(["HTML", "SMTP", "CSV", "URL", "RU", "EN", "Mailer", "TLS/SSL", "STARTTLS", "API", "scheduledAt (UTC)", "Rate limiter"]);
    // A text made only of {placeholders} and punctuation has no words of its own to translate.
    const words = (text: string) => text.replace(/\{\w+\}/g, "");
    const same = entries
      .filter(([, value]) => value.en === value.ru && /[A-Za-z]{3,}/.test(words(value.en)) && !allowed.has(value.en))
      .map(([key, value]) => `${key}: ${value.en}`);
    expect(same).toEqual([]);
  });
});
