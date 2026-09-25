/**
 * Validation, conversion and display of scheduled sends.
 *
 * Pure and dependency-free so the browser (to give instant feedback) and the API
 * route (the authoritative check) run the very same rules. The stored value is
 * always a UTC instant; a time zone matters only at the two edges — while the
 * user types a wall-clock time, and while a stored instant is shown back — and
 * both edges live in this file so they cannot disagree.
 *
 * Which zone is "the user's"? The app stores no per-user zone, so it is the
 * browser's own (`getUserTimeZone`). Every function below takes it as an
 * optional argument, defaulting to that; the server never supplies its own.
 */

export type ScheduleErrorCode =
  | "SCHEDULE_REQUIRED"
  | "SCHEDULE_FORMAT"
  | "SCHEDULE_INVALID"
  | "SCHEDULE_NONEXISTENT"
  /** Client only: the wall-clock time occurs twice (clocks go back) and the user must pick one. */
  | "SCHEDULE_AMBIGUOUS"
  | "SCHEDULE_PAST";

/** Which form control an error belongs next to. Only the client knows about fields. */
export type ScheduleField = "date" | "time" | "both";

/** Which of the two repeated wall-clock times, when the clocks go back: before the change, or after it. */
export type Occurrence = "first" | "second";

export type ScheduleChoice = { occurrence: Occurrence; date: Date };

export type ScheduleResult =
  | { ok: true; date: Date }
  | {
      ok: false;
      error: string;
      code: ScheduleErrorCode;
      field?: ScheduleField;
      /** Present for SCHEDULE_AMBIGUOUS: the instants the user has to choose between. */
      choices?: ScheduleChoice[];
    };

const PAST_MESSAGE = "The scheduled time must be in the future.";
const REQUIRED_MESSAGE = "Choose both a date and a time for the scheduled send.";

// A designator (Z or ±hh:mm) is mandatory: without one, Date.parse would read the
// string in the *server's* time zone and silently shift the send time.
const ISO_WITH_ZONE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-](\d{2}):(\d{2}))$/;

/**
 * Server side: validates the instant a client asked for.
 *
 * `now` is the server's clock. The client's clock and time zone never enter into
 * it: the client sends an absolute instant, and it is compared with this one.
 * The moment must be strictly in the future — "right now" is already too late.
 */
export function parseScheduledAt(value: unknown, now: Date = new Date()): ScheduleResult {
  if (typeof value !== "string" || value.trim() === "") {
    return { ok: false, code: "SCHEDULE_REQUIRED", error: "scheduledAt is required to schedule a campaign." };
  }
  const parts = ISO_WITH_ZONE.exec(value);
  if (!parts) {
    return {
      ok: false,
      code: "SCHEDULE_FORMAT",
      error: "scheduledAt must be an ISO-8601 date and time with a time zone, e.g. 2026-10-15T07:30:00Z.",
    };
  }

  // `new Date("2099-02-31T10:00:00Z")` quietly becomes March 3rd, and `T24:00`
  // becomes midnight of the next day. Check the components ourselves so a typo
  // is rejected rather than turned into a different send time.
  const [year, month, day, hour, minute, second = 0, offsetHour = 0, offsetMinute = 0] =
    parts.slice(1).map((part) => (part === undefined ? undefined : Number(part))) as number[];
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const componentsValid =
    month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth &&
    hour <= 23 && minute <= 59 && second <= 59 && offsetHour <= 23 && offsetMinute <= 59;

  const date = new Date(value);
  if (!componentsValid || Number.isNaN(date.getTime())) {
    return { ok: false, code: "SCHEDULE_INVALID", error: "scheduledAt is not a valid date and time." };
  }
  if (date.getTime() <= now.getTime()) return { ok: false, code: "SCHEDULE_PAST", error: PAST_MESSAGE };
  return { ok: true, date };
}

/* ------------------------------------------------------------ time zones */

/**
 * The user's IANA time zone, e.g. `Europe/Madrid`, as the browser reports it.
 * Chosen over a stored preference because the app has no user setting for it;
 * a person travelling, or a laptop whose zone changes, is followed automatically.
 */
export function getUserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const wallClockFormats = new Map<string, Intl.DateTimeFormat>();

type WallClock = { year: number; month: number; day: number; hour: number; minute: number; second: number };

/** What a clock on the wall of `timeZone` reads at the instant `at`. */
function wallClockAt(at: Date, timeZone: string): WallClock {
  let format = wallClockFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23",
      year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
    });
    wallClockFormats.set(timeZone, format);
  }
  const parts = format.formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: read("year"), month: read("month"), day: read("day"),
    hour: read("hour") % 24, minute: read("minute"), second: read("second"),
  };
}

/** Minutes `timeZone` is ahead of UTC at the instant `at` (DST-aware, so it changes through the year). */
function zoneOffsetMinutes(at: Date, timeZone: string): number {
  const wall = wallClockAt(at, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  const wholeSeconds = Math.floor(at.getTime() / 1000) * 1000;
  return Math.round((asUtc - wholeSeconds) / 60_000);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Every instant at which a clock in `timeZone` reads exactly this wall-clock
 * time, earliest first:
 *
 *   none  the time was skipped (clocks went forward over it)
 *   one   the ordinary case
 *   two   the time was repeated (clocks went back over it)
 *
 * It tries the two UTC offsets in force either side of the date and keeps the
 * ones that really are in force at the instant they produce. That works for any
 * IANA zone and any size of change, without assuming it is an hour.
 */
function instantsReading(
  year: number, month: number, day: number, hour: number, minute: number, timeZone: string,
): Date[] {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const offsets = new Set([
    zoneOffsetMinutes(new Date(wallAsUtc - DAY_MS), timeZone),
    zoneOffsetMinutes(new Date(wallAsUtc + DAY_MS), timeZone),
  ]);
  const instants = new Map<number, Date>();
  for (const offset of offsets) {
    const candidate = wallAsUtc - offset * 60_000;
    if (zoneOffsetMinutes(new Date(candidate), timeZone) === offset) instants.set(candidate, new Date(candidate));
  }
  return [...instants.values()].sort((a, b) => a.getTime() - b.getTime());
}

export type WallClockResult =
  /** One or two instants (two when clocks going back repeat the time), earliest first. */
  | { ok: true; candidates: Date[] }
  | { ok: false; error: string; code: ScheduleErrorCode; field: ScheduleField };

/**
 * Reads a wall-clock date (`YYYY-MM-DD`) and time (`HH:mm`) in `timeZone` and says which
 * instants it can mean. It knows nothing about "now", so it serves both a send time,
 * which must be ahead, and the test clock, which may be set to any moment.
 *
 * Two days a year are awkward, and neither is guessed at here:
 *  - clocks go forward: some times do not exist  -> SCHEDULE_NONEXISTENT
 *  - clocks go back: some times happen twice     -> two candidates; the caller decides
 */
export function resolveWallClock(
  date: string,
  time: string,
  timeZone: string = getUserTimeZone(),
): WallClockResult {
  const dateParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeParts = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateParts && !timeParts) {
    return { ok: false, code: "SCHEDULE_REQUIRED", field: "both", error: REQUIRED_MESSAGE };
  }
  if (!dateParts) {
    return { ok: false, code: "SCHEDULE_REQUIRED", field: "date", error: "Choose a date for the scheduled send." };
  }
  if (!timeParts) {
    return { ok: false, code: "SCHEDULE_REQUIRED", field: "time", error: "Choose a time for the scheduled send." };
  }

  const [year, month, day] = dateParts.slice(1).map(Number);
  const [hour, minute] = timeParts.slice(1).map(Number);

  // Feb 31st or 25:00 are typos, not something a time zone can explain.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) {
    return { ok: false, code: "SCHEDULE_INVALID", field: "date", error: "That date does not exist. Choose a real date." };
  }
  if (hour > 23 || minute > 59) {
    return {
      ok: false, code: "SCHEDULE_INVALID", field: "time",
      error: "That time is not valid. Choose a time between 00:00 and 23:59.",
    };
  }

  const candidates = instantsReading(year, month, day, hour, minute, timeZone);
  if (candidates.length === 0) {
    return {
      ok: false,
      code: "SCHEDULE_NONEXISTENT",
      field: "time",
      error:
        "That date and time does not exist in your time zone (for example, it is skipped by a daylight saving change). Choose another time.",
    };
  }
  return { ok: true, candidates };
}

/**
 * Client side: turns the wall-clock date (`YYYY-MM-DD`) and time (`HH:mm`) the
 * user typed into the UTC instant they mean, interpreting them in `timeZone`
 * (the browser's, unless told otherwise). Failures say which field to put the
 * message next to.
 *
 * Two days a year are awkward, and neither is guessed at:
 *  - clocks go forward: some times do not exist  -> SCHEDULE_NONEXISTENT
 *  - clocks go back: some times happen twice     -> SCHEDULE_AMBIGUOUS, with both
 *    instants in `choices`; the caller asks the user and passes `occurrence`.
 */
export function toScheduledAt(
  date: string,
  time: string,
  now: Date = new Date(),
  options: { timeZone?: string; occurrence?: Occurrence } = {},
): ScheduleResult {
  const timeZone = options.timeZone ?? getUserTimeZone();
  const wall = resolveWallClock(date, time, timeZone);
  if (!wall.ok) return wall;
  const { candidates } = wall;

  // A whole day already gone is the date's fault; a time earlier today is the time's.
  const pastField = (): ScheduleField => (date < formatLocalDate(now, timeZone) ? "date" : "time");

  let chosen = candidates[0];
  if (candidates.length > 1) {
    // Nothing to ask if every reading of the time has already gone by.
    if (candidates.every((candidate) => candidate.getTime() <= now.getTime())) {
      return { ok: false, code: "SCHEDULE_PAST", field: pastField(), error: PAST_MESSAGE };
    }
    const choices: ScheduleChoice[] = candidates.map((candidate, index) => ({
      occurrence: index === 0 ? "first" : "second", date: candidate,
    }));
    const picked = choices.find((choice) => choice.occurrence === options.occurrence);
    if (!picked) {
      return {
        ok: false,
        code: "SCHEDULE_AMBIGUOUS",
        field: "time",
        error: "That time happens twice on this date because the clocks go back. Choose which one you mean.",
        choices,
      };
    }
    chosen = picked.date;
  }

  if (chosen.getTime() <= now.getTime()) {
    return { ok: false, code: "SCHEDULE_PAST", field: pastField(), error: PAST_MESSAGE };
  }
  return { ok: true, date: chosen };
}

/** The calendar date in `timeZone` as `YYYY-MM-DD`, the format `<input type="date">` uses. */
export function formatLocalDate(at: Date = new Date(), timeZone: string = getUserTimeZone()): string {
  const { year, month, day } = wallClockAt(at, timeZone);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The time of day in `timeZone` as `HH:mm`, the format `<input type="time">` uses. */
export function formatLocalTime(at: Date = new Date(), timeZone: string = getUserTimeZone()): string {
  const { hour, minute } = wallClockAt(at, timeZone);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * The `min` for `<input type="time">`: on today's date, the next full minute.
 * Later dates have no floor, and neither does today once the next minute has
 * already rolled over into tomorrow. This only steers the picker; `toScheduledAt`
 * is what actually enforces the rule.
 */
export function minimumTimeFor(
  date: string, now: Date = new Date(), timeZone: string = getUserTimeZone(),
): string | undefined {
  const nextMinute = new Date(now.getTime() + 60_000);
  if (date === "" || date !== formatLocalDate(now, timeZone) || formatLocalDate(nextMinute, timeZone) !== date) {
    return undefined;
  }
  return formatLocalTime(nextMinute, timeZone);
}

/**
 * The inverse of `toScheduledAt`: the date and time to put in the form's fields so
 * that they read as the stored instant `at`, on the wall of `timeZone`. Used to open
 * the "change time" form on the time the campaign has now.
 *
 * When clocks go back, one wall-clock time is two instants. Then `occurrence` says
 * which of them `at` is, so that reading the fields back (`toScheduledAt(date, time,
 * now, { occurrence })`) gives `at` again instead of asking the person to choose
 * a time they already chose. Times are taken to the minute, as the form does.
 */
export function scheduleFieldsFor(
  at: Date, timeZone: string = getUserTimeZone(),
): { date: string; time: string; occurrence?: Occurrence } {
  const wall = wallClockAt(at, timeZone);
  const fields = { date: formatLocalDate(at, timeZone), time: formatLocalTime(at, timeZone) };

  const readings = instantsReading(wall.year, wall.month, wall.day, wall.hour, wall.minute, timeZone);
  if (readings.length < 2) return fields;
  const minute = Math.floor(at.getTime() / 60_000) * 60_000;
  return { ...fields, occurrence: readings[0].getTime() === minute ? "first" : "second" };
}

/** e.g. `Europe/Kyiv (UTC+03:00)`, using the offset in force at `at`. */
export function describeLocalTimeZone(at: Date = new Date(), timeZone: string = getUserTimeZone()): string {
  const offsetMinutes = zoneOffsetMinutes(at, timeZone);
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${timeZone} (UTC${sign}${hh}:${mm})`;
}

/**
 * A stored instant as the viewer should read it: their locale's wording, their
 * zone's wall clock, and the zone's short name beside the time (`10:30 CEST`),
 * because a bare "10:30" means different moments to different people.
 *
 * This is the one place scheduled times are formatted; the campaign list, the
 * report and the confirmation dialogs all go through it. `null` for a missing or
 * unreadable value, so callers can leave the line out instead of printing "—".
 */
export function formatScheduledTime(
  value: string | Date | null | undefined,
  options: { locale?: string | string[]; timeZone?: string } = {},
): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(options.locale, {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    timeZoneName: "short", timeZone: options.timeZone,
  }).format(date);
}
