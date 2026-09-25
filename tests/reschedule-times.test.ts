import { describe, expect, it } from "vitest";
import { describeLocalTimeZone, formatLocalDate, formatLocalTime, scheduleFieldsFor, toScheduledAt } from "@/lib/scheduling";

/**
 * Showing a stored instant back in the fields of the "change time" form, and reading
 * the fields again. The two must be exact inverses, in any zone and on the two days
 * a year when clocks change; otherwise saving a form without touching it would move
 * the send (an offset applied twice) or ask the person a question they did not expect.
 */
const LONG_AGO = new Date("2098-01-01T00:00:00.000Z"); // "now" for these tests: all of 2099 is ahead of it

describe("formatLocalTime", () => {
  const at = new Date("2026-10-15T08:30:00.000Z");

  it("gives the wall clock of the zone as HH:mm, the format a time input uses", () => {
    expect(formatLocalTime(at, "UTC")).toBe("08:30");
    expect(formatLocalTime(at, "Europe/Madrid")).toBe("10:30"); // summer time, UTC+2
    expect(formatLocalTime(at, "Asia/Tokyo")).toBe("17:30");
    expect(formatLocalTime(at, "America/New_York")).toBe("04:30");
    expect(formatLocalTime(at, "Asia/Kolkata")).toBe("14:00"); // UTC+5:30
    expect(formatLocalTime(at, "Asia/Kathmandu")).toBe("14:15"); // UTC+5:45
  });

  it("writes midnight as 00:00, never 24:00", () => {
    expect(formatLocalTime(new Date("2026-10-15T22:00:00.000Z"), "Europe/Madrid")).toBe("00:00");
    expect(formatLocalDate(new Date("2026-10-15T22:00:00.000Z"), "Europe/Madrid")).toBe("2026-10-16");
  });

  it("switches with daylight saving time", () => {
    expect(formatLocalTime(new Date("2026-01-15T08:30:00.000Z"), "Europe/Madrid")).toBe("09:30"); // winter, UTC+1
    expect(formatLocalTime(new Date("2026-07-15T08:30:00.000Z"), "Europe/Madrid")).toBe("10:30");
  });
});

describe("scheduleFieldsFor", () => {
  it("fills the date and time with the instant as it reads on the wall of the zone", () => {
    const at = new Date("2026-10-15T08:30:00.000Z");

    expect(scheduleFieldsFor(at, "Europe/Madrid")).toEqual({ date: "2026-10-15", time: "10:30" });
    expect(scheduleFieldsFor(at, "Pacific/Kiritimati")).toEqual({ date: "2026-10-15", time: "22:30" }); // UTC+14
    expect(scheduleFieldsFor(at, "Pacific/Pago_Pago")).toEqual({ date: "2026-10-14", time: "21:30" }); // UTC-11: yesterday
  });

  it("does not apply the offset twice: reading the fields back gives the very instant that was shown", () => {
    const at = new Date("2026-10-15T08:30:00.000Z");
    for (const timeZone of ["Europe/Madrid", "America/New_York", "Asia/Kolkata", "Pacific/Kiritimati", "UTC"]) {
      const fields = scheduleFieldsFor(at, timeZone);
      const back = toScheduledAt(fields.date, fields.time, new Date("2026-10-01T00:00:00Z"), { timeZone, occurrence: fields.occurrence });
      expect(back, timeZone).toEqual({ ok: true, date: at });
    }
  });

  it("marks which of two repeated times an instant is, so saving it again is not a question", () => {
    // Madrid: at 01:00 UTC on 25 Oct 2026 the clocks go from 03:00 back to 02:00, so 02:30 happens twice.
    const first = new Date("2026-10-25T00:30:00.000Z"); // 02:30 CEST
    const second = new Date("2026-10-25T01:30:00.000Z"); // 02:30 CET

    expect(scheduleFieldsFor(first, "Europe/Madrid")).toEqual({ date: "2026-10-25", time: "02:30", occurrence: "first" });
    expect(scheduleFieldsFor(second, "Europe/Madrid")).toEqual({ date: "2026-10-25", time: "02:30", occurrence: "second" });
  });

  it("leaves 'occurrence' out for a time that happens once", () => {
    expect(scheduleFieldsFor(new Date("2026-10-25T02:30:00.000Z"), "Europe/Madrid")).toEqual({ date: "2026-10-25", time: "03:30" });
    expect(scheduleFieldsFor(new Date("2026-10-15T08:30:00.000Z"), "Europe/Madrid")).not.toHaveProperty("occurrence");
  });

  it("is the exact inverse of reading the fields, for every quarter hour around every clock change of 2099", () => {
    const zones = [
      "Europe/Madrid", "Europe/Kyiv", "America/New_York", "Australia/Sydney",
      "Australia/Lord_Howe", // a 30-minute change
      "Asia/Kathmandu", "Pacific/Kiritimati",
    ];
    const HOUR = 3_600_000;
    let changes = 0;
    let repeated = 0;

    for (const timeZone of zones) {
      let previous = describeLocalTimeZone(new Date("2099-01-01T00:00:00Z"), timeZone);
      for (let t = Date.parse("2099-01-01T00:00:00Z"); t < Date.parse("2100-01-01T00:00:00Z"); t += HOUR) {
        const offset = describeLocalTimeZone(new Date(t), timeZone);
        if (offset === previous) continue;
        previous = offset;
        changes += 1;

        // Every quarter hour from 3 hours before the change to 3 hours after it.
        for (let probe = t - 3 * HOUR; probe <= t + 3 * HOUR; probe += 15 * 60_000) {
          const instant = new Date(probe);
          const fields = scheduleFieldsFor(instant, timeZone);
          if (fields.occurrence) repeated += 1;
          const back = toScheduledAt(fields.date, fields.time, LONG_AGO, { timeZone, occurrence: fields.occurrence });
          expect(back, `${timeZone} ${instant.toISOString()}`).toEqual({ ok: true, date: instant });
        }
      }
    }

    expect(changes).toBeGreaterThanOrEqual(2 * 5); // five of these zones have daylight saving, and each changes twice
    expect(repeated).toBeGreaterThan(0); // and the repeated hours really were met
  });
});
