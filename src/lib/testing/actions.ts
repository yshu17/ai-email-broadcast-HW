import { badRequest, conflict } from "../api";
import { advanceTime, clockSnapshot, resetClock, setFixedTime } from "../clock";
import { emitEvent } from "../events";
import { resolveWallClock } from "../scheduling";
import { scheduleErrorKey } from "../campaign-send";
import { rejectField, rejectInteger } from "./api";
import { resetRateOverride, setRateOverride } from "./controls";
import { TEST_LIMITS, clockStepSeconds } from "./limits";
import { testScheduler } from "./test-scheduler";

/**
 * What the test panel's buttons do, as functions the endpoints (and the tests) call.
 *
 * Each validates its input against `TEST_LIMITS` and refuses in the API's own words, so the
 * browser's checks and these agree, and each announces itself to the journal. They only ever
 * run behind `withTestPanel`, which is where the environment, the flag and the session are checked.
 */

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return true;
  } catch {
    return false;
  }
}

function assertClockYear(instant: Date): void {
  const { min, max } = TEST_LIMITS.clockYear;
  const year = instant.getUTCFullYear();
  if (year < min || year > max) badRequest("err.test.clockRange", { min, max }, { code: "TEST_RANGE", field: "clock" });
}

export type ClockRequest = {
  action?: unknown;
  date?: unknown;
  time?: unknown;
  timeZone?: unknown;
  occurrence?: unknown;
  step?: unknown;
};

/** Set / Advance / Reset for the test clock. Returns the clock as it is afterwards. */
export function clockAction(body: ClockRequest) {
  if (body.action === "reset") {
    resetClock();
    emitEvent({ type: "test.clock.reset", source: "panel" });
    return clockSnapshot();
  }

  if (body.action === "set") {
    const date = typeof body.date === "string" ? body.date : "";
    const time = typeof body.time === "string" ? body.time : "";
    const timeZone = typeof body.timeZone === "string" ? body.timeZone : "";
    if (!isValidTimeZone(timeZone)) rejectField("err.test.timeZone", "timeZone");

    const wall = resolveWallClock(date, time, timeZone);
    if (!wall.ok) badRequest(scheduleErrorKey(wall.code), undefined, { code: wall.code, field: wall.field });
    // A repeated wall-clock time (clocks going back) can mean either instant; take the one asked for, else the earlier.
    const instant = body.occurrence === "second" && wall.candidates.length > 1 ? wall.candidates[1] : wall.candidates[0];
    assertClockYear(instant);

    setFixedTime(instant);
    emitEvent({ type: "test.clock.set", source: "panel", data: { effectiveNow: instant.toISOString() } });
    return clockSnapshot();
  }

  if (body.action === "advance") {
    const seconds = typeof body.step === "string" ? clockStepSeconds(body.step) : null;
    if (seconds === null) rejectField("err.test.step", "step");
    if (clockSnapshot().mode !== "fixed") conflict("err.test.clockNotHeld");

    const target = new Date(new Date(clockSnapshot().effectiveNow).getTime() + seconds * 1000);
    assertClockYear(target);
    advanceTime(seconds * 1000);
    emitEvent({ type: "test.clock.advanced", source: "panel", data: { seconds, effectiveNow: target.toISOString() } });
    return clockSnapshot();
  }

  return rejectField("err.test.action", "action");
}

export type SchedulerRequest = { action?: unknown; seconds?: unknown };

/** Start / Stop / Run now / interval for the test scheduler. */
export async function schedulerAction(body: SchedulerRequest) {
  switch (body.action) {
    case "start":
      testScheduler.start();
      return { snapshot: testScheduler.snapshot() };
    case "stop":
      testScheduler.stop();
      return { snapshot: testScheduler.snapshot() };
    case "interval": {
      const result = testScheduler.setInterval(body.seconds);
      if (!result.ok) rejectInteger("schedulerInterval", result.code);
      return { snapshot: testScheduler.snapshot() };
    }
    case "run": {
      const outcome = await testScheduler.runNow();
      return {
        ran: outcome.ran,
        reason: outcome.ran ? null : outcome.reason,
        report: outcome.ran ? outcome.report : null,
        snapshot: testScheduler.snapshot(),
      };
    }
    default:
      return rejectField("err.test.action", "action");
  }
}

export type RateLimitRequest = { action?: unknown; maxEmails?: unknown; windowSeconds?: unknown };

/** Apply / Reset for the queue's test rate limit. */
export function rateLimitAction(body: RateLimitRequest) {
  if (body.action === "reset") {
    resetRateOverride();
    emitEvent({ type: "test.rate.reset", source: "panel" });
    return { override: null };
  }
  if (body.action === "apply") {
    const result = setRateOverride(body.maxEmails, body.windowSeconds);
    if (!result.ok) rejectInteger(result.field === "maxEmails" ? "rateMaxEmails" : "rateWindowSeconds", result.code);
    emitEvent({
      type: "test.rate.applied", source: "panel",
      data: { maxEmails: result.rate.maxEmails, windowSeconds: result.rate.windowSeconds },
    });
    return { override: { maxEmails: result.rate.maxEmails, windowSeconds: result.rate.windowSeconds } };
  }
  return rejectField("err.test.action", "action");
}
