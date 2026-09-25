import type { SmtpScenario } from "./limits";

/**
 * The ready-made test campaigns. A template only fills in the "Create test campaign"
 * form (nothing is created until the person presses Create), so what it will do is in
 * front of them and can be changed first.
 *
 * `offsetMinutes`: for a scheduled template, how far ahead of the *test clock's* time the
 * start is set. `overdueMinutes`: how late an overdue campaign already is when it is
 * created. The numbers are checked against `TEST_LIMITS` by the tests.
 */
export type SendMode = "now" | "schedule" | "overdue";

export type TestTemplate = {
  /** Also the suffix of its dictionary keys: `template.<id>`. */
  id: string;
  mode: SendMode;
  scenario: SmtpScenario;
  recipients: number;
  offsetMinutes?: number;
  overdueMinutes?: number;
  temporaryFailures?: number;
  slowDelaySeconds?: number;
};

export const TEST_TEMPLATES: readonly TestTemplate[] = [
  { id: "in1min", mode: "schedule", scenario: "success", recipients: 5, offsetMinutes: 1 },
  { id: "in5min", mode: "schedule", scenario: "success", recipients: 5, offsetMinutes: 5 },
  { id: "overdue5min", mode: "overdue", scenario: "success", recipients: 5, overdueMinutes: 5 },
  { id: "bigRate", mode: "now", scenario: "success", recipients: 30 },
  { id: "tempFail", mode: "now", scenario: "tempfail", recipients: 3, temporaryFailures: 1 },
  { id: "permFail", mode: "now", scenario: "permfail", recipients: 3 },
  { id: "slowSmtp", mode: "now", scenario: "slow", recipients: 3, slowDelaySeconds: 3 },
];

/** The rate-limit settings the help recommends, as presets for the form. */
export type RatePreset = { id: string; maxEmails: number; windowSeconds: number };

export const RATE_PRESETS: readonly RatePreset[] = [
  { id: "quick", maxEmails: 5, windowSeconds: 1 },
  { id: "visible", maxEmails: 2, windowSeconds: 10 },
  { id: "large", maxEmails: 10, windowSeconds: 5 },
];
