import { describe, expect, it, vi } from "vitest";
import { createWorkerLoop, type WorkerLoopOptions } from "@/lib/worker-loop";

/**
 * The ticker that drives the worker endpoint in Docker/VPS deployments. It holds
 * no state of its own — every scheduled campaign is found in the database on each
 * tick — so what matters is that it keeps ticking through failures, never runs two
 * ticks at once, and stops cleanly. The clock and the network are replaced by
 * fakes: no test here waits for real time or opens a socket.
 */

const URL_ = "http://127.0.0.1:3000/api/worker/tick";
const INTERVAL = 60_000;

function silentLog() {
  return { log: vi.fn(), error: vi.fn() };
}

type Reply = { status?: number; body?: unknown } | Error | "hang";

/** Builds a loop whose fetch replays `replies` in order and whose sleeps are instant and recorded. */
function harness(replies: Reply[], overrides: Partial<WorkerLoopOptions> = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const sleeps: number[] = [];
  const log = silentLog();
  let active = 0;
  let maxActive = 0;
  let loop: ReturnType<typeof createWorkerLoop>;

  const fetchFake = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    calls.push({ url: String(url), init: init ?? {} });
    try {
      await Promise.resolve();
      const reply = replies[calls.length - 1];
      // The script ends after the last scripted reply.
      if (calls.length >= replies.length) queueMicrotask(() => loop.stop());
      if (reply === undefined) return new Response("{}", { status: 200 });
      if (reply instanceof Error) throw reply;
      if (reply === "hang") {
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError")));
        });
      }
      return new Response(JSON.stringify(reply.body ?? {}), {
        status: reply.status ?? 200, headers: { "content-type": "application/json" },
      });
    } finally {
      active -= 1;
    }
  });

  loop = createWorkerLoop({
    url: URL_, secret: "s3cret", intervalMs: INTERVAL, startupDelayMs: 2000,
    fetch: fetchFake as unknown as typeof fetch,
    sleep: async (ms) => { sleeps.push(ms); },
    log,
    ...overrides,
  });
  return { loop, calls, sleeps, log, maxActive: () => maxActive, fetchFake };
}

describe("the worker loop", () => {
  it("calls the worker endpoint with the shared secret", async () => {
    const h = harness([{}]);

    await h.loop.run();

    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].url).toBe(URL_);
    expect(h.calls[0].init.method).toBe("POST");
    expect((h.calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer s3cret");
  });

  it("waits briefly at start, for the web server to come up, and then once per interval", async () => {
    const h = harness([{}, {}, {}]);

    await h.loop.run();

    expect(h.calls).toHaveLength(3);
    expect(h.sleeps[0]).toBe(2000);
    expect(h.sleeps.slice(1)).toEqual([INTERVAL, INTERVAL]);
  });

  it("keeps ticking after the server is unreachable, and retries sooner than a full interval", async () => {
    const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:3000"), { code: "ECONNREFUSED" });
    const h = harness([refused, refused, refused, {}]);

    await h.loop.run();

    expect(h.calls).toHaveLength(4);
    // 5s, 10s, 20s while it is down — never longer than the normal interval — then back to normal.
    expect(h.sleeps.slice(1)).toEqual([5_000, 10_000, 20_000]);
    expect(h.log.error).toHaveBeenCalledTimes(3);
  });

  it("backs off no further than the normal interval", async () => {
    const down = new Error("down");
    const h = harness(Array.from({ length: 8 }, () => down), { intervalMs: 30_000 });

    await h.loop.run();

    expect(Math.max(...h.sleeps.slice(1))).toBe(30_000);
    expect(h.sleeps.slice(1, 5)).toEqual([5_000, 10_000, 20_000, 30_000]);
  });

  it("treats an HTTP error from the server (for example, the database is down) as a failed tick, not a crash", async () => {
    const h = harness([
      { status: 500, body: { error: "connect ECONNREFUSED" } },
      { status: 401, body: { error: "Unauthorized" } },
      {},
    ]);

    await h.loop.run();

    expect(h.calls).toHaveLength(3);
    expect(h.log.error).toHaveBeenCalledTimes(2);
    expect(h.sleeps.slice(1)).toEqual([5_000, 10_000]);
  });

  it("recovers: a good tick resets the retry delay", async () => {
    const down = new Error("down");
    const h = harness([down, down, {}, down, {}]);

    await h.loop.run();

    expect(h.sleeps.slice(1)).toEqual([5_000, 10_000, INTERVAL, 5_000]);
  });

  it("gives up on a hung request instead of waiting forever, and carries on", async () => {
    const h = harness(["hang", {}], { requestTimeoutMs: 20 });

    await h.loop.run();

    expect(h.calls).toHaveLength(2);
    expect(h.log.error).toHaveBeenCalledWith("[worker] tick failed:", expect.stringContaining("timed out"));
  });

  it("logs only when a tick did something", async () => {
    const h = harness([
      { body: { claimed: 0, reclaimed: 0, activatedCampaigns: 0 } },
      { body: { claimed: 0, reclaimed: 0, activatedCampaigns: 2 } },
      { body: { claimed: 5, reclaimed: 0, activatedCampaigns: 0 } },
    ]);

    await h.loop.run();

    expect(h.log.log).toHaveBeenCalledTimes(2);
  });

  it("never has two ticks in flight at once", async () => {
    const h = harness(Array.from({ length: 25 }, () => ({})));

    await h.loop.run();

    expect(h.calls).toHaveLength(25);
    expect(h.maxActive()).toBe(1);
  });

  it("starts one loop per process, however many times it is asked to", async () => {
    const h = harness([{}, {}]);

    const first = h.loop.run();
    const second = h.loop.run();
    const third = h.loop.run();
    await Promise.all([first, second, third]);

    expect(h.calls).toHaveLength(2);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });
});

describe("stopping the worker loop", () => {
  it("stops during the wait between ticks without waiting out the interval", async () => {
    const started = vi.fn();
    const real = createWorkerLoop({
      url: URL_, secret: "s", intervalMs: 3_600_000, startupDelayMs: 0,
      fetch: (async () => { started(); return new Response("{}"); }) as unknown as typeof fetch,
      log: silentLog(),
    });

    const done = real.run();
    await vi.waitFor(() => expect(started).toHaveBeenCalledTimes(1));
    real.stop();

    // Would hang for an hour if the wait could not be cut short.
    await expect(done).resolves.toBeUndefined();
    expect(started).toHaveBeenCalledTimes(1);
  });

  it("stops during the start-up wait without ticking at all", async () => {
    const fetchFake = vi.fn(async () => new Response("{}"));
    const real = createWorkerLoop({
      url: URL_, secret: "s", intervalMs: 60_000, startupDelayMs: 3_600_000,
      fetch: fetchFake as unknown as typeof fetch, log: silentLog(),
    });

    const done = real.run();
    real.stop();

    await expect(done).resolves.toBeUndefined();
    expect(fetchFake).not.toHaveBeenCalled();
  });

  it("lets a tick that is already under way finish before it exits", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const order: string[] = [];
    const real = createWorkerLoop({
      url: URL_, secret: "s", intervalMs: 60_000, startupDelayMs: 0,
      fetch: (async () => { order.push("tick started"); await gate; order.push("tick finished"); return new Response("{}"); }) as unknown as typeof fetch,
      log: silentLog(),
    });

    const done = real.run().then(() => order.push("loop ended"));
    await vi.waitFor(() => expect(order).toEqual(["tick started"]));
    real.stop();
    await Promise.resolve();
    expect(order).toEqual(["tick started"]); // still waiting for the tick
    finish();
    await done;

    expect(order).toEqual(["tick started", "tick finished", "loop ended"]);
  });

  it("does not start another tick after being told to stop", async () => {
    const h = harness([{}, {}, {}, {}, {}]);
    const stopAfterFirst = h.fetchFake.getMockImplementation()!;
    h.fetchFake.mockImplementation(async (...args) => {
      const response = await stopAfterFirst(...args);
      h.loop.stop();
      return response;
    });

    await h.loop.run();

    expect(h.calls).toHaveLength(1);
  });
});

describe("the liveness signal", () => {
  it("reports every tick, and whether the server answered it", async () => {
    const seen: boolean[] = [];
    const h = harness([{}, { status: 500, body: { error: "down" } }, new Error("refused"), {}], { onTick: (ok) => seen.push(ok) });

    await h.loop.run();

    expect(seen).toEqual([true, false, false, true]);
  });
});
