import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "@/lib/db";
import { activateDueCampaigns } from "@/lib/campaign-activation";
import { runTick } from "@/lib/worker";
import { startFakeSmtp, type FakeSmtp } from "./smtp-server";
import {
  addBulkContacts, addContact, addRecipient, countByStatus, createCampaign, createList, getCampaign,
  recipientRows, resetDatabase, restartProcess,
} from "./helpers";

/**
 * A scheduled campaign across restarts, missed times and recovery. A "restart" here
 * closes the app's database pool and opens a new one: nothing survives but the
 * database, which is what a real restart leaves. Time passes by moving
 * scheduled_at, so no test waits; real processes are in scheduler-processes.test.ts.
 */
let smtp: FakeSmtp;

beforeEach(async () => {
  await resetDatabase();
  smtp = await startFakeSmtp();
  vi.stubEnv("SMTP_HOST", "127.0.0.1");
  vi.stubEnv("SMTP_PORT", String(smtp.port));
  vi.stubEnv("SMTP_SECURITY", "none");
  vi.stubEnv("SMTP_USER", "tester");
  vi.stubEnv("SMTP_PASSWORD", "secret");
  vi.stubEnv("SMTP_FROM_EMAIL", "sender@example.test");
  vi.stubEnv("SMTP_MAX_EMAILS_PER_HOUR", "5000");
  vi.stubEnv("WORKER_TICK_INTERVAL_SECONDS", "3600");
  vi.stubEnv("WORKER_BATCH_CAP", "50");
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await sql.unsafe(`DROP TRIGGER IF EXISTS test_fail_trigger ON campaign_recipients`);
  await sql.unsafe(`DROP FUNCTION IF EXISTS test_fail()`);
  await smtp.close();
});

afterAll(async () => { await sql.end(); });

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const rand = () => Math.random().toString(36).slice(2, 8);

async function scheduled(dueInMs: number, contacts = 3, name = "Scheduled") {
  const listId = await createList(`${name} ${rand()}`);
  await addBulkContacts(listId, contacts, `${rand()}.test`);
  return createCampaign({
    name, listIds: [listId], status: "SCHEDULED", scheduledAt: new Date(Date.now() + dueInMs),
  });
}

/** The moment arrives: scheduled_at is brought back to "a second ago". */
async function dueNow(campaignId: string) {
  await sql`UPDATE campaigns SET scheduled_at = now() - interval '1 second' WHERE id = ${campaignId}`;
}

async function hourPasses() {
  await sql`UPDATE smtp_send_log SET occurred_at = occurred_at - interval '2 hours'`;
}

function logged(kind: "log" | "error", prefix: string) {
  return (console[kind] as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((c) => c[0] === prefix);
}

describe("the schedule survives a restart", () => {
  it("keeps the campaign SCHEDULED with its scheduledAt, however many times the app restarts", async () => {
    const id = await scheduled(5 * HOUR);
    const before = await getCampaign(id);

    for (let restart = 0; restart < 3; restart += 1) {
      await restartProcess();
      await runTick({ timeBudgetMs: 5_000 }); // a worker cycle that finds nothing due
      expect(await getCampaign(id)).toEqual(before);
    }
    expect(smtp.messages).toHaveLength(0);
  });

  it("starts a campaign that was scheduled for the future at its time, after restarts in between", async () => {
    const id = await scheduled(2 * HOUR, 4);

    await restartProcess();
    expect((await runTick({ timeBudgetMs: 5_000 })).activatedCampaigns).toBe(0);
    expect((await getCampaign(id)).status).toBe("SCHEDULED");

    await restartProcess();
    await dueNow(id); // the time comes while the app is up again
    const tick = await runTick({ timeBudgetMs: 10_000 });

    expect(tick).toMatchObject({ activatedCampaigns: 1, sent: 4 });
    expect((await getCampaign(id)).status).toBe("COMPLETED");
    expect(smtp.messages).toHaveLength(4);
  });

  it("does not need anything in memory: a brand-new pool and fresh modules see the same schedule", async () => {
    const id = await scheduled(-HOUR, 2);
    await restartProcess();
    vi.resetModules();
    const fresh = await import("@/lib/campaign-activation");

    expect((await fresh.activateDueCampaigns()).activated).toBe(1);
    expect((await getCampaign(id)).status).toBe("QUEUED");
  });
});

describe("a campaign whose time passed while nothing was running", () => {
  it("is started by the first cycle after the app is back, however late", async () => {
    // Due at 10:00; the server was down from 09:50 to 10:15 — and, here, much longer.
    const id = await scheduled(-3 * DAY, 5);
    await restartProcess();

    const tick = await runTick({ timeBudgetMs: 10_000 });

    expect(tick).toMatchObject({ activatedCampaigns: 1, sent: 5 });
    expect((await getCampaign(id)).status).toBe("COMPLETED");
  });

  it("records when it was due, when it really started and how late that was", async () => {
    const id = await scheduled(-25 * MINUTE, 2);
    await restartProcess();
    const before = Date.now();

    await activateDueCampaigns();

    const [line] = logged("log", "[scheduler] activated campaign");
    expect(line).toBeDefined();
    const details = line[1] as { campaignId: string; scheduledAt: string; activatedAt: string; lateSeconds: number; recipients: number };
    expect(details.campaignId).toBe(id);
    expect(new Date(details.scheduledAt).getTime()).toBeLessThan(before - 24 * MINUTE);
    expect(new Date(details.activatedAt).getTime()).toBeGreaterThanOrEqual(before);
    expect(details.lateSeconds).toBeGreaterThanOrEqual(25 * 60);
    expect(details.lateSeconds).toBeLessThan(26 * 60);
    expect(details.recipients).toBe(2);
  });

  it("starts several overdue campaigns, oldest schedule first, each on its own", async () => {
    const ids = [
      await scheduled(-40 * MINUTE, 2, "third"),
      await scheduled(-2 * DAY, 2, "first"),
      await scheduled(-3 * HOUR, 2, "second"),
    ];
    const [third, first, second] = ids;
    await restartProcess();

    const result = await activateDueCampaigns();

    expect(result).toMatchObject({ due: 3, activated: 3, failed: 0 });
    expect(result.records.map((r) => r.campaignId)).toEqual([first, second, third]);
    for (const id of ids) expect(await countByStatus(id)).toEqual({ QUEUED: 2 });
  });

  it("leaves campaigns that are not SCHEDULED alone, however overdue their old schedule looks", async () => {
    const overdue = new Date(Date.now() - 2 * HOUR);
    const cancelled = await createCampaign({ name: "cancelled", status: "CANCELLED", scheduledAt: overdue });
    const completed = await createCampaign({ name: "completed", status: "COMPLETED", scheduledAt: overdue });
    const sending = await createCampaign({ name: "sending", status: "SENDING", scheduledAt: overdue });
    const queued = await createCampaign({ name: "queued", status: "QUEUED", scheduledAt: overdue });
    await addRecipient(queued, "q@example.test");
    const draft = await createCampaign({ name: "draft", status: "DRAFT" });
    const due = await scheduled(-HOUR, 2, "due");
    const before = await Promise.all([cancelled, completed, sending, queued, draft].map(getCampaign));
    await restartProcess();

    const result = await activateDueCampaigns();

    expect(result).toMatchObject({ due: 1, activated: 1 });
    expect(await Promise.all([cancelled, completed, sending, queued, draft].map(getCampaign))).toEqual(before);
    expect(await countByStatus(queued)).toEqual({ QUEUED: 1 });
    expect((await getCampaign(due)).status).toBe("QUEUED");
  });

  it("carries on with the others when one of them cannot be started, and retries it next cycle", async () => {
    const list = await createList("poison");
    await addContact(list, "poison@example.test");
    const poisoned = await createCampaign({
      name: "poisoned", listIds: [list], status: "SCHEDULED", scheduledAt: new Date(Date.now() - 3 * HOUR),
    });
    const fine = await scheduled(-HOUR, 2, "fine");
    await sql.unsafe(`
      CREATE OR REPLACE FUNCTION test_fail() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'simulated failure'; END $$ LANGUAGE plpgsql`);
    await sql.unsafe(`
      CREATE TRIGGER test_fail_trigger BEFORE INSERT ON campaign_recipients
      FOR EACH ROW WHEN (NEW.email_normalized = 'poison@example.test') EXECUTE FUNCTION test_fail()`);
    await restartProcess();

    const result = await activateDueCampaigns();

    expect(result).toMatchObject({ activated: 1, failed: 1 });
    expect((await getCampaign(poisoned)).status).toBe("SCHEDULED");
    expect((await getCampaign(fine)).status).toBe("QUEUED");
    expect(logged("error", "[scheduler] activation failed; will retry on the next cycle")).toHaveLength(1);

    await sql.unsafe(`DROP TRIGGER test_fail_trigger ON campaign_recipients`);
    expect((await activateDueCampaigns()).activated).toBe(1);
    expect((await getCampaign(poisoned)).status).toBe("QUEUED");
  });
});

describe("a campaign is never started twice, or sent twice, however often the app restarts", () => {
  it("survives a restart between every step of its life", async () => {
    const id = await scheduled(-HOUR, 8);
    let activations = 0;
    let sent = 0;

    for (let restart = 0; restart < 5; restart += 1) {
      await restartProcess();
      const tick = await runTick({ timeBudgetMs: 10_000 });
      activations += tick.activatedCampaigns;
      sent += tick.sent;
    }

    expect(activations).toBe(1);
    expect(sent).toBe(8);
    const recipients = smtp.messages.flatMap((m) => m.to);
    expect(recipients).toHaveLength(8);
    expect(new Set(recipients).size).toBe(8);
    expect((await recipientRows(id))).toHaveLength(8);
    expect((await getCampaign(id)).status).toBe("COMPLETED");
  });

  it("does not start it again if the status change is somehow repeated after its mail was sent", async () => {
    const id = await scheduled(-HOUR, 4);
    await runTick({ timeBudgetMs: 10_000 });
    expect(smtp.messages).toHaveLength(4);
    // Forced back to SCHEDULED and due, as by a bad manual repair or a restored backup.
    await sql`UPDATE campaigns SET status = 'SCHEDULED', completed_at = NULL WHERE id = ${id}`;
    await restartProcess();

    await runTick({ timeBudgetMs: 10_000 });

    // The queue rows are still there and still SENT: nobody is emailed a second time,
    // and the campaign, whose queue is all done, is closed again rather than left QUEUED.
    expect(smtp.messages).toHaveLength(4);
    expect(await countByStatus(id)).toEqual({ SENT: 4 });
    expect((await getCampaign(id)).status).toBe("COMPLETED");
  });
});

describe("recovering does not get round the rate limit", () => {
  it("serves the oldest overdue campaign first and stays within the hourly budget", async () => {
    vi.stubEnv("SMTP_MAX_EMAILS_PER_HOUR", "10"); // allows 9 an hour with the 0.95 safety factor
    const oldest = await scheduled(-3 * DAY, 10, "oldest");
    const middle = await scheduled(-2 * HOUR, 10, "middle");
    const newest = await scheduled(-10 * MINUTE, 10, "newest");
    await restartProcess();

    const tick = await runTick({ timeBudgetMs: 10_000 });

    // All three start at once; only the budget's worth is sent, all of it from the oldest.
    expect(tick).toMatchObject({ activatedCampaigns: 3, sent: 9, rateLimited: true });
    expect(await countByStatus(oldest)).toEqual({ SENT: 9, QUEUED: 1 });
    expect(await countByStatus(middle)).toEqual({ QUEUED: 10 });
    expect(await countByStatus(newest)).toEqual({ QUEUED: 10 });

    // The next hour continues in the same order.
    await hourPasses();
    const next = await runTick({ timeBudgetMs: 10_000 });
    expect(next.sent).toBe(9);
    expect(await countByStatus(oldest)).toEqual({ SENT: 10 });
    expect((await countByStatus(middle)).SENT).toBe(8);
    expect(await countByStatus(newest)).toEqual({ QUEUED: 10 });
  });

  it("counts the mail of every recovered campaign against one shared budget", async () => {
    vi.stubEnv("SMTP_MAX_EMAILS_PER_HOUR", "10");
    await scheduled(-2 * HOUR, 6, "a");
    await scheduled(-HOUR, 6, "b");
    await restartProcess();

    const tick = await runTick({ timeBudgetMs: 10_000 });

    expect(tick.sent).toBe(9);
    expect(smtp.messages).toHaveLength(9);
    const [{ n }] = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM smtp_send_log`;
    expect(Number(n)).toBe(9);
  });
});

describe("when the SMTP server is unreachable", () => {
  it("still starts the campaign, keeps its queue, and never reports it COMPLETED", async () => {
    const id = await scheduled(-HOUR, 3);
    const deadPort = smtp.port;
    await smtp.close();
    vi.stubEnv("SMTP_PORT", String(deadPort)); // nothing listens there any more
    await restartProcess();

    const tick = await runTick({ timeBudgetMs: 10_000 });

    expect(tick.activatedCampaigns).toBe(1);
    expect(tick.sent).toBe(0);
    expect(tick.note).toMatch(/transport failure/i);
    const row = await getCampaign(id);
    expect(["QUEUED", "SENDING"]).toContain(row.status as string);
    expect(await countByStatus(id)).toEqual({ QUEUED: 3 });
    // The attempts were handed back, so the outage used up neither retries nor quota.
    const rows = await recipientRows(id);
    expect(rows.every((r) => r.attempts === 0)).toBe(true);
    const [{ n }] = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM smtp_send_log`;
    expect(Number(n)).toBe(0);

    // The server comes back: the very same queue is sent, once.
    smtp = await startFakeSmtp();
    vi.stubEnv("SMTP_PORT", String(smtp.port));
    const after = await runTick({ timeBudgetMs: 10_000 });

    expect(after.sent).toBe(3);
    expect(smtp.messages).toHaveLength(3);
    expect((await getCampaign(id)).status).toBe("COMPLETED");
  });
});
