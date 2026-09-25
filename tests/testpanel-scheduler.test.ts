import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "@/lib/db";
import { POST as tick } from "@/app/api/worker/tick/route";
import { POST as postScheduler } from "@/app/api/dev/scheduler/route.dev";
import { runSchedulerCycle, schedulerSnapshot, safeErrorMessage } from "@/lib/scheduler";
import { schedulerAction } from "@/lib/testing/actions";
import { testScheduler } from "@/lib/testing/test-scheduler";
import { createCampaign, createList, getCampaign, recipientRows, resetDatabase } from "./helpers";
import { HOUR, addTestContacts, disableTestTools, enableTestTools, jsonRequest } from "./testpanel-helpers";

/**
 * The scheduler cycle as a service, against the real database: Run now runs exactly one,
 * two at once are one, a manual one and an automatic one cannot start a campaign twice,
 * and Stop changes no campaign. The queue underneath is the real one.
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

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ authorization: `Bearer ${process.env.WORKER_SECRET}` }),
  cookies: async () => ({ get: () => undefined }),
}));

/** The real tick, wrapped so a test can hold one open or make one fail. */
const worker = vi.hoisted(() => ({ gate: null as null | Promise<void>, failWith: null as null | Error, calls: 0 }));

vi.mock("@/lib/worker", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/worker")>();
  return {
    ...actual,
    runTick: vi.fn(async (options?: Parameters<typeof actual.runTick>[0]) => {
      worker.calls += 1;
      if (worker.failWith) throw worker.failWith;
      if (worker.gate) await worker.gate;
      return actual.runTick(options);
    }),
  };
});

beforeEach(async () => {
  worker.gate = null;
  worker.failWith = null;
  worker.calls = 0;
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

async function dueCampaign(contacts = 3, status: "SCHEDULED" | "QUEUED" = "SCHEDULED") {
  const listId = await createList(`List ${Math.random()}`);
  await addTestContacts(listId, contacts);
  return createCampaign({
    listIds: [listId], status, scheduledAt: status === "SCHEDULED" ? new Date(Date.now() - 1000) : null,
  });
}

function heldTick() {
  let release!: () => void;
  worker.gate = new Promise<void>((resolve) => { release = () => { worker.gate = null; resolve(); }; });
  return release;
}

describe("Run now", () => {
  it("runs exactly one cycle and reports what it did", async () => {
    const id = await dueCampaign(3);

    const outcome = await schedulerAction({ action: "run" });

    expect(outcome.ran).toBe(true);
    expect(worker.calls).toBe(1);
    expect(schedulerSnapshot().cycles).toBe(1);
    expect(outcome.report).toMatchObject({ source: "run-now", error: null });
    expect(outcome.report?.result).toMatchObject({ dueCampaigns: 1, activatedCampaigns: 1 });
    expect((await getCampaign(id)).status).not.toBe("SCHEDULED");
  });

  it("does not send mail itself: the campaign goes to the queue and the queue sends, through the rate limiter's log", async () => {
    const id = await dueCampaign(3);

    const outcome = await schedulerAction({ action: "run" });

    // What was sent was sent by the queue, and every send is on the rate limiter's books.
    const sent = outcome.report?.result?.sent ?? 0;
    const [log] = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM smtp_send_log`;
    expect(Number(log.n)).toBe(sent);
    expect((await recipientRows(id)).filter((row) => row.delivery_status === "SENT")).toHaveLength(sent);
  });

  it("is refused while a cycle is already running, and does nothing", async () => {
    const release = heldTick();
    const first = testScheduler.runNow();
    await vi.waitFor(() => expect(worker.calls).toBe(1));

    const second = await testScheduler.runNow();
    const third = await testScheduler.runNow();

    expect(second).toEqual({ ran: false, reason: "busy" });
    expect(third).toEqual({ ran: false, reason: "busy" });
    expect(worker.calls).toBe(1);

    release();
    expect((await first).ran).toBe(true);
    expect(schedulerSnapshot()).toMatchObject({ cycles: 1, cycleInFlight: false });
  });

  it("can run again as soon as the cycle has finished", async () => {
    await testScheduler.runNow();
    const again = await testScheduler.runNow();
    expect(again.ran).toBe(true);
    expect(schedulerSnapshot().cycles).toBe(2);
  });

  it("many presses at once are one cycle", async () => {
    const release = heldTick();

    const presses = Promise.all(Array.from({ length: 8 }, () => testScheduler.runNow()));
    await vi.waitFor(() => expect(worker.calls).toBe(1));
    release();
    const outcomes = await presses;

    expect(outcomes.filter((outcome) => outcome.ran)).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome.ran)).toHaveLength(7);
    expect(worker.calls).toBe(1);
  });

  it("never starts a campaign twice, however a manual and an automatic cycle overlap", async () => {
    const id = await dueCampaign(5);

    const [manual, loop, external] = await Promise.all([
      runSchedulerCycle("run-now"), runSchedulerCycle("panel-loop"), runSchedulerCycle("worker").catch(() => null),
    ]);

    const activated = [manual, loop, external].reduce(
      (sum, outcome) => sum + (outcome && outcome.ran ? outcome.report.result?.activatedCampaigns ?? 0 : 0), 0);
    expect(activated).toBe(1);
    const rows = await recipientRows(id);
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((row) => row.email_normalized)).size).toBe(5);
  });

  it("does not create duplicate queue rows across repeated cycles", async () => {
    const id = await dueCampaign(4);

    for (let i = 0; i < 4; i += 1) await testScheduler.runNow();

    expect(await recipientRows(id)).toHaveLength(4);
  });

  it("reports a failed cycle without a credential in it, and can run again", async () => {
    worker.failWith = new Error('connect failed to postgres://mailer:hunter2@db.internal:5432/mailer, password "hunter2"');

    const outcome = await testScheduler.runNow();

    expect(outcome.ran).toBe(true);
    const report = outcome.ran ? outcome.report : null;
    expect(report?.result).toBeNull();
    expect(report?.error).toBeTruthy();
    expect(report?.error).not.toContain("hunter2");
    expect(report?.error).not.toContain("postgres://mailer");
    expect(schedulerSnapshot().last?.error).toBe(report?.error);
    expect(schedulerSnapshot().cycleInFlight).toBe(false);

    worker.failWith = null;
    expect((await testScheduler.runNow()).ran).toBe(true);
  });

  it("answers over the API like the panel's button does", async () => {
    await dueCampaign(2);

    const response = await postScheduler(jsonRequest("POST", { action: "run" }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ran: true, reason: null });
    expect(body.report.result.dueCampaigns).toBe(1);
    expect(body.snapshot).toMatchObject({ running: false, cycles: 1 });
  });

  it("says why when nothing ran", async () => {
    const release = heldTick();
    const first = testScheduler.runNow();
    await vi.waitFor(() => expect(worker.calls).toBe(1));

    const body = await (await postScheduler(jsonRequest("POST", { action: "run" }))).json();

    expect(body).toMatchObject({ ran: false, reason: "busy", report: null });
    release();
    await first;
  });
});

describe("Stop", () => {
  it("changes no campaign's status and leaves the queue as it is", async () => {
    const scheduled = await dueCampaign(2, "SCHEDULED");
    await sql`UPDATE campaigns SET scheduled_at = now() + interval '1 hour' WHERE id = ${scheduled}`;
    const queued = await dueCampaign(2, "QUEUED");
    const draft = await createCampaign({ status: "DRAFT" });
    const before = await sql`SELECT id, status, scheduled_at, updated_at FROM campaigns ORDER BY id`;
    const rowsBefore = await sql`SELECT count(*)::int AS n FROM campaign_recipients`;

    testScheduler.start();
    await vi.waitFor(() => expect(schedulerSnapshot().cycles).toBeGreaterThanOrEqual(1));
    await vi.waitFor(() => expect(schedulerSnapshot().cycleInFlight).toBe(false));
    testScheduler.stop();

    const after = await sql`SELECT id, status, scheduled_at, updated_at FROM campaigns ORDER BY id`;
    expect(after).toEqual(before);
    expect((await sql`SELECT count(*)::int AS n FROM campaign_recipients`)).toEqual(rowsBefore);
    expect([scheduled, queued, draft].every(Boolean)).toBe(true);
  });

  it("means no cycles at all: a campaign that comes due while stopped is not started", async () => {
    const id = await dueCampaign(2);
    testScheduler.stop();

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect((await getCampaign(id)).status).toBe("SCHEDULED");
    expect(worker.calls).toBe(0);
  });

  it("...until Start, which finds it in the database and starts it", async () => {
    const id = await dueCampaign(2);

    testScheduler.start();
    await vi.waitFor(async () => expect((await getCampaign(id)).status).not.toBe("SCHEDULED"), { timeout: 5000 });

    testScheduler.stop();
  });

  it("does not stop Run now: an explicit cycle is what Stop leaves available", async () => {
    const id = await dueCampaign(2);
    testScheduler.stop();

    await testScheduler.runNow();

    expect((await getCampaign(id)).status).not.toBe("SCHEDULED");
  });
});

describe("the worker endpoint while the panel is on", () => {
  it("answers 'skipped' and runs nothing while the test scheduler is stopped", async () => {
    const id = await dueCampaign(2);

    const response = await tick();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, skipped: "stopped" });
    expect(worker.calls).toBe(0);
    expect((await getCampaign(id)).status).toBe("SCHEDULED");
  });

  it("runs a cycle, through the same service, while the test scheduler is running", async () => {
    testScheduler.start();
    await vi.waitFor(() => expect(worker.calls).toBeGreaterThanOrEqual(1));
    await vi.waitFor(() => expect(schedulerSnapshot().cycleInFlight).toBe(false));
    const id = await dueCampaign(2);

    const response = await tick();
    const body = await response.json();

    // Either it ran, or the loop's own cycle happened to be running at that instant.
    if (body.skipped) expect(body).toEqual({ ok: true, skipped: "busy" });
    else expect(body).toMatchObject({ dueCampaigns: expect.any(Number), activatedCampaigns: expect.any(Number) });
    await testScheduler.runNow();
    expect((await getCampaign(id)).status).not.toBe("SCHEDULED");
    testScheduler.stop();
  });

  it("is untouched in production: a tick runs whether or not the test scheduler was ever started", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const id = await dueCampaign(2);

    const response = await tick();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).not.toHaveProperty("skipped");
    expect(body).toMatchObject({ dueCampaigns: 1, activatedCampaigns: 1 });
    expect((await getCampaign(id)).status).not.toBe("SCHEDULED");
  });

  it("lets ticks overlap in production, as it always did (the database's locks keep that safe)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const id = await dueCampaign(3);
    const release = heldTick();

    const first = tick();
    const second = tick();
    await vi.waitFor(() => expect(worker.calls).toBe(2));
    release();
    const bodies = await Promise.all([first, second].map(async (response) => (await response).json()));

    expect(bodies.every((body) => !("skipped" in body))).toBe(true);
    expect(bodies.reduce((sum, body) => sum + body.activatedCampaigns, 0)).toBe(1);
    expect(await recipientRows(id)).toHaveLength(3);
  });

  it("still answers a failed tick with a 500 and the reason, as before", async () => {
    vi.stubEnv("NODE_ENV", "production");
    worker.failWith = new Error("database is down");

    const response = await tick();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "database is down" });
  });
});

describe("what a cycle report may contain", () => {
  it("has no connection strings or passwords in a failure message", () => {
    expect(safeErrorMessage(new Error("could not connect to postgres://user:secret@host/db"))).not.toContain("secret");
    expect(safeErrorMessage(new Error('password: "abc123" rejected'))).not.toContain("abc123");
    expect(safeErrorMessage(new Error("x".repeat(1000))).length).toBeLessThanOrEqual(300);
    expect(safeErrorMessage("plain text")).toBe("plain text");
  });

  it("is time-stamped in real time and carries the time the rules saw", async () => {
    const outcome = await testScheduler.runNow();
    const report = outcome.ran ? outcome.report : null;
    expect(report).not.toBeNull();
    expect(Math.abs(new Date(report!.startedAt).getTime() - Date.now())).toBeLessThan(HOUR);
    expect(new Date(report!.finishedAt).getTime()).toBeGreaterThanOrEqual(new Date(report!.startedAt).getTime());
    expect(report!.simulatedClock).toBe(false);
  });
});
