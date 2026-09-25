import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CycleOutcome } from "@/lib/scheduler";

/**
 * The test scheduler's loop: when it runs a cycle, and what Start, Stop and the interval do
 * to that. The cycle itself is replaced by a stand-in here (it has its own tests against the
 * real database), so the timing is checked with fake timers and no waiting.
 */
const cycles = vi.hoisted(() => ({ calls: [] as string[], impl: null as null | (() => Promise<unknown>) }));

vi.mock("@/lib/scheduler", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scheduler")>();
  return {
    ...actual,
    runSchedulerCycle: vi.fn(async (source: string) => {
      cycles.calls.push(source);
      if (cycles.impl) return cycles.impl();
      return { ran: true, report: { id: cycles.calls.length } } as unknown as CycleOutcome;
    }),
  };
});

import { testScheduler } from "@/lib/testing/test-scheduler";
import { TEST_LIMITS } from "@/lib/testing/limits";
import { TestToolsDisabledError } from "@/lib/testing/access";
import { disableTestTools, enableTestTools } from "./testpanel-helpers";

beforeEach(async () => {
  cycles.calls = [];
  cycles.impl = null;
  await enableTestTools();
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.useRealTimers();
  await disableTestTools();
  vi.restoreAllMocks();
});

const settle = () => vi.advanceTimersByTimeAsync(0);
const seconds = (n: number) => vi.advanceTimersByTimeAsync(n * 1000);

describe("Start", () => {
  it("runs a cycle at once, then one every interval", async () => {
    testScheduler.start();
    await settle();
    expect(cycles.calls).toEqual(["panel-loop"]);

    await seconds(TEST_LIMITS.schedulerInterval.default);
    expect(cycles.calls).toHaveLength(2);
    await seconds(TEST_LIMITS.schedulerInterval.default);
    expect(cycles.calls).toHaveLength(3);
  });

  it("is idempotent: starting a running loop does not start a second one", async () => {
    testScheduler.start();
    testScheduler.start();
    testScheduler.start();
    await settle();
    await seconds(5);

    expect(cycles.calls).toHaveLength(2);
  });

  it("says when the next cycle is due, and that it is running", async () => {
    testScheduler.start();
    await settle();

    const snapshot = testScheduler.snapshot();
    expect(snapshot.running).toBe(true);
    expect(snapshot.nextCycleAt).not.toBeNull();
    expect(new Date(snapshot.nextCycleAt as string).getTime() - Date.now()).toBeGreaterThan(4000);
    expect(new Date(snapshot.nextCycleAt as string).getTime() - Date.now()).toBeLessThanOrEqual(5000);
  });

  it("starts again after a Stop, and finds campaigns again from the database (a fresh cycle is run)", async () => {
    testScheduler.start();
    await settle();
    testScheduler.stop();
    await seconds(60);
    expect(cycles.calls).toHaveLength(1);

    testScheduler.start();
    await settle();
    expect(cycles.calls).toHaveLength(2);
    await seconds(5);
    expect(cycles.calls).toHaveLength(3);
  });
});

describe("Stop", () => {
  it("ends the periodic cycles", async () => {
    testScheduler.start();
    await settle();
    testScheduler.stop();

    await seconds(600);

    expect(cycles.calls).toHaveLength(1);
    const snapshot = testScheduler.snapshot();
    expect(snapshot.running).toBe(false);
    expect(snapshot.nextCycleAt).toBeNull();
  });

  it("lets a cycle that is already running finish, and does not start another after it", async () => {
    let release!: () => void;
    cycles.impl = () => new Promise((resolve) => { release = () => resolve({ ran: true, report: { id: 1 } }); });

    testScheduler.start();
    await settle();
    expect(cycles.calls).toHaveLength(1);

    testScheduler.stop();
    release();
    await settle();
    await seconds(600);

    expect(cycles.calls).toHaveLength(1);
    expect(testScheduler.snapshot().running).toBe(false);
  });

  it("is harmless when the loop is not running", () => {
    expect(() => testScheduler.stop()).not.toThrow();
    expect(testScheduler.snapshot().running).toBe(false);
  });
});

describe("the interval", () => {
  it("defaults to the recommended value and is used between cycles", async () => {
    expect(testScheduler.intervalSeconds()).toBe(TEST_LIMITS.schedulerInterval.default);
    expect(TEST_LIMITS.schedulerInterval.default).toBeGreaterThanOrEqual(TEST_LIMITS.schedulerInterval.recommended.min);
    expect(TEST_LIMITS.schedulerInterval.default).toBeLessThanOrEqual(TEST_LIMITS.schedulerInterval.recommended.max);
  });

  it("re-times the wait already under way, measured from the end of the last cycle", async () => {
    expect(testScheduler.setInterval(60)).toEqual({ ok: true, seconds: 60 });
    testScheduler.start();
    await settle();
    await seconds(10);
    expect(cycles.calls).toHaveLength(1); // waiting for the 60-second mark

    expect(testScheduler.setInterval(2)).toEqual({ ok: true, seconds: 2 });
    await settle();
    // 10 s have passed since the last cycle, which is more than the new 2 s: it is due at once.
    expect(cycles.calls).toHaveLength(2);
    await seconds(2);
    expect(cycles.calls).toHaveLength(3);
  });

  it("can be changed while stopped, and applies on the next Start", async () => {
    testScheduler.setInterval(30);
    testScheduler.start();
    await settle();
    await seconds(29);
    expect(cycles.calls).toHaveLength(1);
    await seconds(1);
    expect(cycles.calls).toHaveLength(2);
  });

  it.each([
    ["zero", 0], ["negative", -5], ["above the maximum", TEST_LIMITS.schedulerInterval.max + 1],
    ["a fraction", 2.5], ["text", "soon"], ["empty", ""], ["missing", undefined], ["not a number", Number.NaN],
  ])("refuses %s and leaves the interval alone", (_label, value) => {
    testScheduler.setInterval(7);

    const result = testScheduler.setInterval(value);

    expect(result.ok).toBe(false);
    expect(testScheduler.intervalSeconds()).toBe(7);
  });

  it("accepts both ends of the range, and a number typed into a text field", () => {
    expect(testScheduler.setInterval(TEST_LIMITS.schedulerInterval.min)).toEqual({ ok: true, seconds: 1 });
    expect(testScheduler.setInterval(TEST_LIMITS.schedulerInterval.max)).toEqual({ ok: true, seconds: 300 });
    expect(testScheduler.setInterval("12")).toEqual({ ok: true, seconds: 12 });
  });
});

describe("Run now", () => {
  it("runs exactly one cycle, through the same service, whether or not the loop is running", async () => {
    const outcome = await testScheduler.runNow();

    expect(outcome.ran).toBe(true);
    expect(cycles.calls).toEqual(["run-now"]);
    // No loop was started by it.
    await seconds(600);
    expect(cycles.calls).toEqual(["run-now"]);
    expect(testScheduler.snapshot().running).toBe(false);
  });

  it("does not disturb the loop's own rhythm", async () => {
    testScheduler.start();
    await settle();
    await seconds(2);

    await testScheduler.runNow();
    expect(cycles.calls).toEqual(["panel-loop", "run-now"]);

    await seconds(3); // the loop's own second cycle, 5 s after its first
    expect(cycles.calls).toEqual(["panel-loop", "run-now", "panel-loop"]);
  });
});

describe("outside a test environment", () => {
  it("the scheduler cannot be started, stopped or run", async () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(() => testScheduler.start()).toThrow(TestToolsDisabledError);
    expect(() => testScheduler.stop()).toThrow(TestToolsDisabledError);
    expect(() => testScheduler.setInterval(5)).toThrow(TestToolsDisabledError);
    await expect(testScheduler.runNow()).rejects.toBeInstanceOf(TestToolsDisabledError);
    expect(testScheduler.isRunning()).toBe(false);
  });
});
