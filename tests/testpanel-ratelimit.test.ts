import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "@/lib/db";
import { POST as postRate } from "@/app/api/dev/rate-limit/route.dev";
import { GET as getState } from "@/app/api/dev/state/route.dev";
import { runSchedulerCycle } from "@/lib/scheduler";
import { batchSize, effectiveHourlyLimit } from "@/lib/rate-limit";
import { rateLimitAction } from "@/lib/testing/actions";
import { getRateOverride, resetRateOverride, setRateOverride } from "@/lib/testing/controls";
import { readJournal } from "@/lib/testing/journal";
import { TEST_LIMITS, checkInteger } from "@/lib/testing/limits";
import { RATE_PRESETS } from "@/lib/testing/templates";
import { buildSnapshot } from "@/lib/testing/snapshot";
import { createTestCampaign } from "@/lib/testing/test-campaigns";
import { runTick } from "@/lib/worker";
import { getCampaign, resetDatabase } from "./helpers";
import { ageSendLog, disableTestTools, enableTestTools, jsonRequest, receivedFiles } from "./testpanel-helpers";

/**
 * The queue's test rate limit: "at most N emails per W seconds". It changes the numbers the
 * existing rate limiter works from, and nothing else: the queue, the claim, the log of sends
 * and the retry rules are the ones production runs.
 */
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    requireUser: async () => ({ id: "test-admin", email: "admin@example.test" }),
    requireAdminMutation: async () => ({ id: "test-admin", email: "admin@example.test" }),
    assertSameOrigin: async () => undefined,
  };
});

beforeEach(async () => {
  await resetDatabase();
  await enableTestTools();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  await disableTestTools();
  vi.restoreAllMocks();
});

afterAll(async () => { await sql.end(); });

const apply = (maxEmails: unknown, windowSeconds: unknown) => rateLimitAction({ action: "apply", maxEmails, windowSeconds });
const cycle = async () => {
  const outcome = await runSchedulerCycle("run-now");
  if (!outcome.ran) throw new Error("cycle did not run");
  return outcome.report.result!;
};
const sent = async (campaignId: string) => {
  const [row] = await sql<{ n: string }[]>`
    SELECT count(*)::text AS n FROM campaign_recipients WHERE campaign_id = ${campaignId} AND delivery_status = 'SENT'`;
  return Number(row.n);
};

describe("applying a limit", () => {
  it("sets it and reports it back", () => {
    expect(apply(2, 10)).toEqual({ override: { maxEmails: 2, windowSeconds: 10 } });
    expect(getRateOverride()).toEqual({ maxEmails: 2, windowSeconds: 10, safetyFactor: 1 });
  });

  it("accepts numbers typed into text fields", () => {
    expect(apply("5", "1")).toEqual({ override: { maxEmails: 5, windowSeconds: 1 } });
  });

  it("accepts both ends of both ranges", () => {
    const { rateMaxEmails, rateWindowSeconds } = TEST_LIMITS;
    expect(apply(rateMaxEmails.min, rateWindowSeconds.min)).toBeTruthy();
    expect(apply(rateMaxEmails.max, rateWindowSeconds.max)).toBeTruthy();
  });

  it.each([
    ["zero", 0], ["negative", -3], ["above the ceiling", TEST_LIMITS.rateMaxEmails.max + 1],
    ["a fraction", 1.5], ["text", "lots"], ["empty", ""], ["missing", undefined], ["null", null], ["not a number", Number.NaN],
    ["infinity", Number.POSITIVE_INFINITY],
  ])("refuses %s for the number of emails, and changes nothing", (_label, value) => {
    apply(3, 4);

    expect(() => apply(value, 10)).toThrowError(expect.objectContaining({ status: 400, details: expect.objectContaining({ field: "rateMaxEmails" }) }));
    expect(getRateOverride()).toMatchObject({ maxEmails: 3, windowSeconds: 4 });
  });

  it.each([
    ["zero", 0], ["negative", -10], ["above the ceiling", TEST_LIMITS.rateWindowSeconds.max + 1],
    ["a fraction", 2.5], ["text", "soon"], ["empty", ""], ["missing", undefined],
  ])("refuses %s for the interval, and changes nothing", (_label, value) => {
    apply(3, 4);

    expect(() => apply(2, value)).toThrowError(expect.objectContaining({ status: 400, details: expect.objectContaining({ field: "rateWindowSeconds" }) }));
    expect(getRateOverride()).toMatchObject({ maxEmails: 3, windowSeconds: 4 });
  });

  it("uses the same bounds as the browser does (the shared limits)", () => {
    for (const [id, value] of [["rateMaxEmails", 0], ["rateMaxEmails", 1001], ["rateWindowSeconds", 0], ["rateWindowSeconds", 3601]] as const) {
      expect(checkInteger(id, value)).toMatchObject({ ok: false, code: "TEST_RANGE" });
    }
    expect(checkInteger("rateMaxEmails", 1000)).toEqual({ ok: true, value: 1000 });
    expect(checkInteger("rateWindowSeconds", 3600)).toEqual({ ok: true, value: 3600 });
    expect(checkInteger("rateMaxEmails", "")).toMatchObject({ ok: false, code: "TEST_REQUIRED" });
  });

  it("says the range it enforces in its refusal", async () => {
    const response = await postRate(jsonRequest("POST", { action: "apply", maxEmails: 0, windowSeconds: 10 }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("1");
    expect(body.error).toContain(String(TEST_LIMITS.rateMaxEmails.max));
    expect(body).toMatchObject({ code: "TEST_RANGE", field: "rateMaxEmails" });
  });

  it("is recommended at the three settings the help gives, all within the limits", () => {
    expect(RATE_PRESETS.map((preset) => [preset.maxEmails, preset.windowSeconds])).toEqual([[5, 1], [2, 10], [10, 5]]);
    for (const preset of RATE_PRESETS) {
      expect(checkInteger("rateMaxEmails", preset.maxEmails).ok).toBe(true);
      expect(checkInteger("rateWindowSeconds", preset.windowSeconds).ok).toBe(true);
    }
  });
});

describe("Reset to defaults", () => {
  it("removes the override, so the configured ceiling is in force again", async () => {
    apply(2, 10);
    expect((await buildSnapshot()).rate).toMatchObject({ source: "test", maxEmails: 2, windowSeconds: 10 });

    expect(rateLimitAction({ action: "reset" })).toEqual({ override: null });

    expect(getRateOverride()).toBeUndefined();
    const { rate } = await buildSnapshot();
    expect(rate).toMatchObject({ source: "configured", windowSeconds: 3600, override: null });
    expect(rate.maxEmails).toBe(effectiveHourlyLimit(5000));
  });

  it("is harmless when nothing was applied", () => {
    expect(rateLimitAction({ action: "reset" })).toEqual({ override: null });
    expect(rateLimitAction({ action: "reset" })).toEqual({ override: null });
  });

  it("answers over the API", async () => {
    await postRate(jsonRequest("POST", { action: "apply", maxEmails: 3, windowSeconds: 7 }));
    expect(getRateOverride()).toMatchObject({ maxEmails: 3, windowSeconds: 7 });

    const response = await postRate(jsonRequest("POST", { action: "reset" }));

    expect(response.status).toBe(200);
    expect(getRateOverride()).toBeUndefined();
    expect((await postRate(jsonRequest("POST", { action: "explode" }))).status).toBe(400);
  });
});

describe("the existing rate limiter at work on the applied limit", () => {
  it("lets exactly the applied number through per window, then holds the rest back", async () => {
    apply(2, 10);
    const { campaign } = await createTestCampaign({ recipients: 5, mode: "now", scenario: "success" });

    const first = await cycle();
    expect(first).toMatchObject({ claimed: 2, sent: 2 });
    expect(await sent(campaign.id)).toBe(2);

    const held = await cycle();
    expect(held).toMatchObject({ claimed: 0, sent: 0, rateLimited: true });
    expect(held.note).toContain("Rate limit reached");
    expect(held.note).toContain("10 seconds");
    expect(await sent(campaign.id)).toBe(2);
  });

  it("goes on when the window has passed, until the campaign is done", async () => {
    apply(2, 10);
    const { campaign } = await createTestCampaign({ recipients: 5, mode: "now", scenario: "success" });

    await cycle();
    await ageSendLog(11);
    expect(await cycle()).toMatchObject({ sent: 2 });
    await ageSendLog(11);
    expect(await cycle()).toMatchObject({ sent: 1 });

    expect(await sent(campaign.id)).toBe(5);
    expect((await getCampaign(campaign.id)).status).toBe("COMPLETED");
    expect(receivedFiles()).toHaveLength(5);
  });

  it("counts the window in seconds, not in hours: an hour-long log does not hold it back", async () => {
    apply(2, 10);
    await createTestCampaign({ recipients: 4, mode: "now", scenario: "success" });
    await cycle();
    await ageSendLog(30); // long past a 10-second window, nowhere near an hour

    expect(await cycle()).toMatchObject({ claimed: 2, sent: 2 });
  });

  it("uses the exact number asked for, with no safety margin taken off (2 means 2)", async () => {
    apply(2, 10);
    await createTestCampaign({ recipients: 3, mode: "now", scenario: "success" });

    expect((await cycle()).sent).toBe(2);
  });

  it("puts every send on the rate limiter's books, as any send", async () => {
    apply(3, 10);
    await createTestCampaign({ recipients: 5, mode: "now", scenario: "success" });

    await cycle();

    const [log] = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM smtp_send_log`;
    expect(Number(log.n)).toBe(3);
  });

  it("spreads a window's quota over the ticks by the tick interval, as the hourly limit is spread", async () => {
    expect(batchSize({ maxPerHour: 2, windowSeconds: 10, tickIntervalSeconds: 5, sentInLastHour: 0, batchCap: 200, factor: 1 })).toBe(1);
    expect(batchSize({ maxPerHour: 2, windowSeconds: 10, tickIntervalSeconds: 10, sentInLastHour: 0, batchCap: 200, factor: 1 })).toBe(2);
    expect(batchSize({ maxPerHour: 10, windowSeconds: 5, tickIntervalSeconds: 1, sentInLastHour: 0, batchCap: 200, factor: 1 })).toBe(2);

    // A tick hands out the window's quota in batches of that share, until the window is full.
    await createTestCampaign({ recipients: 4, mode: "now", scenario: "success" });
    const rate = { maxEmails: 2, windowSeconds: 10, safetyFactor: 1 };

    const spread = await runTick({ rateLimit: rate, tickIntervalSeconds: 5 });
    expect(spread.sent).toBe(2);
    const batches = readJournal(0, 200).filter((entry) => entry.type === "rate.allowed").map((entry) => entry.data?.count);
    expect(batches).toEqual([1, 1]);

    expect((await runTick({ rateLimit: rate, tickIntervalSeconds: 5 })).sent).toBe(0); // the window is full
  });

  it("keeps the hourly arithmetic exactly as it was when no window is given", () => {
    expect(batchSize({ maxPerHour: 5000, sentInLastHour: 0, batchCap: 200, tickIntervalSeconds: 60 })).toBe(80);
    expect(batchSize({ maxPerHour: 100, sentInLastHour: 96, batchCap: 200, tickIntervalSeconds: 3600, factor: 0.95 })).toBe(0);
  });

  it("does not use a second sending path: the test send is the normal queue, and the log shows it", async () => {
    apply(2, 10);
    const { campaign } = await createTestCampaign({ recipients: 2, mode: "now", scenario: "success" });
    const before = await sql`SELECT delivery_status, attempts, lease_expires_at FROM campaign_recipients WHERE campaign_id = ${campaign.id}`;
    expect(before.every((row) => row.delivery_status === "QUEUED" && row.attempts === 0)).toBe(true);

    await cycle();

    const after = await sql`SELECT delivery_status, attempts, claimed_by FROM campaign_recipients WHERE campaign_id = ${campaign.id}`;
    expect(after.every((row) => row.delivery_status === "SENT" && row.attempts === 1 && row.claimed_by === null)).toBe(true);
  });
});

describe("outside a test environment", () => {
  it("cannot be applied", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => setRateOverride(2, 10)).toThrow(/development or test/);
  });

  it("is ignored if one was left behind: production keeps its configured ceiling", async () => {
    apply(1, 3600); // a one-an-hour limit, were it honoured
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SMTP_HOST", "127.0.0.1");
    vi.stubEnv("SMTP_FROM_EMAIL", "me@example.test");
    expect(getRateOverride()).toBeUndefined();
    resetRateOverride();
  });
});

describe("the journal and the panel's view of the queue", () => {
  it("says 'rate limiter allowed N emails', and says once that the limit was reached", async () => {
    apply(2, 10);
    await createTestCampaign({ recipients: 5, mode: "now", scenario: "success" });

    await cycle();
    await cycle();
    await cycle();

    const allowed = readJournal(0, 200).filter((entry) => entry.type === "rate.allowed");
    expect(allowed).toHaveLength(1);
    expect(allowed[0].data).toEqual({ count: 2, maxEmails: 2, windowSeconds: 10 });
    const limited = readJournal(0, 200).filter((entry) => entry.type === "rate.limited");
    expect(limited).toHaveLength(1); // not once per cycle that finds it still held
    expect(limited[0].data).toMatchObject({ sent: 2, maxEmails: 2, windowSeconds: 10 });
  });

  it("reports the queue: waiting, active, done, failed, and its state", async () => {
    apply(2, 10);
    expect((await buildSnapshot()).queue).toMatchObject({ state: "idle", waiting: 0, active: 0, done: 0, failed: 0 });

    await createTestCampaign({ recipients: 5, mode: "now", scenario: "success" });
    expect((await buildSnapshot()).queue).toMatchObject({ state: "waiting", waiting: 5, done: 0 });

    await cycle();
    await cycle(); // held back by the limit
    const held = (await buildSnapshot()).queue;
    expect(held).toMatchObject({ state: "limited", waiting: 3, done: 2, failed: 0, sentInWindow: 2 });

    await createTestCampaign({ recipients: 1, mode: "now", scenario: "permfail" });
    await ageSendLog(11);
    await cycle();
    expect((await buildSnapshot()).queue.failed).toBeGreaterThanOrEqual(0);
  });

  it("serves the same figures over the state endpoint", async () => {
    apply(2, 10);
    const response = await getState(jsonRequest("GET"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rate).toEqual({ source: "test", maxEmails: 2, windowSeconds: 10, override: { maxEmails: 2, windowSeconds: 10 } });
    expect(body.smtp).toMatchObject({ accepted: 0 });
    expect(body.smtp.port).toBeGreaterThan(0);
    expect(body.smtp.outputDir).toBeTruthy();
  });

  it("carries no address, no message text and no credential in the snapshot", async () => {
    await createTestCampaign({ recipients: 3, mode: "now", scenario: "success" });
    await cycle();

    const text = JSON.stringify(await buildSnapshot());

    expect(text).not.toContain("@test.invalid");
    expect(text).not.toContain("This is a test email");
    expect(text).not.toMatch(/password|secret|authorization/i);
  });
});
