import { processState } from "./process-state";
import { TestToolsDisabledError, testPanelEnabled } from "./testing/access";

/**
 * The application's clock, for the parts that decide about *scheduled times*:
 * whether a time a person asks for is still ahead, and whether a scheduled
 * campaign's moment has come.
 *
 * In production it is the system clock, always. In a development or test
 * environment with the test panel on it can instead be held at a chosen instant
 * (and moved forward by hand), so a campaign due "in 5 minutes" can be started
 * without waiting five minutes. Nothing here touches the computer's own clock or
 * replaces `Date` anywhere: code that is not written to ask this clock (mail
 * delivery, retry back-off, the rate-limit window) keeps using real time.
 *
 * The held time lives in this process's memory only, so it ends when the
 * process restarts or `resetClock()` is called.
 */
type Held = { at: number | null };

const held = processState<Held>("clock", () => ({ at: null }));

/** The instant the test clock is held at, or `null` when the real clock is in charge. */
function activeTestTime(): number | null {
  // Checked on every read, not just when the time was set: even if some state were
  // left behind, nothing but a test environment with the panel on ever honours it.
  return testPanelEnabled() ? held.at : null;
}

export const clock = {
  /** The current time, as the scheduling rules see it. */
  now(): Date {
    const at = activeTestTime();
    return at === null ? new Date() : new Date(at);
  },

  /**
   * The instant to compare stored times against, or `undefined` when the database's
   * own clock should be used (which it is, unchanged, whenever the test clock is off).
   * It is what the scheduler and the reschedule check take as their `now` option.
   */
  dbNow(): Date | undefined {
    const at = activeTestTime();
    return at === null ? undefined : new Date(at);
  },

  isSimulated(): boolean {
    return activeTestTime() !== null;
  },
};

export type ClockSnapshot = {
  mode: "real" | "fixed";
  /** The system clock. */
  realNow: string;
  /** What the scheduling rules see now: the held time in a fixed mode, else the same as `realNow`. */
  effectiveNow: string;
  /** Where the test clock is held; `null` in real mode. */
  fixedAt: string | null;
};

export function clockSnapshot(): ClockSnapshot {
  const at = activeTestTime();
  return {
    mode: at === null ? "real" : "fixed",
    realNow: new Date().toISOString(),
    effectiveNow: clock.now().toISOString(),
    fixedAt: at === null ? null : new Date(at).toISOString(),
  };
}

/** Holds the clock at `at`. Refused outside a development or test environment. */
export function setFixedTime(at: Date): void {
  if (!testPanelEnabled()) throw new TestToolsDisabledError("The test clock");
  if (Number.isNaN(at.getTime())) throw new RangeError("The test time is not a valid date.");
  held.at = at.getTime();
}

/** Moves a held clock forward (or back, for a negative step). Needs the clock to be held already. */
export function advanceTime(milliseconds: number): void {
  if (!testPanelEnabled()) throw new TestToolsDisabledError("The test clock");
  if (held.at === null) throw new Error("The test clock is not held at a time; set a fixed time first.");
  held.at += milliseconds;
}

/** Back to the real clock. Harmless anywhere, so it is not restricted. */
export function resetClock(): void {
  held.at = null;
}
