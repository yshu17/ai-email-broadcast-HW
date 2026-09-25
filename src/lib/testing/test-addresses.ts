import { TEST_LIMITS, type SmtpScenario } from "./limits";

/**
 * The addresses test campaigns are sent to.
 *
 * They are made up, never typed in: `success-3f9a2c-007@test.invalid`. The domain is
 * one the standards reserve for exactly this (RFC 2606: `.invalid` never resolves), so
 * even mail that escaped the test SMTP server could not reach a real mailbox. The test
 * SMTP server refuses any other domain outright.
 *
 * The scenario is part of the address, so the test SMTP server needs no memory of who
 * is meant to fail how, and a restart in the middle of a test does not lose it:
 *
 *   success-<batch>-<n>          accepted
 *   tempfail<k>-<batch>-<n>      refused temporarily the first k times, then accepted
 *   permfail-<batch>-<n>         refused for good
 *   slow<d>-<batch>-<n>          accepted, but only after d seconds
 */
export const TEST_EMAIL_DOMAIN = "test.invalid";

/** How every test campaign, and the list it is sent to, is named, so they are plain to see and to clean up. */
export const TEST_NAME_PREFIX = "[TEST] ";

export function isTestName(name: string): boolean {
  return name.startsWith(TEST_NAME_PREFIX);
}

export type TestAddressPlan =
  | { scenario: "success" }
  | { scenario: "permfail" }
  | { scenario: "tempfail"; failures: number }
  | { scenario: "slow"; delaySeconds: number };

/** `batch`: a short lowercase alphanumeric id shared by one campaign's addresses. */
export function testAddress(plan: TestAddressPlan, batch: string, index: number): string {
  const label =
    plan.scenario === "tempfail" ? `tempfail${plan.failures}`
    : plan.scenario === "slow" ? `slow${plan.delaySeconds}`
    : plan.scenario;
  return `${label}-${batch}-${String(index).padStart(3, "0")}@${TEST_EMAIL_DOMAIN}`;
}

const LOCAL_PART = /^(success|permfail|tempfail(\d{1,2})?|slow(\d{1,2})?)-[a-z0-9]+-\d+$/;

/** What an address asks of the test SMTP server, or `null` if it is not a test address at all. */
export function parseTestAddress(address: string): TestAddressPlan | null {
  const lower = address.trim().toLowerCase();
  const at = lower.lastIndexOf("@");
  if (at < 1 || lower.slice(at + 1) !== TEST_EMAIL_DOMAIN) return null;

  const match = LOCAL_PART.exec(lower.slice(0, at));
  if (!match) return null;

  const [, kind, failures, delay] = match;
  if (kind === "success") return { scenario: "success" };
  if (kind === "permfail") return { scenario: "permfail" };
  if (kind.startsWith("tempfail")) {
    return { scenario: "tempfail", failures: failures ? Number(failures) : TEST_LIMITS.temporaryFailures.default };
  }
  return { scenario: "slow", delaySeconds: delay ? Number(delay) : TEST_LIMITS.slowDelaySeconds.default };
}

export function isTestAddress(address: string): boolean {
  return parseTestAddress(address) !== null;
}

/** The scenario an address stands for; used to tell a campaign's scenario from its recipients. */
export function scenarioOf(address: string): SmtpScenario | null {
  return parseTestAddress(address)?.scenario ?? null;
}
