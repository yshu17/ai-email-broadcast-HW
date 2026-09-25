import { RATE_PRESETS, TEST_TEMPLATES } from "./templates";
import { TEST_LIMITS } from "./limits";

/**
 * The separate teaching scenarios, one per thing worth testing by hand. Each has, in the
 * dictionary, `scenario.<id>.title`, and the parts a person needs to do it and to know they
 * were right: what to set first (`setup`), what to do (`steps`), the statuses to expect
 * (`statuses`), how many jobs to expect (`jobs`) and how to put everything back (`reset`).
 * Each of the last five is a short list, one item per line.
 */
export const SCENARIO_IDS = [
  "regular", "immediate", "cancel", "reschedule", "missed", "restart", "rate", "tempfail", "permfail",
] as const;

export type ScenarioId = (typeof SCENARIO_IDS)[number];

export const SCENARIO_PARTS = ["setup", "steps", "statuses", "jobs", "reset"] as const;

/** The numbers the scenarios' words use, drawn from the templates and presets they refer to. */
export function scenarioParams(): Record<string, number> {
  const in5 = TEST_TEMPLATES.find((t) => t.id === "in5min");
  const overdue = TEST_TEMPLATES.find((t) => t.id === "overdue5min");
  const big = TEST_TEMPLATES.find((t) => t.id === "bigRate");
  const temp = TEST_TEMPLATES.find((t) => t.id === "tempFail");
  const perm = TEST_TEMPLATES.find((t) => t.id === "permFail");
  const visible = RATE_PRESETS.find((p) => p.id === "visible");
  return {
    minutes: in5?.offsetMinutes ?? 5,
    recipients: in5?.recipients ?? 5,
    overdueMinutes: overdue?.overdueMinutes ?? 5,
    overdueRecipients: overdue?.recipients ?? 5,
    bigRecipients: big?.recipients ?? 30,
    tempRecipients: temp?.recipients ?? 3,
    tempFailures: temp?.temporaryFailures ?? 1,
    permRecipients: perm?.recipients ?? 3,
    rateMax: visible?.maxEmails ?? 2,
    rateWindow: visible?.windowSeconds ?? 10,
    interval: TEST_LIMITS.schedulerInterval.default,
  };
}
