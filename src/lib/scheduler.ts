import { clock } from "./clock";
import { emitEvent } from "./events";
import { processState } from "./process-state";
import { testPanelEnabled } from "./testing/access";
import { getRateOverride } from "./testing/controls";
import { loopState } from "./testing/scheduler-state";
import { runTick, type TickResult } from "./worker";

/**
 * One scheduler cycle, as a service.
 *
 * A cycle is what a worker tick has always been: start the scheduled campaigns whose
 * time has come, repair the ones that got stuck, and let the queue hand out whatever
 * the rate limit allows. Every way of running one goes through here:
 *
 *  - `worker`      the worker endpoint (`/api/worker/tick`): cron, the bundled ticker;
 *  - `panel-loop`  the test scheduler's own timer (development and test only);
 *  - `run-now`     the "Run now" button (development and test only).
 *
 * so a manual cycle and an automatic one cannot differ. Nothing here sends mail itself:
 * a cycle only queues campaigns and lets the queue work, at the queue's rate.
 *
 * Where the test tools are on, two more things hold, both of which are new only there:
 *
 *  - one cycle at a time in this process. A second request while one runs is answered
 *    `busy` and does nothing (the loop simply tries again after its wait);
 *  - the worker endpoint is refused (`stopped`) while the test scheduler is stopped, so
 *    "Stop" means no cycles, whoever asks for them, except an explicit "Run now".
 *
 * In production none of that applies and a cycle is exactly `runTick`: several may
 * overlap, as before, and the database's row locks keep that safe.
 */
export type CycleSource = "worker" | "panel-loop" | "run-now";

export type CycleReport = {
  id: number;
  source: CycleSource;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  /** What the scheduling rules saw as "now": the test clock's time while it is held. */
  effectiveNow: string;
  simulatedClock: boolean;
  /** Present when the cycle completed. */
  result: TickResult | null;
  /** Present when it failed: a short message with no connection strings or credentials. */
  error: string | null;
};

export type CycleOutcome =
  | { ran: true; report: CycleReport }
  | { ran: false; reason: "busy" | "stopped" };

export type SchedulerSnapshot = {
  /** Whether a cycle is running right now. */
  cycleInFlight: boolean;
  /** How many cycles this process has run. */
  cycles: number;
  last: CycleReport | null;
};

type Runtime = { inFlight: boolean; cycles: number; last: CycleReport | null };

const runtime = processState<Runtime>("scheduler.runtime", () => ({ inFlight: false, cycles: 0, last: null }));

export function schedulerSnapshot(): SchedulerSnapshot {
  return { cycleInFlight: runtime.inFlight, cycles: runtime.cycles, last: runtime.last };
}

/** For tests: forget the history, as a fresh process would. */
export function resetSchedulerRuntime(): void {
  runtime.inFlight = false;
  runtime.cycles = 0;
  runtime.last = null;
}

/** A failure's message without anything that could carry a credential (a connection string, a password). */
export function safeErrorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s@]*@/gi, "***@")
    .replace(/\bpass(word)?\b["'\s:=]+\S+/gi, "password ***")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

export async function runSchedulerCycle(source: CycleSource): Promise<CycleOutcome> {
  const testing = testPanelEnabled();

  if (testing && source === "worker" && !loopState.running) return { ran: false, reason: "stopped" };

  // One at a time, but only where the test tools are on; production keeps its old freedom to overlap.
  const exclusive = testing || source !== "worker";
  if (exclusive && runtime.inFlight) return { ran: false, reason: "busy" };
  if (exclusive) runtime.inFlight = true;

  const startedAt = new Date();
  const started = Date.now();
  const simulated = clock.isSimulated();
  const effectiveNow = clock.now();
  const id = (runtime.cycles += 1);
  let result: TickResult | null = null;
  let failure: unknown = null;

  emitEvent({ type: "scheduler.cycle.started", source: "scheduler", data: { cycle: id, trigger: source } });
  try {
    result = await runTick({
      // `undefined` leaves the decision to the database's own clock, exactly as before.
      now: clock.dbNow(),
      rateLimit: getRateOverride(),
      tickIntervalSeconds: testing && loopState.running ? loopState.intervalSeconds : undefined,
    });
  } catch (error) {
    failure = error;
  } finally {
    if (exclusive) runtime.inFlight = false;
  }

  const report: CycleReport = {
    id,
    source,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    effectiveNow: effectiveNow.toISOString(),
    simulatedClock: simulated,
    result,
    error: failure === null ? null : safeErrorMessage(failure),
  };
  runtime.last = report;

  emitEvent({
    type: failure === null ? "scheduler.cycle.finished" : "scheduler.cycle.failed",
    source: "scheduler",
    data: result
      ? {
        cycle: id, due: result.dueCampaigns, activated: result.activatedCampaigns,
        claimed: result.claimed, sent: result.sent, failed: result.failed, retried: result.retried,
      }
      : { cycle: id },
  });

  // The worker endpoint answers a failed tick with a 500, as it always has: it needs the error itself.
  if (failure !== null && source === "worker") throw failure;
  return { ran: true, report };
}
