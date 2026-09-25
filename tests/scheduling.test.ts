import { afterEach, describe, expect, it } from "vitest";
import {
  describeLocalTimeZone, formatLocalDate, minimumTimeFor, parseScheduledAt, toScheduledAt,
} from "@/lib/scheduling";

const originalTz = process.env.TZ;
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

const NOW = new Date("2026-10-01T12:00:00.000Z");

describe("parseScheduledAt (server-side validation)", () => {
  it("accepts a future UTC instant and returns it as a Date", () => {
    const result = parseScheduledAt("2026-10-15T07:30:00Z", NOW);
    expect(result).toEqual({ ok: true, date: new Date("2026-10-15T07:30:00.000Z") });
  });

  it("normalises an offset to the same UTC instant", () => {
    const result = parseScheduledAt("2026-10-15T10:30:00+03:00", NOW);
    expect(result.ok && result.date.toISOString()).toBe("2026-10-15T07:30:00.000Z");
  });

  it("accepts milliseconds, as produced by Date#toISOString", () => {
    expect(parseScheduledAt("2026-10-15T07:30:00.000Z", NOW).ok).toBe(true);
  });

  it.each([undefined, null, "", 12345, {}, []])("rejects a missing or non-string value: %j", (value) => {
    const result = parseScheduledAt(value, NOW);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.code).toBe("SCHEDULE_REQUIRED");
  });

  it("rejects a date-time without a time zone, because the server cannot guess it", () => {
    const result = parseScheduledAt("2026-10-15T10:30", NOW);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/time zone/i);
    expect(!result.ok && result.code).toBe("SCHEDULE_FORMAT");
  });

  it("rejects a date with no time part", () => {
    expect(parseScheduledAt("2026-10-15", NOW).ok).toBe(false);
  });

  it.each([
    "2099-02-31T10:00:00Z",
    "2099-04-31T10:00:00Z",
    "2099-02-29T10:00:00Z", // 2099 is not a leap year
    "2099-13-01T10:00:00Z",
    "2099-10-15T24:00:00Z",
    "2099-10-15T10:60:00Z",
    "2099-10-15T10:30:60Z",
  ])("rejects %s instead of letting Date roll it into a different day", (value) => {
    // Far in the future on purpose: a rolled-over date must be caught as
    // invalid, not incidentally rejected as "in the past".
    const result = parseScheduledAt(value, NOW);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/valid date/i);
    expect(!result.ok && result.code).toBe("SCHEDULE_INVALID");
  });

  it("accepts a real leap day", () => {
    expect(parseScheduledAt("2096-02-29T10:00:00Z", NOW).ok).toBe(true);
  });

  it("rejects a moment in the past", () => {
    const result = parseScheduledAt("2026-09-30T10:00:00Z", NOW);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/future/i);
    expect(!result.ok && result.code).toBe("SCHEDULE_PAST");
  });

  it("rejects exactly now: the moment must be strictly in the future", () => {
    const result = parseScheduledAt(NOW.toISOString(), NOW);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.code).toBe("SCHEDULE_PAST");
  });

  it("rejects the user's example: 12:00 when it is already 14:00 on the same day", () => {
    const twoPm = new Date("2026-10-10T14:00:00Z");
    expect(parseScheduledAt("2026-10-10T12:00:00Z", twoPm).ok).toBe(false);
    expect(parseScheduledAt("2026-10-10T14:00:00Z", twoPm).ok).toBe(false);
    expect(parseScheduledAt("2026-10-10T14:00:01Z", twoPm).ok).toBe(true);
  });

  it("compares instants, so the same moment written in any offset is judged alike", () => {
    const now = new Date("2026-10-10T14:00:00Z");
    // 17:00+03:00 and 09:00-05:00 are both exactly 14:00Z: not in the future.
    expect(parseScheduledAt("2026-10-10T17:00:00+03:00", now).ok).toBe(false);
    expect(parseScheduledAt("2026-10-10T09:00:00-05:00", now).ok).toBe(false);
    expect(parseScheduledAt("2026-10-10T17:00:01+03:00", now).ok).toBe(true);
  });

  it("handles the step across midnight", () => {
    const now = new Date("2026-10-10T23:59:30Z");
    expect(parseScheduledAt("2026-10-10T23:59:59Z", now).ok).toBe(true);
    expect(parseScheduledAt("2026-10-11T00:00:00Z", now).ok).toBe(true);
    expect(parseScheduledAt("2026-10-10T23:59:00Z", now).ok).toBe(false);
  });

  it("accepts one millisecond after now", () => {
    expect(parseScheduledAt(new Date(NOW.getTime() + 1).toISOString(), NOW).ok).toBe(true);
  });
});

describe("toScheduledAt (client-side date + time)", () => {
  it("requires both a date and a time, and says which one is missing", () => {
    const both = toScheduledAt("", "", NOW);
    expect(both).toMatchObject({ ok: false, code: "SCHEDULE_REQUIRED", field: "both" });
    expect(!both.ok && both.error).toMatch(/date and a time/i);

    const noTime = toScheduledAt("2026-10-15", "", NOW);
    expect(noTime).toMatchObject({ ok: false, code: "SCHEDULE_REQUIRED", field: "time" });
    expect(!noTime.ok && noTime.error).toMatch(/choose a time/i);

    const noDate = toScheduledAt("", "10:30", NOW);
    expect(noDate).toMatchObject({ ok: false, code: "SCHEDULE_REQUIRED", field: "date" });
    expect(!noDate.ok && noDate.error).toMatch(/choose a date/i);
  });

  it("rejects a malformed date or time instead of guessing", () => {
    expect(toScheduledAt("15.10.2026", "10:30", NOW).ok).toBe(false);
    expect(toScheduledAt("2026-10-15", "10h30", NOW).ok).toBe(false);
  });

  it("converts the user's wall-clock time to UTC using their own time zone (UTC+3 in summer)", () => {
    process.env.TZ = "Europe/Kyiv";
    const result = toScheduledAt("2026-10-15", "10:30", NOW);
    expect(result.ok && result.date.toISOString()).toBe("2026-10-15T07:30:00.000Z");
  });

  it("uses the offset in force on the chosen date, not today's (UTC+2 in winter)", () => {
    process.env.TZ = "Europe/Kyiv";
    const result = toScheduledAt("2026-12-15", "10:30", NOW);
    expect(result.ok && result.date.toISOString()).toBe("2026-12-15T08:30:00.000Z");
  });

  it("handles a zone west of UTC", () => {
    process.env.TZ = "America/New_York";
    const result = toScheduledAt("2026-10-15", "10:30", NOW);
    expect(result.ok && result.date.toISOString()).toBe("2026-10-15T14:30:00.000Z");
  });

  it("rejects a wall-clock time skipped by the spring DST change", () => {
    process.env.TZ = "Europe/Kyiv";
    // 2026-03-29: clocks jump from 03:00 straight to 04:00.
    const result = toScheduledAt("2026-03-29", "03:30", new Date("2026-01-01T00:00:00Z"));
    expect(result).toMatchObject({ ok: false, code: "SCHEDULE_NONEXISTENT", field: "time" });
    expect(!result.ok && result.error).toMatch(/does not exist/i);
  });

  it("does not guess which of the two repeated autumn DST hours is meant, but lets the caller choose", () => {
    process.env.TZ = "Europe/Kyiv";
    // 2026-10-25: 03:30 happens twice (00:30Z and 01:30Z). See tests/timezones.test.ts
    // for the full set of cases; here it is enough that it neither throws nor drifts.
    const now = new Date("2026-10-01T00:00:00Z");
    const result = toScheduledAt("2026-10-25", "03:30", now);
    expect(result).toMatchObject({ ok: false, code: "SCHEDULE_AMBIGUOUS", field: "time" });

    const first = toScheduledAt("2026-10-25", "03:30", now, { occurrence: "first" });
    const second = toScheduledAt("2026-10-25", "03:30", now, { occurrence: "second" });
    expect(first.ok && first.date.toISOString()).toBe("2026-10-25T00:30:00.000Z");
    expect(second.ok && second.date.toISOString()).toBe("2026-10-25T01:30:00.000Z");
  });

  it("rejects a moment in the past and blames the date when the whole day has gone", () => {
    process.env.TZ = "Europe/Kyiv";
    const result = toScheduledAt("2026-09-30", "10:00", NOW);
    expect(result).toMatchObject({ ok: false, code: "SCHEDULE_PAST", field: "date" });
    expect(!result.ok && result.error).toMatch(/future/i);
  });

  it("blames the time when the date is today but the time has passed", () => {
    process.env.TZ = "Europe/Kyiv";
    const now = new Date("2026-10-10T11:00:00Z"); // 14:00 local (UTC+3)
    const result = toScheduledAt("2026-10-10", "12:00", now);
    expect(result).toMatchObject({ ok: false, code: "SCHEDULE_PAST", field: "time" });
  });

  it("rejects exactly now and accepts the next minute", () => {
    process.env.TZ = "Europe/Kyiv";
    const now = new Date("2026-10-10T11:00:00Z"); // 14:00:00 local
    expect(toScheduledAt("2026-10-10", "14:00", now)).toMatchObject({ ok: false, code: "SCHEDULE_PAST" });
    expect(toScheduledAt("2026-10-10", "14:01", now).ok).toBe(true);
  });

  it("uses the user's local midnight, not UTC's, to decide what is today", () => {
    process.env.TZ = "Europe/Kyiv";
    // 23:59:30 local on the 10th is 20:59:30Z: still the 10th locally.
    const now = new Date("2026-10-10T20:59:30Z");
    expect(toScheduledAt("2026-10-10", "23:59", now)).toMatchObject({ ok: false, code: "SCHEDULE_PAST" });
    const nextDay = toScheduledAt("2026-10-11", "00:00", now);
    expect(nextDay.ok && nextDay.date.toISOString()).toBe("2026-10-10T21:00:00.000Z");
  });

  it("stays in the future across the autumn change back to winter time", () => {
    process.env.TZ = "Europe/Kyiv";
    // 2026-10-25 03:59 local is 00:59Z; 04:00 local (winter, UTC+2) is 02:00Z.
    const now = new Date("2026-10-25T00:59:30Z");
    const later = toScheduledAt("2026-10-25", "04:00", now);
    expect(later.ok && later.date.toISOString()).toBe("2026-10-25T02:00:00.000Z");
  });

  it("agrees with the server rule: its own output always passes parseScheduledAt", () => {
    process.env.TZ = "Asia/Tokyo";
    const client = toScheduledAt("2026-10-15", "10:30", NOW);
    expect(client.ok).toBe(true);
    if (client.ok) expect(parseScheduledAt(client.date.toISOString(), NOW).ok).toBe(true);
  });
});

describe("describeLocalTimeZone", () => {
  it("names the zone and its UTC offset on the given date", () => {
    process.env.TZ = "Europe/Kyiv";
    // ICU builds differ on the spelling of the canonical name (Kyiv vs Kiev).
    expect(describeLocalTimeZone(new Date("2026-10-15T07:30:00Z"))).toMatch(/^Europe\/Ki[ye]v \(UTC\+03:00\)$/);
    expect(describeLocalTimeZone(new Date("2026-12-15T08:30:00Z"))).toMatch(/^Europe\/Ki[ye]v \(UTC\+02:00\)$/);
  });

  it("formats negative and zero offsets", () => {
    process.env.TZ = "America/New_York";
    expect(describeLocalTimeZone(new Date("2026-10-15T14:30:00Z"))).toBe("America/New_York (UTC-04:00)");
    process.env.TZ = "UTC";
    expect(describeLocalTimeZone(new Date("2026-10-15T14:30:00Z"))).toMatch(/\(UTC\+00:00\)$/);
  });

  it("formats a half-hour offset", () => {
    process.env.TZ = "Asia/Kolkata";
    expect(describeLocalTimeZone(new Date("2026-10-15T14:30:00Z"))).toMatch(/\(UTC\+05:30\)$/);
  });
});

describe("formatLocalDate", () => {
  it("gives the user's local calendar date, for a date input's min attribute", () => {
    process.env.TZ = "Europe/Kyiv";
    // 23:30Z on the 14th is already the 15th in Kyiv (UTC+3).
    expect(formatLocalDate(new Date("2026-10-14T23:30:00Z"))).toBe("2026-10-15");
    process.env.TZ = "America/New_York";
    expect(formatLocalDate(new Date("2026-10-15T02:30:00Z"))).toBe("2026-10-14");
  });
});

describe("minimumTimeFor", () => {
  it("offers the next minute as the earliest time when the date is today", () => {
    process.env.TZ = "Europe/Kyiv";
    const now = new Date("2026-10-10T11:00:20Z"); // 14:00:20 local
    expect(minimumTimeFor("2026-10-10", now)).toBe("14:01");
  });

  it("puts no floor on a later date, or on an empty one", () => {
    process.env.TZ = "Europe/Kyiv";
    const now = new Date("2026-10-10T11:00:20Z");
    expect(minimumTimeFor("2026-10-11", now)).toBeUndefined();
    expect(minimumTimeFor("", now)).toBeUndefined();
  });

  it("offers no time today when the next minute already belongs to tomorrow", () => {
    process.env.TZ = "Europe/Kyiv";
    const now = new Date("2026-10-10T20:59:30Z"); // 23:59:30 local
    expect(minimumTimeFor("2026-10-10", now)).toBeUndefined();
  });
});
