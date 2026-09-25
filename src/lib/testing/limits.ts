/**
 * Every number the test tools accept, in one place.
 *
 * The panel's inputs, the server's validation and the text of the help all read
 * these values, so a range shown to a person can never differ from the one that is
 * enforced. Nothing else in the project repeats them.
 *
 * Pure and dependency-free: the browser and the server both import it.
 */

export type Range = { readonly min: number; readonly max: number };

export type IntegerLimit = Range & {
  /** What the field starts with. */
  readonly default: number;
  /** Suggested for an ordinary manual check. */
  readonly recommended?: Range;
};

export const TEST_LIMITS = {
  /** Seconds between two checks of the database for campaigns whose time has come. */
  schedulerInterval: {
    min: 1, max: 300, default: 5,
    recommended: { min: 2, max: 5 },
    /** For leaving the app running for a long time. */
    longRun: { min: 10, max: 30 },
  },
  /** Most emails the queue may start in one rate-limit window. */
  rateMaxEmails: { min: 1, max: 1000, default: 2, recommended: { min: 2, max: 10 } },
  /** Length of the rate-limit window, in seconds. */
  rateWindowSeconds: { min: 1, max: 3600, default: 10, recommended: { min: 1, max: 10 } },
  /** Test recipients in one campaign. Not a load test: the queue is built and sent in one process. */
  recipients: {
    min: 1, max: 500, default: 5,
    recommended: { min: 3, max: 10 },
    rateCheck: { min: 20, max: 50 },
    longRun: { min: 100, max: 500 },
  },
  /**
   * Seconds the test SMTP server waits before answering a `slow` recipient. Kept well under the
   * mail client's 30-second socket timeout, or a slow answer would read as a broken connection.
   */
  slowDelaySeconds: { min: 1, max: 20, default: 3, recommended: { min: 2, max: 5 } },
  /** Times the test SMTP server refuses a `tempfail` recipient before it accepts. */
  temporaryFailures: { min: 1, max: 5, default: 1, recommended: { min: 1, max: 2 } },
  /** Minutes an "overdue" test campaign is already late by when it is created. */
  overdueMinutes: { min: 1, max: 1440, default: 5, recommended: { min: 1, max: 10 } },
  campaignNameLength: { min: 1, max: 120 },
  /** Years the test clock may be set to; keeps a typo from sending the clock to the year 20260. */
  clockYear: { min: 2000, max: 2100 },
  /** Events kept for the journal (older ones are dropped) and shown at most at once. */
  eventLog: { keep: 300, show: 100 },
} as const;

export type LimitId =
  | "schedulerInterval" | "rateMaxEmails" | "rateWindowSeconds" | "recipients"
  | "slowDelaySeconds" | "temporaryFailures" | "overdueMinutes";

/** The steps "Advance" offers, in seconds. The wording of each lives in the dictionary (`step.<id>`). */
export const CLOCK_STEPS = [
  { id: "minute", seconds: 60 },
  { id: "fiveMinutes", seconds: 5 * 60 },
  { id: "hour", seconds: 60 * 60 },
  { id: "day", seconds: 24 * 60 * 60 },
] as const;

export type ClockStepId = (typeof CLOCK_STEPS)[number]["id"];

export function clockStepSeconds(id: string): number | null {
  return CLOCK_STEPS.find((step) => step.id === id)?.seconds ?? null;
}

/** What a safe test SMTP scenario is called. `success` is the default. */
export const SMTP_SCENARIOS = ["success", "tempfail", "permfail", "slow"] as const;
export type SmtpScenario = (typeof SMTP_SCENARIOS)[number];

export function isSmtpScenario(value: unknown): value is SmtpScenario {
  return typeof value === "string" && (SMTP_SCENARIOS as readonly string[]).includes(value);
}

/* --------------------------------------------------------------- validation */

export type IntegerCheck =
  | { ok: true; value: number }
  | { ok: false; code: "TEST_REQUIRED" | "TEST_RANGE"; limit: LimitId };

/**
 * A whole number within the limit. Form fields hand over text, so a numeric string is
 * accepted; anything else (empty, a fraction, `NaN`, out of range) is refused with the
 * reason, so the browser and the server both word the same refusal.
 */
export function checkInteger(limit: LimitId, raw: unknown): IntegerCheck {
  const { min, max } = TEST_LIMITS[limit];
  if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) {
    return { ok: false, code: "TEST_REQUIRED", limit };
  }
  const value = typeof raw === "string" ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    return { ok: false, code: "TEST_RANGE", limit };
  }
  return { ok: true, value };
}

/** The `{min}`–`{max}` a message about a limit is worded with. */
export function limitBounds(limit: LimitId): Range {
  const { min, max } = TEST_LIMITS[limit];
  return { min, max };
}
