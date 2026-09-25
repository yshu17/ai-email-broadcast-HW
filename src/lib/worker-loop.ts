/**
 * The ticker behind `npm run worker` and the Docker `RUN_INTERNAL_WORKER` sidecar:
 * it calls the worker endpoint on an interval, exactly as a cron job would.
 *
 * It keeps no schedule of its own. Which campaigns are due, and what is queued, is
 * read from the database by every tick (see `runTick`), so this loop can be
 * killed, crash or restart at any moment and lose nothing: the first tick after it
 * comes back finds whatever became due in the meantime.
 *
 * What it does have to get right is staying alive:
 *  - A failed tick (server down, database down, bad secret, a hung request) is logged
 *    and retried, never fatal. While failing it retries sooner than a full
 *    interval, so recovery does not wait a whole minute after the server comes back.
 *  - Ticks never overlap: the next one is scheduled only after the previous ended.
 *  - Asking for the loop twice in one process still runs one loop.
 *  - `stop()` cuts a wait short but lets a tick that is already running finish.
 */

export type WorkerLoopOptions = {
  /** Full URL of `POST /api/worker/tick`. */
  url: string;
  secret: string;
  /** Normal time between ticks. */
  intervalMs: number;
  /** A tick that has not answered by then is abandoned (the server's own limit is 60s). */
  requestTimeoutMs?: number;
  /** Grace period for the web server to start listening on first boot. */
  startupDelayMs?: number;
  /** Called after every tick with whether the server answered successfully (a liveness signal for the container). */
  onTick?: (ok: boolean) => void;
  /** Injected for tests. */
  fetch?: typeof fetch;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  log?: Pick<Console, "log" | "error">;
};

export type WorkerLoop = {
  /** Starts the loop (once) and resolves when it has stopped. */
  run(): Promise<void>;
  /** Ends the loop after the tick in progress, if any. */
  stop(): void;
};

/** First retry delay after a failed tick; it doubles until it reaches the normal interval. */
const RETRY_BASE_MS = 5_000;

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}

export function createWorkerLoop(options: WorkerLoopOptions): WorkerLoop {
  const {
    url, secret, intervalMs,
    requestTimeoutMs = 90_000,
    startupDelayMs = 2_000,
    onTick,
    fetch: doFetch = fetch,
    sleep = abortableSleep,
    log = console,
  } = options;

  let stopping = false;
  let running: Promise<void> | null = null;
  const wake = new AbortController();

  /** Whether the server answered successfully. */
  async function tick(): Promise<boolean> {
    try {
      const response = await doFetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        log.error(`[worker] ${response.status}`, body);
        return false;
      }
      if (body.claimed > 0 || body.reclaimed > 0 || body.activatedCampaigns > 0 || body.recoveredCampaigns > 0) {
        log.log("[worker]", body);
      }
      return true;
    } catch (error) {
      log.error("[worker] tick failed:", error instanceof Error ? error.message : error);
      return false;
    }
  }

  async function loop(): Promise<void> {
    let failures = 0;
    await sleep(startupDelayMs, wake.signal);
    while (!stopping) {
      const ok = await tick();
      onTick?.(ok);
      failures = ok ? 0 : failures + 1;
      if (stopping) break;
      const delay = failures === 0 ? intervalMs : Math.min(intervalMs, RETRY_BASE_MS * 2 ** (failures - 1));
      await sleep(delay, wake.signal);
    }
  }

  return {
    run() {
      running ??= loop();
      return running;
    },
    stop() {
      stopping = true;
      wake.abort();
    },
  };
}
