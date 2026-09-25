import { runSchedulerCycle, schedulerSnapshot, type CycleOutcome, type SchedulerSnapshot } from "../scheduler";
import { emitEvent } from "../events";
import { TestToolsDisabledError, testPanelEnabled } from "./access";
import { TEST_LIMITS, checkInteger } from "./limits";
import { loopState } from "./scheduler-state";

/**
 * The local test scheduler: a loop, inside the web server's own process, that runs a
 * scheduler cycle every few seconds. It stands in for `npm run worker` (the ticker
 * process) while testing, and it can be started, stopped and re-timed from the panel.
 *
 * It owns no logic of its own. Each pass is `runSchedulerCycle`, the very service the
 * worker endpoint and "Run now" use, so which campaigns are due, how they are started and
 * every protection against starting one twice are the ones production has.
 *
 * Stopping it stops only this loop, and only future cycles. Campaign statuses are not
 * touched, the queue is not emptied, and work already begun is allowed to finish. While it
 * is stopped, the worker endpoint answers "skipped", so no other ticker drives the app
 * behind the panel's back. Its state lives in this process's memory: a restart brings it
 * back running, at the default interval.
 */
const loop = loopState;

function clearTimer(): void {
  if (loop.timer) clearTimeout(loop.timer);
  loop.timer = null;
  loop.nextCycleAt = null;
}

function scheduleNext(delayMs: number): void {
  clearTimer();
  if (!loop.running) return;
  loop.nextCycleAt = Date.now() + delayMs;
  loop.timer = setTimeout(() => void pass(), delayMs);
  // Never the reason a process stays alive.
  loop.timer.unref?.();
}

async function pass(): Promise<void> {
  loop.timer = null;
  loop.nextCycleAt = null;
  if (!loop.running) return;
  try {
    await runSchedulerCycle("panel-loop");
  } catch (error) {
    // `runSchedulerCycle` records its own failures; this only keeps the loop alive.
    console.error("[test-scheduler] cycle failed", error instanceof Error ? error.message : error);
  } finally {
    loop.lastEndedAt = Date.now();
    scheduleNext(loop.intervalSeconds * 1000);
  }
}

export type TestSchedulerSnapshot = SchedulerSnapshot & {
  running: boolean;
  intervalSeconds: number;
  nextCycleAt: string | null;
};

export const testScheduler = {
  /** Whether the loop is running. `false` outside a test environment: there is no loop there. */
  isRunning(): boolean {
    return testPanelEnabled() && loop.running;
  },

  /** Current interval in seconds, for spreading the rate limit over the ticks. */
  intervalSeconds(): number {
    return loop.intervalSeconds;
  },

  /** Starts the loop; the first pass runs at once. Starting a running loop changes nothing. */
  start(): void {
    if (!testPanelEnabled()) throw new TestToolsDisabledError("The test scheduler");
    if (loop.running) return;
    loop.running = true;
    emitEvent({ type: "test.scheduler.started", source: "panel" });
    scheduleNext(0);
  },

  /** Stops future passes. A pass already running finishes; no status is changed. */
  stop(): void {
    if (!testPanelEnabled()) throw new TestToolsDisabledError("The test scheduler");
    if (!loop.running) return;
    loop.running = false;
    clearTimer();
    emitEvent({ type: "test.scheduler.stopped", source: "panel" });
  },

  /**
   * Sets the wait between passes. The wait already under way is re-timed to it, measured from
   * the end of the last pass, so a change from 300 seconds to 2 is felt at once.
   */
  setInterval(raw: unknown):
    | { ok: true; seconds: number }
    | { ok: false; code: "TEST_REQUIRED" | "TEST_RANGE" } {
    if (!testPanelEnabled()) throw new TestToolsDisabledError("The test scheduler");
    const check = checkInteger("schedulerInterval", raw);
    if (!check.ok) return { ok: false, code: check.code };
    loop.intervalSeconds = check.value;
    if (loop.running && loop.timer) {
      const since = loop.lastEndedAt ?? Date.now();
      scheduleNext(Math.max(0, since + check.value * 1000 - Date.now()));
    }
    emitEvent({ type: "test.scheduler.interval", source: "panel", data: { seconds: check.value } });
    return { ok: true, seconds: check.value };
  },

  /** One cycle, now, by the same service as the loop. Answers `ran: false` if one is already running. */
  async runNow(): Promise<CycleOutcome> {
    if (!testPanelEnabled()) throw new TestToolsDisabledError("The test scheduler");
    return runSchedulerCycle("run-now");
  },

  snapshot(): TestSchedulerSnapshot {
    return {
      ...schedulerSnapshot(),
      running: testPanelEnabled() && loop.running,
      intervalSeconds: loop.intervalSeconds,
      nextCycleAt: loop.nextCycleAt === null ? null : new Date(loop.nextCycleAt).toISOString(),
    };
  },

  /** For tests: forget everything, as a fresh process would. */
  reset(): void {
    clearTimer();
    loop.running = false;
    loop.intervalSeconds = TEST_LIMITS.schedulerInterval.default;
    loop.lastEndedAt = null;
  },
};
