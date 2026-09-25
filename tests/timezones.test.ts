import { afterEach, describe, expect, it } from "vitest";
import {
  describeLocalTimeZone, formatLocalDate, formatScheduledTime, getUserTimeZone, minimumTimeFor,
  parseScheduledAt, toScheduledAt,
} from "@/lib/scheduling";

/**
 * Time zones are always passed explicitly here, never read from the machine the
 * tests happen to run on, and "now" is always a fixed instant. The few tests that
 * check the browser-zone default set `process.env.TZ` themselves and restore it.
 */
const originalTz = process.env.TZ;
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

const NOW = new Date("2026-01-01T00:00:00.000Z");
const at = (timeZone: string, date: string, time: string, occurrence?: "first" | "second") =>
  toScheduledAt(date, time, NOW, { timeZone, occurrence });
const iso = (result: ReturnType<typeof toScheduledAt>) => (result.ok ? result.date.toISOString() : result);

describe("what the user types becomes the right UTC instant", () => {
  it("reads 15.10.2026 10:30 in Europe/Madrid as 08:30 UTC (summer time, UTC+2)", () => {
    expect(iso(at("Europe/Madrid", "2026-10-15", "10:30"))).toBe("2026-10-15T08:30:00.000Z");
  });

  it("reads the same wall-clock time in winter as 09:30 UTC (UTC+1)", () => {
    expect(iso(at("Europe/Madrid", "2026-01-15", "10:30"))).toBe("2026-01-15T09:30:00.000Z");
  });

  it.each([
    ["Europe/Madrid", "2026-10-15T08:30:00.000Z"],
    ["Europe/Kyiv", "2026-10-15T07:30:00.000Z"],
    ["America/New_York", "2026-10-15T14:30:00.000Z"],
    ["America/Los_Angeles", "2026-10-15T17:30:00.000Z"],
    ["Asia/Tokyo", "2026-10-15T01:30:00.000Z"],
    ["Asia/Kolkata", "2026-10-15T05:00:00.000Z"], // UTC+05:30
    ["Asia/Kathmandu", "2026-10-15T04:45:00.000Z"], // UTC+05:45
    ["Pacific/Auckland", "2026-10-14T21:30:00.000Z"], // UTC+13: the previous UTC day
    ["Pacific/Pago_Pago", "2026-10-15T21:30:00.000Z"], // UTC-11: the same day, late
    ["UTC", "2026-10-15T10:30:00.000Z"],
  ])("puts 10:30 on 15 Oct 2026 in %s at %s", (timeZone, expected) => {
    expect(iso(at(timeZone, "2026-10-15", "10:30"))).toBe(expected);
  });

  it("gives every zone the same instant when the wall clocks differ accordingly", () => {
    const madrid = at("Europe/Madrid", "2026-10-15", "10:30");
    const newYork = at("America/New_York", "2026-10-15", "04:30");
    const tokyo = at("Asia/Tokyo", "2026-10-15", "17:30");
    expect(iso(madrid)).toBe(iso(newYork));
    expect(iso(madrid)).toBe(iso(tokyo));
  });

  it("follows the browser's zone when none is given", () => {
    process.env.TZ = "Asia/Tokyo";
    expect(iso(toScheduledAt("2026-10-15", "10:30", NOW))).toBe("2026-10-15T01:30:00.000Z");
    process.env.TZ = "America/New_York";
    expect(iso(toScheduledAt("2026-10-15", "10:30", NOW))).toBe("2026-10-15T14:30:00.000Z");
  });

  it("does not shift the time by the offset twice on the way to the server and back", () => {
    const chosen = at("Europe/Madrid", "2026-10-15", "10:30");
    expect(chosen.ok).toBe(true);
    if (!chosen.ok) return;

    const wire = chosen.date.toISOString(); // what the client sends
    const stored = parseScheduledAt(wire, NOW); // what the server keeps
    expect(stored.ok && stored.date.toISOString()).toBe("2026-10-15T08:30:00.000Z");

    // Shown back in Madrid it is 10:30 again, not 12:30 and not 08:30.
    expect(formatScheduledTime(wire, { locale: "en-GB", timeZone: "Europe/Madrid" })).toContain("10:30");
    // Shown in UTC it is the stored 08:30.
    expect(formatScheduledTime(wire, { locale: "en-GB", timeZone: "UTC" })).toContain("08:30");
  });
});

describe("what is stored is displayed in the viewer's own zone", () => {
  const stored = "2026-10-15T08:30:00.000Z";
  const show = (timeZone: string, locale = "en-GB") => formatScheduledTime(stored, { locale, timeZone });

  it.each([
    ["Europe/Madrid", "10:30"],
    ["Europe/Kyiv", "11:30"],
    ["America/New_York", "04:30"],
    ["Asia/Tokyo", "17:30"],
    ["Asia/Kolkata", "14:00"],
    ["Pacific/Auckland", "21:30"],
    ["UTC", "08:30"],
  ])("shows the instant in %s as %s", (timeZone, wallClock) => {
    expect(show(timeZone)).toContain(wallClock);
  });

  it("names the zone next to the time, so 10:30 is never ambiguous", () => {
    expect(show("Europe/Madrid")).toMatch(/GMT\+2|CEST/);
    expect(show("America/New_York")).toMatch(/GMT-4|EDT/);
    expect(show("UTC")).toMatch(/UTC|GMT/);
  });

  it("follows the viewer's locale for the order and the wording", () => {
    expect(show("Europe/Madrid", "en-US")).toMatch(/Oct 15, 2026/);
    expect(show("Europe/Madrid", "en-GB")).toMatch(/15 Oct 2026/);
    expect(show("Europe/Madrid", "de-DE")).toMatch(/15\. Okt\.? 2026/);
    expect(show("Europe/Madrid", "uk-UA")).toContain("15");
  });

  it("uses the browser's zone when none is given, and the same code path as the input", () => {
    process.env.TZ = "Asia/Tokyo";
    expect(formatScheduledTime(stored, { locale: "en-GB" })).toContain("17:30");
    process.env.TZ = "Europe/Madrid";
    expect(formatScheduledTime(stored, { locale: "en-GB" })).toContain("10:30");
  });

  it("shows nothing for a missing or unreadable value, rather than 'Invalid Date'", () => {
    expect(formatScheduledTime(null)).toBeNull();
    expect(formatScheduledTime(undefined)).toBeNull();
    expect(formatScheduledTime("")).toBeNull();
    expect(formatScheduledTime("not a date")).toBeNull();
  });

  it("accepts a Date as well as the ISO string an API returns", () => {
    expect(formatScheduledTime(new Date(stored), { locale: "en-GB", timeZone: "UTC" })).toContain("08:30");
  });
});

describe("daylight saving time: the day clocks go forward", () => {
  it("rejects a time that does not exist in Europe/Madrid (02:30 on 29 Mar 2026)", () => {
    // Clocks jump from 02:00 to 03:00.
    const result = at("Europe/Madrid", "2026-03-29", "02:30");
    expect(result).toMatchObject({ ok: false, code: "SCHEDULE_NONEXISTENT", field: "time" });
    expect(!result.ok && result.error).toMatch(/does not exist/i);
  });

  it("accepts the minute before and the minute after the gap", () => {
    expect(iso(at("Europe/Madrid", "2026-03-29", "01:59"))).toBe("2026-03-29T00:59:00.000Z"); // CET
    expect(iso(at("Europe/Madrid", "2026-03-29", "03:00"))).toBe("2026-03-29T01:00:00.000Z"); // CEST
  });

  it("rejects the gap in America/New_York too (02:30 on 8 Mar 2026)", () => {
    expect(at("America/New_York", "2026-03-08", "02:30")).toMatchObject({ ok: false, code: "SCHEDULE_NONEXISTENT" });
    expect(iso(at("America/New_York", "2026-03-08", "03:00"))).toBe("2026-03-08T07:00:00.000Z");
  });

  it("rejects the gap in the southern hemisphere, where it falls in spring (Sydney, 4 Oct 2026)", () => {
    expect(at("Australia/Sydney", "2026-10-04", "02:30")).toMatchObject({ ok: false, code: "SCHEDULE_NONEXISTENT" });
  });

  it("handles a gap of only half an hour (Lord Howe, 4 Oct 2026, 02:00 -> 02:30)", () => {
    expect(at("Australia/Lord_Howe", "2026-10-04", "02:15")).toMatchObject({ ok: false, code: "SCHEDULE_NONEXISTENT" });
    expect(at("Australia/Lord_Howe", "2026-10-04", "02:30").ok).toBe(true);
  });

  it("displays instants either side of the change with the right local time", () => {
    const show = (value: string) => formatScheduledTime(value, { locale: "en-GB", timeZone: "Europe/Madrid" });
    expect(show("2026-03-29T00:59:00.000Z")).toContain("01:59");
    expect(show("2026-03-29T01:00:00.000Z")).toContain("03:00");
  });
});

describe("daylight saving time: the day clocks go back", () => {
  it("does not silently pick one of the two 02:30s in Europe/Madrid on 25 Oct 2026", () => {
    const result = at("Europe/Madrid", "2026-10-25", "02:30");

    expect(result).toMatchObject({ ok: false, code: "SCHEDULE_AMBIGUOUS", field: "time" });
    if (result.ok) return;
    expect(result.error).toMatch(/twice/i);
    expect(result.choices?.map((c) => [c.occurrence, c.date.toISOString()])).toEqual([
      ["first", "2026-10-25T00:30:00.000Z"], // still summer time, UTC+2
      ["second", "2026-10-25T01:30:00.000Z"], // back on winter time, UTC+1
    ]);
  });

  it("uses the occurrence the user picked", () => {
    expect(iso(at("Europe/Madrid", "2026-10-25", "02:30", "first"))).toBe("2026-10-25T00:30:00.000Z");
    expect(iso(at("Europe/Madrid", "2026-10-25", "02:30", "second"))).toBe("2026-10-25T01:30:00.000Z");
  });

  it("does not ask when the time is not repeated, and ignores a stale choice", () => {
    expect(iso(at("Europe/Madrid", "2026-10-25", "01:59"))).toBe("2026-10-24T23:59:00.000Z");
    expect(iso(at("Europe/Madrid", "2026-10-25", "03:00"))).toBe("2026-10-25T02:00:00.000Z");
    expect(iso(at("Europe/Madrid", "2026-10-25", "03:00", "second"))).toBe("2026-10-25T02:00:00.000Z");
  });

  it("asks in America/New_York (1 Nov 2026, 01:30) and the southern hemisphere (Sydney, 5 Apr 2026, 02:30)", () => {
    const newYork = at("America/New_York", "2026-11-01", "01:30");
    expect(newYork).toMatchObject({ ok: false, code: "SCHEDULE_AMBIGUOUS" });
    expect(iso(at("America/New_York", "2026-11-01", "01:30", "first"))).toBe("2026-11-01T05:30:00.000Z");
    expect(iso(at("America/New_York", "2026-11-01", "01:30", "second"))).toBe("2026-11-01T06:30:00.000Z");

    const sydney = at("Australia/Sydney", "2026-04-05", "02:30");
    expect(sydney).toMatchObject({ ok: false, code: "SCHEDULE_AMBIGUOUS" });
    expect(iso(at("Australia/Sydney", "2026-04-05", "02:30", "first"))).toBe("2026-04-04T15:30:00.000Z");
    expect(iso(at("Australia/Sydney", "2026-04-05", "02:30", "second"))).toBe("2026-04-04T16:30:00.000Z");
  });

  it("copes with a repeat of half an hour (Lord Howe, 5 Apr 2026, 01:45)", () => {
    const result = at("Australia/Lord_Howe", "2026-04-05", "01:45");
    expect(result).toMatchObject({ ok: false, code: "SCHEDULE_AMBIGUOUS" });
    if (result.ok) return;
    const [first, second] = result.choices ?? [];
    expect(second.date.getTime() - first.date.getTime()).toBe(30 * 60 * 1000);
  });

  it("never asks in a zone without daylight saving time", () => {
    for (const time of ["00:30", "02:30", "03:30"]) {
      expect(at("Asia/Kolkata", "2026-10-25", time).ok).toBe(true);
      expect(at("Asia/Tokyo", "2026-10-25", time).ok).toBe(true);
    }
  });

  it("displays the two repeated hours as the same wall clock in different offsets", () => {
    const show = (value: string) => formatScheduledTime(value, { locale: "en-GB", timeZone: "Europe/Madrid" });
    expect(show("2026-10-25T00:30:00.000Z")).toMatch(/02:30.*(GMT\+2|CEST)/);
    expect(show("2026-10-25T01:30:00.000Z")).toMatch(/02:30.*(GMT\+1|CET)/);
  });

  it("checks the future-ness of the instant the user chose, not of the wall clock", () => {
    // 02:30 on the 25th, chosen as the *second* occurrence (01:30Z), is still ahead
    // of 00:45Z but the first occurrence (00:30Z) is already behind.
    const now = new Date("2026-10-25T00:45:00.000Z");
    const first = toScheduledAt("2026-10-25", "02:30", now, { timeZone: "Europe/Madrid", occurrence: "first" });
    const second = toScheduledAt("2026-10-25", "02:30", now, { timeZone: "Europe/Madrid", occurrence: "second" });
    expect(first).toMatchObject({ ok: false, code: "SCHEDULE_PAST" });
    expect(second.ok).toBe(true);
  });

  it("does not bother asking when every reading of the time is already in the past", () => {
    const now = new Date("2026-10-25T05:00:00.000Z");
    expect(toScheduledAt("2026-10-25", "02:30", now, { timeZone: "Europe/Madrid" }))
      .toMatchObject({ ok: false, code: "SCHEDULE_PAST" });
  });
});

describe("'today' and the minimum time follow the chosen zone, not the machine's", () => {
  // 22:30 UTC on the 14th is already the 15th in Madrid (UTC+2), and still the 14th in New York.
  const now = new Date("2026-10-14T22:30:00.000Z");

  it("names the local calendar date in the given zone", () => {
    expect(formatLocalDate(now, "Europe/Madrid")).toBe("2026-10-15");
    expect(formatLocalDate(now, "America/New_York")).toBe("2026-10-14");
    expect(formatLocalDate(now, "Pacific/Auckland")).toBe("2026-10-15");
  });

  it("offers the next minute as the floor for today's time, in that zone", () => {
    expect(minimumTimeFor("2026-10-15", now, "Europe/Madrid")).toBe("00:31");
    expect(minimumTimeFor("2026-10-14", now, "America/New_York")).toBe("18:31");
    expect(minimumTimeFor("2026-10-15", now, "America/New_York")).toBeUndefined();
  });

  it("blames the date, not the time, when the chosen day has gone in that zone", () => {
    // It is the 15th in Madrid: choosing the 14th is a date mistake there…
    expect(toScheduledAt("2026-10-14", "23:59", now, { timeZone: "Europe/Madrid" }))
      .toMatchObject({ ok: false, code: "SCHEDULE_PAST", field: "date" });
    // …but only a time mistake in New York, where it is still the 14th.
    expect(toScheduledAt("2026-10-14", "12:00", now, { timeZone: "America/New_York" }))
      .toMatchObject({ ok: false, code: "SCHEDULE_PAST", field: "time" });
  });

  it("handles the day of a DST change: 'the next minute' is still a real minute", () => {
    const beforeGap = new Date("2026-03-29T00:59:30.000Z"); // 01:59:30 CET
    expect(minimumTimeFor("2026-03-29", beforeGap, "Europe/Madrid")).toBe("03:00");
  });
});

describe("describeLocalTimeZone", () => {
  it("names the zone with the offset in force at that instant", () => {
    expect(describeLocalTimeZone(new Date("2026-10-15T08:30:00.000Z"), "Europe/Madrid")).toBe("Europe/Madrid (UTC+02:00)");
    expect(describeLocalTimeZone(new Date("2026-01-15T09:30:00.000Z"), "Europe/Madrid")).toBe("Europe/Madrid (UTC+01:00)");
    expect(describeLocalTimeZone(new Date("2026-10-15T14:30:00.000Z"), "America/New_York")).toBe("America/New_York (UTC-04:00)");
    expect(describeLocalTimeZone(new Date("2026-10-15T05:00:00.000Z"), "Asia/Kolkata")).toBe("Asia/Kolkata (UTC+05:30)");
  });

  it("defaults to the browser's zone, which is what getUserTimeZone reports", () => {
    process.env.TZ = "Asia/Tokyo";
    expect(getUserTimeZone()).toBe("Asia/Tokyo");
    expect(describeLocalTimeZone(new Date("2026-10-15T01:30:00.000Z"))).toBe("Asia/Tokyo (UTC+09:00)");
  });
});

describe("the server never uses its own time zone to read a schedule", () => {
  it.each(["Pacific/Kiritimati", "Pacific/Pago_Pago", "America/New_York", "UTC"])(
    "reads the same instant when the server runs in %s",
    (serverZone) => {
      process.env.TZ = serverZone;
      const parsed = parseScheduledAt("2026-10-15T10:30:00+02:00", NOW);
      expect(parsed.ok && parsed.date.toISOString()).toBe("2026-10-15T08:30:00.000Z");
    },
  );

  it("refuses a value with no offset rather than reading it in the server's zone", () => {
    process.env.TZ = "Pacific/Kiritimati";
    expect(parseScheduledAt("2026-10-15T10:30:00", NOW)).toMatchObject({ ok: false, code: "SCHEDULE_FORMAT" });
  });
});
