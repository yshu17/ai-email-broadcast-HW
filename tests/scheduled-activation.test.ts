import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "@/lib/db";
import { activateDueCampaigns } from "@/lib/campaign-activation";
import { claimRecipients } from "@/lib/queue";
import { runTick } from "@/lib/worker";
import { startFakeSmtp, type FakeSmtp } from "./smtp-server";
import {
  addBulkContacts, addContact, countByStatus, createCampaign, createList, getCampaign, resetDatabase, suppress,
} from "./helpers";

/**
 * Scheduled campaigns are activated by the same periodic worker that sends mail.
 * "Time passing" is simulated by moving scheduled_at, because the comparison is
 * made against the database clock (one authority shared by every instance).
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
  await stopFailingInserts();
  await smtp.close();
});

afterAll(async () => { await sql.end(); });

const HOUR = 60 * 60 * 1000;

/** A SCHEDULED campaign with `contacts` recipients, due `dueInMs` from now (negative = overdue). */
async function scheduled(dueInMs: number, contacts = 3, options: { name?: string } = {}) {
  const listId = await createList(options.name ?? "Subscribers");
  await addBulkContacts(listId, contacts, `${Math.random().toString(36).slice(2, 8)}.test`);
  return createCampaign({
    name: options.name,
    listIds: [listId],
    status: "SCHEDULED",
    scheduledAt: new Date(Date.now() + dueInMs),
  });
}

/** Moves a campaign's schedule into the past, as the clock reaching it would. */
async function timePasses(campaignId: string) {
  await sql`UPDATE campaigns SET scheduled_at = now() - interval '1 second' WHERE id = ${campaignId}`;
}

/** Makes inserting one particular recipient fail inside the database, for real. */
async function failInsertsFor(emailNormalized: string) {
  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION test_boom() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'simulated failure for %', NEW.email_normalized; END
    $$ LANGUAGE plpgsql`);
  await sql.unsafe(`DROP TRIGGER IF EXISTS test_boom_trigger ON campaign_recipients`);
  await sql.unsafe(`
    CREATE TRIGGER test_boom_trigger BEFORE INSERT ON campaign_recipients
    FOR EACH ROW WHEN (NEW.email_normalized = '${emailNormalized}') EXECUTE FUNCTION test_boom()`);
}

async function stopFailingInserts() {
  await sql.unsafe(`DROP TRIGGER IF EXISTS test_boom_trigger ON campaign_recipients`);
  await sql.unsafe(`DROP FUNCTION IF EXISTS test_boom()`);
}

async function recipientCount(campaignId: string) {
  const [row] = await sql<{ n: string }[]>`
    SELECT count(*)::text AS n FROM campaign_recipients WHERE campaign_id = ${campaignId}
  `;
  return Number(row.n);
}

describe("activateDueCampaigns", () => {
  it("does not start a campaign before its time", async () => {
    const id = await scheduled(HOUR);

    const result = await activateDueCampaigns();

    expect(result).toMatchObject({ due: 0, activated: 0 });
    expect((await getCampaign(id)).status).toBe("SCHEDULED");
    expect(await recipientCount(id)).toBe(0);
  });

  it("starts the campaign once its time has come: SCHEDULED becomes QUEUED with its recipients", async () => {
    const id = await scheduled(HOUR, 4);
    expect((await activateDueCampaigns()).activated).toBe(0);

    await timePasses(id);
    const result = await activateDueCampaigns();

    expect(result).toMatchObject({ due: 1, activated: 1, failed: 0 });
    const row = await getCampaign(id);
    expect(row.status).toBe("QUEUED");
    expect(row.total_recipients).toBe(4);
    expect(row.scheduled_at).not.toBeNull();
    expect(await countByStatus(id)).toEqual({ QUEUED: 4 });
  });

  it("only looks at SCHEDULED campaigns", async () => {
    for (const status of ["DRAFT", "QUEUED", "SENDING", "PAUSED", "COMPLETED", "CANCELLED"] as const) {
      await createCampaign({ status, scheduledAt: new Date(Date.now() - HOUR) });
    }

    const result = await activateDueCampaigns();

    expect(result.due).toBe(0);
    const rows = await sql<{ status: string }[]>`SELECT status FROM campaigns ORDER BY status`;
    expect(rows.map((r) => r.status).sort()).toEqual(
      ["CANCELLED", "COMPLETED", "DRAFT", "PAUSED", "QUEUED", "SENDING"],
    );
  });

  it("applies the same audience rules as an immediate send", async () => {
    const listA = await createList("A");
    const listB = await createList("B");
    await addContact(listA, "a@example.test");
    await addContact(listA, "shared@example.test");
    await addContact(listB, "shared@example.test");
    await addContact(listB, "gone@example.test");
    await suppress("gone@example.test");
    const id = await createCampaign({
      listIds: [listA, listB], status: "SCHEDULED", scheduledAt: new Date(Date.now() - 1000),
    });

    await activateDueCampaigns();

    expect(await countByStatus(id)).toEqual({ QUEUED: 2 });
    expect((await getCampaign(id)).total_recipients).toBe(2);
  });

  it("picks up a campaign that became overdue while the worker was down, after a restart", async () => {
    const id = await scheduled(-3 * 24 * HOUR);

    // A fresh module graph stands in for a freshly started process: everything
    // it needs to know is in the database.
    vi.resetModules();
    const restarted = await import("@/lib/campaign-activation");
    const result = await restarted.activateDueCampaigns();

    expect(result.activated).toBe(1);
    expect((await getCampaign(id)).status).toBe("QUEUED");
  });

  it("activates the oldest schedules first and honours a batch limit, leaving the rest for the next cycle", async () => {
    const newest = await scheduled(-1_000, 1, { name: "newest" });
    const oldest = await scheduled(-3 * HOUR, 1, { name: "oldest" });
    const middle = await scheduled(-HOUR, 1, { name: "middle" });

    const first = await activateDueCampaigns({ limit: 2 });

    expect(first.records.map((r) => r.campaignId)).toEqual([oldest, middle]);
    expect((await getCampaign(newest)).status).toBe("SCHEDULED");

    expect((await activateDueCampaigns({ limit: 2 })).activated).toBe(1);
    expect((await getCampaign(newest)).status).toBe("QUEUED");
  });

  it("starts nothing once the time budget is spent, leaving campaigns for the next cycle", async () => {
    const id = await scheduled(-1_000);

    const result = await activateDueCampaigns({ deadline: Date.now() - 1 });

    expect(result.activated).toBe(0);
    expect((await getCampaign(id)).status).toBe("SCHEDULED");
  });

  it("cancels a campaign whose audience has vanished instead of retrying it forever", async () => {
    const listId = await createList("Everyone left");
    await addContact(listId, "gone@example.test");
    await suppress("gone@example.test");
    const id = await createCampaign({
      listIds: [listId], status: "SCHEDULED", scheduledAt: new Date(Date.now() - 1000),
    });

    const result = await activateDueCampaigns();

    expect(result).toMatchObject({ due: 1, activated: 0, noRecipients: 1 });
    const row = await getCampaign(id);
    expect(row.status).toBe("CANCELLED");
    expect(row.completed_at).not.toBeNull();
    expect(await recipientCount(id)).toBe(0);
    expect((await activateDueCampaigns()).due).toBe(0);
  });

  it("logs the campaign, the scheduled time, the actual time and the result", async () => {
    const id = await scheduled(-90_000);

    await activateDueCampaigns();

    const log = vi.mocked(console.log).mock.calls.find((call) => String(call[0]).includes("[scheduler]"));
    expect(log).toBeDefined();
    expect(log?.[1]).toMatchObject({
      campaignId: id,
      scheduledAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      activatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      recipients: 3,
    });
    expect((log?.[1] as { lateSeconds: number }).lateSeconds).toBeGreaterThanOrEqual(89);
  });
});

describe("activation never happens twice", () => {
  it("lets exactly one of several simultaneous workers activate a campaign", async () => {
    const id = await scheduled(-1_000, 1_200);

    const results = await Promise.all(Array.from({ length: 5 }, () => activateDueCampaigns()));

    expect(results.reduce((sum, r) => sum + r.activated, 0)).toBe(1);
    expect(await recipientCount(id)).toBe(1_200);
    expect(await countByStatus(id)).toEqual({ QUEUED: 1_200 });
    expect((await getCampaign(id)).status).toBe("QUEUED");
  });

  it("lets exactly one of several simultaneous ticks activate it and none double-send", async () => {
    const id = await scheduled(-1_000, 20);

    const ticks = await Promise.all([1, 2, 3].map(() => runTick({ timeBudgetMs: 10_000 })));

    expect(ticks.reduce((sum, t) => sum + t.activatedCampaigns, 0)).toBe(1);
    expect(smtp.messages).toHaveLength(20);
    expect(new Set(smtp.messages.flatMap((m) => m.to)).size).toBe(20);
    expect((await getCampaign(id)).status).toBe("COMPLETED");
  });

  it("skips, without waiting, a campaign another worker is in the middle of activating", async () => {
    const id = await scheduled(-1_000);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => { locked = resolve; });

    const otherWorker = sql.begin(async (tx) => {
      await tx`SELECT id FROM campaigns WHERE id = ${id} FOR UPDATE`;
      locked();
      await gate;
    });
    await isLocked;

    const result = await activateDueCampaigns();

    expect(result).toMatchObject({ due: 1, activated: 0, skipped: 1, failed: 0 });
    release();
    await otherWorker;
    expect((await getCampaign(id)).status).toBe("SCHEDULED");
    expect((await activateDueCampaigns()).activated).toBe(1);
  });

  it("does not create duplicate jobs when the scheduler runs again", async () => {
    const id = await scheduled(-1_000, 6);

    await activateDueCampaigns();
    const before = await sql`SELECT id, tracking_token FROM campaign_recipients WHERE campaign_id = ${id} ORDER BY id`;
    const again = await activateDueCampaigns();
    const after = await sql`SELECT id, tracking_token FROM campaign_recipients WHERE campaign_id = ${id} ORDER BY id`;

    expect(again).toMatchObject({ due: 0, activated: 0 });
    expect(after).toEqual(before);
    expect(after).toHaveLength(6);
  });
});

describe("a failure never leaves a campaign half-started", () => {
  it("rolls everything back, leaving it SCHEDULED with no recipients, so the next cycle can retry", async () => {
    // 600 contacts are inserted in chunks of 500; the last one fails, after
    // the first chunk has already been written inside the transaction.
    const id = await scheduled(-1_000, 600);
    const [{ email_normalized: last }] = await sql<{ email_normalized: string }[]>`
      SELECT email_normalized FROM contacts ORDER BY created_at DESC LIMIT 1
    `;
    await failInsertsFor(last);

    const failed = await activateDueCampaigns();

    expect(failed).toMatchObject({ due: 1, activated: 0, failed: 1 });
    expect((await getCampaign(id)).status).toBe("SCHEDULED");
    expect(await recipientCount(id)).toBe(0);
    expect((await getCampaign(id)).total_recipients).toBe(0);

    await stopFailingInserts();
    const retried = await activateDueCampaigns();

    expect(retried.activated).toBe(1);
    expect(await recipientCount(id)).toBe(600);
  });

  it("keeps going with the other campaigns when one of them fails", async () => {
    const good1 = await scheduled(-3 * HOUR, 2, { name: "good-1" });
    const bad = await scheduled(-2 * HOUR, 2, { name: "bad" });
    const good2 = await scheduled(-1 * HOUR, 2, { name: "good-2" });
    const [{ email_normalized: victim }] = await sql<{ email_normalized: string }[]>`
      SELECT c.email_normalized FROM campaign_lists cl
      JOIN contact_list_members m ON m.list_id = cl.list_id
      JOIN contacts c ON c.id = m.contact_id
      WHERE cl.campaign_id = ${bad} LIMIT 1
    `;
    await failInsertsFor(victim);

    const result = await activateDueCampaigns();

    expect(result).toMatchObject({ due: 3, activated: 2, failed: 1 });
    expect((await getCampaign(good1)).status).toBe("QUEUED");
    expect((await getCampaign(bad)).status).toBe("SCHEDULED");
    expect((await getCampaign(good2)).status).toBe("QUEUED");
    const errorLog = vi.mocked(console.error).mock.calls.find((c) => String(c[0]).includes("[scheduler]"));
    expect(errorLog?.[1]).toMatchObject({ campaignId: bad });
  });
});

describe("activation feeds the existing queue and rate limiter", () => {
  it("produces ordinary queue rows that the existing claim query picks up", async () => {
    const id = await scheduled(-1_000, 3);
    await activateDueCampaigns();

    const claimed = await claimRecipients("test-worker", 10);

    expect(claimed).toHaveLength(3);
    expect(claimed.every((r) => r.campaignId === id && r.attempts === 1)).toBe(true);
    expect(claimed[0].trackingToken.length).toBeGreaterThanOrEqual(43);
    expect(claimed[0].subject).toBe("Hello {{firstName}}");
  });

  it("does not send anything itself", async () => {
    await scheduled(-1_000, 3);
    await activateDueCampaigns();
    expect(smtp.messages).toHaveLength(0);
  });

  it("runs the whole journey in one tick: SCHEDULED, QUEUED, SENDING, COMPLETED", async () => {
    const id = await scheduled(-1_000, 5);

    const result = await runTick({ timeBudgetMs: 10_000 });

    expect(result).toMatchObject({ activatedCampaigns: 1, claimed: 5, sent: 5, completedCampaigns: 1 });
    expect(smtp.messages).toHaveLength(5);
    const row = await getCampaign(id);
    expect(row.status).toBe("COMPLETED");
    expect(row.started_at).not.toBeNull();
    expect(row.completed_at).not.toBeNull();
  });

  it("does not send a scheduled campaign before its time", async () => {
    const id = await scheduled(HOUR, 5);

    const result = await runTick({ timeBudgetMs: 10_000 });

    expect(result).toMatchObject({ activatedCampaigns: 0, sent: 0 });
    expect(smtp.messages).toHaveLength(0);
    expect((await getCampaign(id)).status).toBe("SCHEDULED");
  });

  it("still obeys the hourly SMTP limit: activation is a start time, not a burst", async () => {
    vi.stubEnv("SMTP_MAX_EMAILS_PER_HOUR", "10");
    const id = await scheduled(-1_000, 20);

    const result = await runTick({ timeBudgetMs: 10_000 });

    // 10/hour with the 0.95 safety factor allows 9.
    expect(result.activatedCampaigns).toBe(1);
    expect(result.sent).toBe(9);
    expect(result.rateLimited).toBe(true);
    expect(smtp.messages).toHaveLength(9);
    expect((await countByStatus(id)).QUEUED).toBe(11);
    expect((await getCampaign(id)).status).toBe("SENDING");
  });

  it("counts a scheduled campaign against the same budget as an immediate one", async () => {
    vi.stubEnv("SMTP_MAX_EMAILS_PER_HOUR", "10");
    const immediate = await createCampaign({ status: "QUEUED" });
    const { addRecipient } = await import("./helpers");
    for (let i = 0; i < 6; i++) await addRecipient(immediate, `now${i}@example.test`);
    await scheduled(-1_000, 20);

    const result = await runTick({ timeBudgetMs: 10_000 });

    expect(result.sent).toBe(9);
    expect(result.rateLimited).toBe(true);
  });

  it("still retries a temporarily failing recipient of a scheduled campaign", async () => {
    const listId = await createList("Flaky");
    await addContact(listId, "flaky@example.test");
    const id = await createCampaign({
      listIds: [listId], status: "SCHEDULED", scheduledAt: new Date(Date.now() - 1000),
    });
    smtp.rejectRecipients.set("flaky@example.test", 451);

    const result = await runTick({ timeBudgetMs: 10_000 });

    expect(result).toMatchObject({ activatedCampaigns: 1, retried: 1, sent: 0 });
    expect((await countByStatus(id)).QUEUED).toBe(1);
  });

  it("activates even when SMTP is not configured, and waits in the queue for it", async () => {
    vi.stubEnv("SMTP_HOST", "");
    const id = await scheduled(-1_000, 3);

    const result = await runTick({ timeBudgetMs: 5_000 });

    expect(result.activatedCampaigns).toBe(1);
    expect(result.sent).toBe(0);
    expect(result.note).toContain("not configured");
    expect((await getCampaign(id)).status).toBe("QUEUED");
    expect((await countByStatus(id)).QUEUED).toBe(3);
  });

  it("is unaffected by a tick that has nothing scheduled", async () => {
    const id = await createCampaign({ status: "QUEUED" });
    const { addRecipient } = await import("./helpers");
    await addRecipient(id, "a@example.test");

    const result = await runTick({ timeBudgetMs: 10_000 });

    expect(result).toMatchObject({ activatedCampaigns: 0, failedActivations: 0, sent: 1 });
  });
});
