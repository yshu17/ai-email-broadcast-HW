import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "@/lib/db";
import { activateDueCampaigns, recoverStuckCampaigns } from "@/lib/campaign-activation";
import { finalizeCompletedCampaigns } from "@/lib/queue";
import { runTick } from "@/lib/worker";
import { startFakeSmtp, type FakeSmtp } from "./smtp-server";
import {
  addBulkContacts, addContact, addRecipient, countByStatus, createCampaign, createList, getCampaign,
  recipientRows, resetDatabase, restartProcess, withDatabaseDown,
} from "./helpers";

/**
 * Where a campaign could be lost or stuck between "it is time" and "its mail is in
 * the queue". Real Postgres, a real in-process fake SMTP server; time is simulated
 * by moving scheduled_at / updated_at, so nothing waits.
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

const HOUR = 60 * 60 * 1000;
const rand = () => Math.random().toString(36).slice(2, 8);

async function audienceOf(contacts: number, name = "Subscribers") {
  const listId = await createList(`${name} ${rand()}`);
  await addBulkContacts(listId, contacts, `${rand()}.test`);
  return listId;
}

async function scheduled(dueInMs: number, contacts = 2, name = "Scheduled") {
  return createCampaign({
    name, listIds: [await audienceOf(contacts, name)], status: "SCHEDULED",
    scheduledAt: new Date(Date.now() + dueInMs),
  });
}

/** A QUEUED campaign nothing was ever queued for — what a crash between the two writes used to leave. */
async function queuedWithNothing(contacts: number, ageMinutes = 30, name = "Stuck") {
  const id = await createCampaign({ name, listIds: contacts > 0 ? [await audienceOf(contacts, name)] : [], status: "QUEUED" });
  await sql`UPDATE campaigns SET updated_at = now() - (${ageMinutes} * interval '1 minute') WHERE id = ${id}`;
  return id;
}

/** Makes inserting a recipient fail in the database, with the given SQLSTATE. */
async function failInsertsWith(errcode: string, emailPrefix = "") {
  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION test_fail() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'simulated failure' USING ERRCODE = '${errcode}'; END
    $$ LANGUAGE plpgsql`);
  await sql.unsafe(`DROP TRIGGER IF EXISTS test_fail_trigger ON campaign_recipients`);
  await sql.unsafe(`
    CREATE TRIGGER test_fail_trigger BEFORE INSERT ON campaign_recipients
    FOR EACH ROW WHEN (NEW.email_normalized LIKE '${emailPrefix}%') EXECUTE FUNCTION test_fail()`);
}

async function stopFailingInserts() {
  await sql.unsafe(`DROP TRIGGER IF EXISTS test_fail_trigger ON campaign_recipients`);
}

describe("a campaign stuck QUEUED without any recipients", () => {
  it("is found and given its queue, once it has been stuck longer than the grace period", async () => {
    const id = await queuedWithNothing(3);

    const result = await recoverStuckCampaigns();

    expect(result).toMatchObject({ found: 1, recovered: 1, cancelled: 0, failed: 0 });
    expect(await countByStatus(id)).toEqual({ QUEUED: 3 });
    const row = await getCampaign(id);
    expect(row.status).toBe("QUEUED");
    expect(row.total_recipients).toBe(3);
  });

  it("then sends like any other campaign, in the same tick", async () => {
    const id = await queuedWithNothing(3);

    const tick = await runTick({ timeBudgetMs: 10_000 });

    expect(tick.recoveredCampaigns).toBe(1);
    expect(smtp.messages).toHaveLength(3);
    expect((await getCampaign(id)).status).toBe("COMPLETED");
  });

  it("is left alone while it is young: it may be a request that is still writing its queue", async () => {
    const id = await queuedWithNothing(3, 0);

    const result = await recoverStuckCampaigns();

    expect(result.found).toBe(0);
    expect(await countByStatus(id)).toEqual({});
  });

  it("honours a configured grace period", async () => {
    const id = await queuedWithNothing(2, 10);
    vi.stubEnv("STUCK_CAMPAIGN_GRACE_SECONDS", "3600");
    expect((await recoverStuckCampaigns()).found).toBe(0);

    vi.stubEnv("STUCK_CAMPAIGN_GRACE_SECONDS", "60");
    expect((await recoverStuckCampaigns()).recovered).toBe(1);
    expect(await countByStatus(id)).toEqual({ QUEUED: 2 });
  });

  it("is cancelled, not completed, when its audience has gone: it sent nothing and must not claim to have", async () => {
    const listId = await createList("Gone");
    await addContact(listId, "gone@example.test");
    await sql`INSERT INTO suppressions (email, email_normalized, reason) VALUES ('gone@example.test','gone@example.test','UNSUBSCRIBED')`;
    const id = await createCampaign({ listIds: [listId], status: "QUEUED" });
    await sql`UPDATE campaigns SET updated_at = now() - interval '30 minutes' WHERE id = ${id}`;

    const result = await recoverStuckCampaigns();

    expect(result).toMatchObject({ found: 1, recovered: 0, cancelled: 1 });
    const row = await getCampaign(id);
    expect(row.status).toBe("CANCELLED");
    expect(await countByStatus(id)).toEqual({});
  });

  it("never touches a campaign that has a queue, however old", async () => {
    const id = await createCampaign({ status: "QUEUED" });
    await addRecipient(id, "a@example.test");
    await sql`UPDATE campaigns SET updated_at = now() - interval '1 day' WHERE id = ${id}`;

    expect((await recoverStuckCampaigns()).found).toBe(0);
    expect(await countByStatus(id)).toEqual({ QUEUED: 1 });
  });

  it("only looks at QUEUED campaigns", async () => {
    for (const status of ["DRAFT", "SCHEDULED", "SENDING", "PAUSED", "COMPLETED", "CANCELLED"] as const) {
      const id = await createCampaign({
        status, listIds: [await audienceOf(2)], scheduledAt: status === "SCHEDULED" ? new Date(Date.now() + HOUR) : null,
      });
      await sql`UPDATE campaigns SET updated_at = now() - interval '1 day' WHERE id = ${id}`;
    }

    expect((await recoverStuckCampaigns()).found).toBe(0);
  });

  it("is safe to run in several places at once: the queue is written exactly once", async () => {
    const id = await queuedWithNothing(40);

    const results = await Promise.all(Array.from({ length: 4 }, () => recoverStuckCampaigns()));

    expect(results.reduce((sum, r) => sum + r.recovered, 0)).toBe(1);
    expect(await countByStatus(id)).toEqual({ QUEUED: 40 });
    expect((await getCampaign(id)).total_recipients).toBe(40);
  });

  it("is safe to run again: a recovered campaign is not recovered twice", async () => {
    const id = await queuedWithNothing(3);
    await recoverStuckCampaigns();
    await sql`UPDATE campaigns SET updated_at = now() - interval '1 hour' WHERE id = ${id}`;

    const again = await recoverStuckCampaigns();

    expect(again.found).toBe(0);
    expect(await countByStatus(id)).toEqual({ QUEUED: 3 });
  });

  it("does not stop the tick, or the other campaigns, when recovery itself fails", async () => {
    const stuck = await queuedWithNothing(2, 30, "Stuck");
    const fine = await createCampaign({ status: "QUEUED", name: "Fine" });
    await addRecipient(fine, "ok@example.test");
    await failInsertsWith("P0001", "u");

    const tick = await runTick({ timeBudgetMs: 10_000 });

    expect(tick.recoveredCampaigns).toBe(0);
    expect(smtp.messages.map((m) => m.to.join())).toEqual(["ok@example.test"]);
    expect((await getCampaign(fine)).status).toBe("COMPLETED");
    // The stuck one is untouched, and will be retried next tick.
    expect((await getCampaign(stuck)).status).toBe("QUEUED");
    expect(await countByStatus(stuck)).toEqual({});
  });

  it("is what the completion sweep must never mistake for a finished campaign", async () => {
    const id = await queuedWithNothing(0, 30);

    expect(await finalizeCompletedCampaigns()).toBe(0);
    expect((await getCampaign(id)).status).toBe("QUEUED");
  });
});

describe("when the database is unreachable or drops the connection", () => {
  it("leaves every scheduled campaign exactly as it was, and reports the cycle as failed rather than throwing", async () => {
    const id = await scheduled(-3 * HOUR);
    const before = await getCampaign(id);

    const result = await withDatabaseDown(() => activateDueCampaigns());

    expect(result).toMatchObject({ due: 0, activated: 0, failed: 1 });
    expect(await getCampaign(id)).toEqual(before);
  });

  it("makes the whole tick fail loudly, so the ticker retries, instead of pretending it worked", async () => {
    await scheduled(-HOUR);

    await expect(withDatabaseDown(() => runTick({ timeBudgetMs: 5_000 }))).rejects.toThrow();
    expect(smtp.messages).toHaveLength(0);
  });

  it("picks the campaign up on the next cycle once the database is back", async () => {
    const id = await scheduled(-HOUR, 3);
    await withDatabaseDown(() => activateDueCampaigns());

    const result = await activateDueCampaigns();

    expect(result).toMatchObject({ due: 1, activated: 1 });
    expect(await countByStatus(id)).toEqual({ QUEUED: 3 });
  });

  it("never marks a scheduled or queued campaign COMPLETED because a tick could not reach the database", async () => {
    const waiting = await scheduled(-HOUR);
    const queued = await createCampaign({ status: "QUEUED" });
    await addRecipient(queued, "q@example.test");

    await withDatabaseDown(() => runTick({ timeBudgetMs: 5_000 })).catch(() => undefined);

    expect((await getCampaign(waiting)).status).toBe("SCHEDULED");
    expect((await getCampaign(queued)).status).toBe("QUEUED");
    expect(await countByStatus(queued)).toEqual({ QUEUED: 1 });
  });

  it("copes with every connection being cut, as when Postgres restarts, and carries on afterwards", async () => {
    const id = await scheduled(-HOUR, 3);
    // A warm pool, so there are connections to cut.
    await Promise.all(Array.from({ length: 5 }, () => sql`SELECT pg_sleep(0.05)`));
    await sql`
      SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid()
    `;

    // The driver reports each dead pooled connection once (CONNECTION_CLOSED) and then reconnects,
    // so the first cycles after a restart can fail. None may throw or leave a campaign half-started,
    // and a later cycle must get through.
    let activated = 0;
    for (let cycle = 0; cycle < 8 && activated === 0; cycle += 1) {
      activated += (await activateDueCampaigns()).activated;
    }

    expect(activated).toBe(1);
    expect((await getCampaign(id)).status).toBe("QUEUED");
    expect(await countByStatus(id)).toEqual({ QUEUED: 3 });
    await restartProcess(); // do not leave a pool that is still reconnecting behind
  });

  it("stops a cycle at the first sign the database is gone, rather than trying every campaign against it", async () => {
    const oldest = await scheduled(-3 * HOUR, 1, "aaa");
    const middle = await scheduled(-2 * HOUR, 1, "bbb");
    const newest = await scheduled(-HOUR, 1, "ccc");
    await failInsertsWith("57P01"); // admin_shutdown: "terminating connection due to administrator command"

    const result = await activateDueCampaigns();

    expect(result).toMatchObject({ due: 3, activated: 0, failed: 1, connectionLost: true });
    expect(result.records).toHaveLength(1);
    for (const id of [oldest, middle, newest]) {
      const row = await getCampaign(id);
      expect(row.status).toBe("SCHEDULED");
      expect(row.scheduled_at).not.toBeNull();
    }

    // Everything comes back on the next cycle, oldest first.
    await stopFailingInserts();
    const next = await activateDueCampaigns();
    expect(next.records.map((r) => r.campaignId)).toEqual([oldest, middle, newest]);
    expect(next.activated).toBe(3);
  });

  it("keeps going past an ordinary failure, which is one campaign's problem and not the database's", async () => {
    const poisoned = await createCampaign({
      name: "Poisoned", status: "SCHEDULED", scheduledAt: new Date(Date.now() - 3 * HOUR),
      listIds: [await (async () => { const l = await createList("P"); await addContact(l, "poison@example.test"); return l; })()],
    });
    const fine = await scheduled(-HOUR, 2, "Fine");
    await failInsertsWith("P0001", "poison");

    const result = await activateDueCampaigns();

    expect(result).toMatchObject({ activated: 1, failed: 1, connectionLost: false });
    expect((await getCampaign(poisoned)).status).toBe("SCHEDULED");
    expect((await getCampaign(fine)).status).toBe("QUEUED");
  });
});

describe("batches of due campaigns", () => {
  it("starts more than a few dozen overdue campaigns in a single cycle", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 40; i += 1) ids.push(await scheduled(-(40 - i) * 60_000, 1, `c${i}`));

    const result = await activateDueCampaigns();

    expect(result).toMatchObject({ due: 40, activated: 40, failed: 0 });
    expect(result.records.map((r) => r.campaignId)).toEqual(ids); // oldest schedule first
  });

  it("takes at most the configured number per cycle, and the rest on the next ones", async () => {
    vi.stubEnv("SCHEDULER_BATCH_LIMIT", "2");
    const ids = [await scheduled(-3 * HOUR, 1, "a"), await scheduled(-2 * HOUR, 1, "b"), await scheduled(-HOUR, 1, "c")];

    const first = await activateDueCampaigns();
    const second = await activateDueCampaigns();

    expect(first.records.map((r) => r.campaignId)).toEqual(ids.slice(0, 2));
    expect(second.records.map((r) => r.campaignId)).toEqual([ids[2]]);
  });

  it("does not let campaigns that keep failing crowd out the ones behind them", async () => {
    vi.stubEnv("SCHEDULER_BATCH_LIMIT", "3");
    const poisoned: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const l = await createList(`p${i}`);
      await addContact(l, `poison${i}@example.test`);
      poisoned.push(await createCampaign({
        name: `poison${i}`, listIds: [l], status: "SCHEDULED", scheduledAt: new Date(Date.now() - (10 - i) * HOUR),
      }));
    }
    const healthy = await scheduled(-HOUR, 2, "healthy");
    await failInsertsWith("P0001", "poison");

    // Each cycle looks at the three oldest; three that always fail must not hold the fourth back for ever.
    await activateDueCampaigns();
    expect((await getCampaign(healthy)).status).toBe("QUEUED");
    for (const id of poisoned) expect((await getCampaign(id)).status).toBe("SCHEDULED");
  });
});

describe("the worker re-checks a campaign's state before sending anything", () => {
  it("does not send queue rows that belong to a campaign that is still SCHEDULED", async () => {
    // Rows can exist ahead of their campaign starting (an older version, a manual repair).
    const id = await scheduled(HOUR, 0);
    await addRecipient(id, "early@example.test");

    const tick = await runTick({ timeBudgetMs: 10_000 });

    expect(tick.claimed).toBe(0);
    expect(smtp.messages).toHaveLength(0);
    expect((await getCampaign(id)).status).toBe("SCHEDULED");
    expect(await countByStatus(id)).toEqual({ QUEUED: 1 });
  });

  it("does not send queue rows that belong to a campaign cancelled in the meantime", async () => {
    const id = await createCampaign({ status: "CANCELLED", scheduledAt: new Date(Date.now() - HOUR) });
    await addRecipient(id, "late@example.test");

    const tick = await runTick({ timeBudgetMs: 10_000 });

    expect(tick.claimed).toBe(0);
    expect(smtp.messages).toHaveLength(0);
  });
});

describe("recipient rows that already exist when a campaign is activated", () => {
  it("are not duplicated and not sent a second time", async () => {
    const listId = await createList("Everyone");
    for (const who of ["a", "b", "c", "d"]) await addContact(listId, `${who}@example.test`);
    const id = await createCampaign({
      listIds: [listId], status: "SCHEDULED", scheduledAt: new Date(Date.now() - HOUR),
    });
    // What a previous, interrupted attempt could have left behind.
    await addRecipient(id, "a@example.test", { deliveryStatus: "SENT", sentAt: new Date(), attempts: 1 });
    await addRecipient(id, "b@example.test");

    const result = await activateDueCampaigns();
    await runTick({ timeBudgetMs: 10_000 });

    expect(result.activated).toBe(1);
    const rows = await recipientRows(id);
    expect(rows.map((r) => r.email_normalized)).toEqual(["a@example.test", "b@example.test", "c@example.test", "d@example.test"]);
    expect(rows.find((r) => r.email_normalized === "a@example.test")).toMatchObject({ delivery_status: "SENT", attempts: 1 });
    // "a" had been sent already: the other three go out once each, and "a" not again.
    expect(smtp.messages.flatMap((m) => m.to).sort()).toEqual(["b@example.test", "c@example.test", "d@example.test"]);
    expect((await getCampaign(id)).total_recipients).toBe(4);
  });

  it("stay one logical job per recipient however often activation is attempted", async () => {
    const id = await scheduled(-HOUR, 5);
    await activateDueCampaigns();
    // Force the campaign back, as a botched recovery might, and activate it again.
    await sql`UPDATE campaigns SET status = 'SCHEDULED' WHERE id = ${id}`;
    await activateDueCampaigns();
    await sql`UPDATE campaigns SET status = 'SCHEDULED' WHERE id = ${id}`;
    await activateDueCampaigns();

    const rows = await recipientRows(id);
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((r) => r.email_normalized)).size).toBe(5);
    const [{ n }] = await sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM (
        SELECT 1 FROM campaign_recipients WHERE campaign_id = ${id}
        GROUP BY campaign_id, email_normalized HAVING count(*) > 1
      ) dup`;
    expect(Number(n)).toBe(0);
  });
});
