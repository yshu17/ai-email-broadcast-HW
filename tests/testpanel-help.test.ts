import { describe, expect, it } from "vitest";
import { messages } from "@/i18n/messages";
import { hasMessage } from "@/i18n/translate";
import { LOCALES, type Locale } from "@/i18n/locale";
import { HELP_ENTRIES, HELP_IDS, helpEntry, type HelpId } from "@/lib/testing/help";
import { helpModel, helpParams } from "@/lib/testing/help-model";
import { TEST_LIMITS, checkInteger } from "@/lib/testing/limits";
import { RATE_PRESETS, TEST_TEMPLATES } from "@/lib/testing/templates";
import { rateLimitAction, schedulerAction } from "@/lib/testing/actions";
import { testScheduler } from "@/lib/testing/test-scheduler";
import { setRateOverride } from "@/lib/testing/controls";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, afterEach, vi } from "vitest";
import { disableTestTools, enableTestTools } from "./testpanel-helpers";

/**
 * The registry of help and what it says. Every element of the panel has an entry; every entry
 * has its words in both languages; and no number in those words was typed in by hand: ranges
 * and recommendations are drawn from the same limits the server and the forms enforce.
 */
const helpKeys = Object.keys(messages).filter((key) => key.startsWith("help."));

describe("the registry", () => {
  it("has an entry for a large set of elements, each with a unique id", () => {
    expect(HELP_IDS.length).toBeGreaterThanOrEqual(75);
    expect(new Set(HELP_IDS).size).toBe(HELP_IDS.length);
  });

  it("uses a short tooltip for simple figures and a structured popover for anything more", () => {
    const kinds = HELP_ENTRIES.map((entry) => entry.kind);
    expect(kinds).toContain("tooltip");
    expect(kinds).toContain("popover");
    for (const entry of HELP_ENTRIES) {
      if (entry.kind === "tooltip") {
        expect("limit" in entry, `${entry.id} is a tooltip but has a range`).toBe(false);
      }
    }
  });

  it("gives every entry that has a numeric range a unit, so the range says what it measures", () => {
    for (const entry of HELP_ENTRIES) {
      if ("limit" in entry) expect("unit" in entry, entry.id).toBe(true);
    }
  });

  it("gives every popover a lifetime and a moment it applies, and every setting a recommendation", () => {
    for (const entry of HELP_ENTRIES) {
      if (entry.kind !== "popover") continue;
      expect("applies" in entry, `${entry.id}: when it applies`).toBe(true);
      expect("lifetime" in entry, `${entry.id}: how long it lasts`).toBe(true);
    }
    for (const entry of HELP_ENTRIES) {
      if ("limit" in entry) {
        const custom = hasMessage(`help.${entry.id}.recommended`);
        expect("recommended" in entry || custom, `${entry.id}: recommended values`).toBe(true);
      }
    }
  });
});

describe("the dictionary", () => {
  it.each(HELP_IDS)("has the words for %s, in both languages", (id) => {
    const entry = helpEntry(id);
    expect(messages[`help.${id}.title` as keyof typeof messages], `${id} title`).toBeDefined();
    if (entry.kind === "tooltip") {
      expect(messages[`help.${id}.tip` as keyof typeof messages], `${id} tip`).toBeDefined();
    } else {
      expect(messages[`help.${id}.what` as keyof typeof messages], `${id} what`).toBeDefined();
      expect(messages[`help.${id}.impact` as keyof typeof messages], `${id} impact`).toBeDefined();
    }
    const hasWarningText = hasMessage(`help.${id}.warning`);
    expect(hasWarningText, `${id}: the registry says ${"warning" in entry ? "there is" : "there is no"} an Important part`)
      .toBe("warning" in entry);
  });

  it("has no text for an element that is not in the registry", () => {
    const shared = /^help\.(ariaLabel|close|section|range|recommended|unit|applies|lifetime)\b/;
    const ids = new Set<string>(HELP_IDS);
    for (const key of helpKeys) {
      if (shared.test(key)) continue;
      const id = key.split(".")[1];
      expect(ids.has(id), `${key} belongs to no registry entry`).toBe(true);
    }
  });

  it("has the same placeholders in both languages for every help text", () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of helpKeys) {
      const message = messages[key as keyof typeof messages];
      expect(placeholders(message.ru), key).toEqual(placeholders(message.en));
    }
  });

  it("never writes a numeric range by hand: ranges are filled in from the limits", () => {
    for (const key of helpKeys) {
      const message = messages[key as keyof typeof messages];
      for (const locale of LOCALES) {
        expect(message[locale], `${key} (${locale})`).not.toMatch(/\d\s*[–-]\s*\d/);
      }
    }
  });

  it("carries no secrets, credentials, real addresses or connection strings", () => {
    for (const key of helpKeys) {
      const message = messages[key as keyof typeof messages];
      for (const locale of LOCALES) {
        const text = message[locale];
        expect(text, `${key} (${locale})`).not.toMatch(/postgres:\/\/|mysql:\/\/|smtp:\/\/|api[_ -]?key|bearer\s+\w|token\s*[:=]/i);
        expect(text, `${key} (${locale})`).not.toMatch(/[\w.+-]+@(?!test\.invalid)[\w-]+\.[a-z]{2,}/i);
      }
    }
  });
});

describe.each(LOCALES)("the help as a person reads it (%s)", (locale: Locale) => {
  it.each(HELP_IDS)("%s has a title and a summary, and no placeholder is left unfilled", (id) => {
    const model = helpModel(id as HelpId, locale);

    expect(model.title.trim().length).toBeGreaterThan(0);
    expect(model.summary.trim().length).toBeGreaterThan(0);
    const all = [model.title, model.summary, ...model.sections.map((section) => `${section.label} ${section.text}`)].join(" ");
    expect(all, `${id}`).not.toMatch(/\{\w+\}/);
    expect(all, `${id}`).not.toMatch(/^help\./m);
    expect(all).not.toContain("undefined");
    expect(all).not.toContain("NaN");
  });

  it("a popover has its parts in a fixed order, each with a label", () => {
    const order = ["what", "impact", "unit", "range", "recommended", "applies", "lifetime", "warning"];
    for (const id of HELP_IDS) {
      const model = helpModel(id, locale);
      if (model.kind !== "popover") {
        expect(model.sections, id).toEqual([]);
        continue;
      }
      const keys = model.sections.map((section) => section.key);
      expect(keys.slice(0, 2), id).toEqual(["what", "impact"]);
      expect([...keys].sort((a, b) => order.indexOf(a) - order.indexOf(b)), id).toEqual(keys);
      for (const section of model.sections) expect(section.label.length).toBeGreaterThan(0);
    }
  });

  it("gives every setting its unit, its range, a recommendation, when it applies and how long it lasts", () => {
    for (const entry of HELP_ENTRIES) {
      if (!("limit" in entry)) continue;
      const keys = helpModel(entry.id, locale).sections.map((section) => section.key);
      for (const needed of ["unit", "range", "recommended", "applies", "lifetime"]) {
        expect(keys, `${entry.id} lacks ${needed}`).toContain(needed);
      }
    }
  });
});

describe("the ranges in the help are the ones that are enforced", () => {
  const limits = [
    ["schedInterval", "schedulerInterval"], ["rateMaxEmails", "rateMaxEmails"], ["rateInterval", "rateWindowSeconds"],
    ["newRecipients", "recipients"], ["newSlowDelay", "slowDelaySeconds"], ["newTempFailures", "temporaryFailures"],
    ["newOverdueMinutes", "overdueMinutes"],
  ] as const;

  it.each(limits)("%s shows exactly the bounds of %s", (id, limit) => {
    const { min, max } = TEST_LIMITS[limit];
    for (const locale of LOCALES) {
      const range = helpModel(id, locale).sections.find((section) => section.key === "range")?.text;
      expect(range, `${id} ${locale}`).toContain(`${min}–${max}`);
    }
  });

  it("the scheduler interval reads as the example in the requirements: 1–300 seconds, quick 2–5, long-running 10–30", () => {
    const en = helpModel("schedInterval", "en");
    expect(en.sections.find((s) => s.key === "range")?.text).toBe("1–300 seconds");
    expect(en.sections.find((s) => s.key === "recommended")?.text).toContain("2–5 seconds");
    expect(en.sections.find((s) => s.key === "recommended")?.text).toContain("10–30 seconds");
    const ru = helpModel("schedInterval", "ru");
    expect(ru.sections.find((s) => s.key === "range")?.text).toBe("1–300 секунд");
  });

  it("the recipients help gives the ranges from the requirements: quick, rate checking, longer runs", () => {
    const text = helpModel("newRecipients", "en").sections.find((s) => s.key === "recommended")?.text ?? "";
    expect(text).toContain("3–10");
    expect(text).toContain("20–50");
    expect(text).toContain("100–500");
  });

  it("templates and presets show their own numbers, taken from the same lists that fill the form", () => {
    for (const template of TEST_TEMPLATES) {
      const id = `tpl${template.id[0].toUpperCase()}${template.id.slice(1)}` as HelpId;
      const params = helpParams(id);
      expect(params.recipients).toBe(template.recipients);
    }
    for (const preset of RATE_PRESETS) {
      const id = `ratePreset${preset.id[0].toUpperCase()}${preset.id.slice(1)}` as HelpId;
      expect(helpModel(id, "en").title).toBe(`Emails: ${preset.maxEmails} / ${preset.windowSeconds} s`);
    }
  });

  it("every template has help, and every preset has help", () => {
    for (const template of TEST_TEMPLATES) {
      expect(HELP_IDS).toContain(`tpl${template.id[0].toUpperCase()}${template.id.slice(1)}`);
    }
    for (const preset of RATE_PRESETS) {
      expect(HELP_IDS).toContain(`ratePreset${preset.id[0].toUpperCase()}${preset.id.slice(1)}`);
    }
  });
});

describe("the same limits are checked by the browser's helper and by the server", () => {
  beforeEach(async () => { await enableTestTools(); });
  afterEach(async () => {
    testScheduler.reset();
    await disableTestTools();
    vi.restoreAllMocks();
  });

  const cases = [
    ["schedulerInterval", (value: unknown) => testScheduler.setInterval(value).ok],
    ["rateMaxEmails", (value: unknown) => setRateOverride(value, 10).ok],
    ["rateWindowSeconds", (value: unknown) => setRateOverride(2, value).ok],
  ] as const;

  it.each(cases)("%s: the shared check and the server agree at and just beyond both bounds", (limit, serverAccepts) => {
    const { min, max } = TEST_LIMITS[limit];
    for (const value of [min - 1, min, max, max + 1, 0, -1, 1.5, "x", ""]) {
      const browser = checkInteger(limit, value).ok;
      expect(serverAccepts(value), `${limit}=${JSON.stringify(value)}`).toBe(browser);
    }
    expect(checkInteger(limit, min).ok).toBe(true);
    expect(checkInteger(limit, max).ok).toBe(true);
    expect(checkInteger(limit, min - 1).ok).toBe(false);
    expect(checkInteger(limit, max + 1).ok).toBe(false);
  });

  it("the actions read the bounds from the same object, not from copies", () => {
    // Refuse one past the ceiling, using the limit's own number: it moves if the limit moves.
    expect(() => rateLimitAction({ action: "apply", maxEmails: TEST_LIMITS.rateMaxEmails.max + 1, windowSeconds: 10 })).toThrow();
    expect(() => schedulerAction({ action: "interval", seconds: TEST_LIMITS.schedulerInterval.max + 1 })).not.toBeUndefined();
    const source = readFileSync(join(process.cwd(), "src", "lib", "testing", "actions.ts"), "utf8");
    // No bound of its own (1000 as a factor for milliseconds is a unit conversion, not a limit).
    expect(source).not.toMatch(/\b(300|500|3600)\b|(?<!\* )\b1000\b/);
  });
});

describe("the documentation says what the code enforces", () => {
  const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
  const section = readme.slice(readme.indexOf("## Developer test panel"), readme.indexOf("## Development"));
  const row = (label: string) => section.split("\n").find((line) => line.startsWith(`| ${label}`)) ?? "";

  const rows: [string, keyof typeof TEST_LIMITS, string][] = [
    ["Scheduler interval", "schedulerInterval", "seconds"],
    ["Max emails (rate limit)", "rateMaxEmails", ""],
    ["Interval (rate-limit window)", "rateWindowSeconds", "seconds"],
    ["Recipients of a test campaign", "recipients", ""],
    ["Slow response delay", "slowDelaySeconds", "seconds"],
    ["Temporary failures", "temporaryFailures", ""],
    ["Overdue by", "overdueMinutes", "minutes"],
    ["Test clock year", "clockYear", ""],
  ];

  it.each(rows)("the README's range for %s is the limit's own", (label, limit) => {
    const { min, max } = TEST_LIMITS[limit] as { min: number; max: number };
    expect(row(label), label).toContain(`${min}–${max}`);
  });

  it("the README's recommendations are the limits' own", () => {
    const interval = TEST_LIMITS.schedulerInterval;
    expect(row("Scheduler interval")).toContain(`${interval.recommended.min}–${interval.recommended.max} s`);
    expect(row("Scheduler interval")).toContain(`${interval.longRun.min}–${interval.longRun.max} s`);
    const recipients = TEST_LIMITS.recipients;
    expect(row("Recipients of a test campaign")).toContain(`${recipients.recommended.min}–${recipients.recommended.max}`);
    expect(row("Recipients of a test campaign")).toContain(`${recipients.rateCheck.min}–${recipients.rateCheck.max}`);
    expect(row("Recipients of a test campaign")).toContain(`${recipients.longRun.min}–${recipients.longRun.max}`);
  });

  it("the example config has the switch, off; and never a real value", () => {
    const example = readFileSync(join(process.cwd(), ".env.example"), "utf8");
    expect(example).toMatch(/^ENABLE_EMAIL_TEST_PANEL=false$/m);
    expect(example).not.toMatch(/^ENABLE_EMAIL_TEST_PANEL=true/m);
  });

  it("Git ignores the local .env and the folder of saved test emails", () => {
    const ignore = readFileSync(join(process.cwd(), ".gitignore"), "utf8");
    expect(ignore).toMatch(/^\.env$/m);
    expect(ignore).toMatch(/^\/received-emails\/$/m);
  });
});
