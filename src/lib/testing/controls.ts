import type { RateWindow } from "../rate-limit";
import { processState } from "../process-state";
import { TestToolsDisabledError, testPanelEnabled } from "./access";
import { checkInteger, limitBounds } from "./limits";

/**
 * The test panel's overrides of the queue's rate limit.
 *
 * They are the *inputs* of the existing rate limiter, not a second one: the worker
 * reads them when it works out how many emails may start, and otherwise applies
 * the same arithmetic it applies to the configured hourly ceiling. They live in this
 * process's memory only, so they end at a restart or at `resetRateOverride()`, and
 * they are honoured only in a development or test environment with the panel on.
 */
type Controls = { rate: RateWindow | null };

const controls = processState<Controls>("test.controls", () => ({ rate: null }));

/** The window to use instead of the configured hourly ceiling, or `undefined` for the normal one. */
export function getRateOverride(): RateWindow | undefined {
  // Read through the same gate as everything else: outside a test environment a
  // leftover value could never take effect.
  return testPanelEnabled() && controls.rate ? { ...controls.rate } : undefined;
}

export type RateOverrideResult =
  | { ok: true; rate: RateWindow }
  | { ok: false; code: "TEST_REQUIRED" | "TEST_RANGE"; field: "maxEmails" | "windowSeconds" };

/** Validates and sets "at most `maxEmails` per `windowSeconds`". `safetyFactor: 1`: exactly this number. */
export function setRateOverride(maxEmails: unknown, windowSeconds: unknown): RateOverrideResult {
  if (!testPanelEnabled()) throw new TestToolsDisabledError("The rate-limit override");
  const max = checkInteger("rateMaxEmails", maxEmails);
  if (!max.ok) return { ok: false, code: max.code, field: "maxEmails" };
  const window = checkInteger("rateWindowSeconds", windowSeconds);
  if (!window.ok) return { ok: false, code: window.code, field: "windowSeconds" };
  controls.rate = { maxEmails: max.value, windowSeconds: window.value, safetyFactor: 1 };
  return { ok: true, rate: { ...controls.rate } };
}

/** Back to the configured ceiling. Harmless anywhere. */
export function resetRateOverride(): void {
  controls.rate = null;
}

export { limitBounds };
