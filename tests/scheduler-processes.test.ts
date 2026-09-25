import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "@/lib/db";
import { startFakeSmtp, type FakeSmtp } from "./smtp-server";
import {
  addBulkContacts, countByStatus, createCampaign, createList, getCampaign, recipientRows, resetDatabase,
} from "./helpers";

/**
 * The scheduler in real operating-system processes: one that is killed part-way
 * through starting a campaign, ones that start together, ones that follow each
 * other after "restarts", and the ticker script itself. Same throwaway database
 * as every other test; the SMTP server is an in-process fake, so no mail leaves
 * the machine. Processes take a second or two to boot, so the scenarios are few and
 * each covers a lot.
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
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await sql.unsafe(`DROP TRIGGER IF EXISTS test_slow_trigger ON campaign_recipients`);
  await sql.unsafe(`DROP FUNCTION IF EXISTS test_slow()`);
  await smtp.close();
});

afterAll(async () => { await sql.end(); });

const HOUR = 60 * 60 * 1000;
const rand = () => Math.random().toString(36).slice(2, 8);

/* ----------------------------------------------------------------- processes */

type Started = { child: ChildProcess; output: () => string; exited: Promise<number | null> };

function start(args: string[], env: Record<string, string> = {}): Started {
  const child = spawn(process.execPath, ["--import", "tsx", ...args], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let out = "";
  child.stdout?.on("data", (chunk) => { out += chunk; });
  child.stderr?.on("data", (chunk) => { out += chunk; });
  const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  return { child, output: () => out, exited };
}

const scheduler = (mode: "activate" | "tick", env: Record<string, string> = {}) =>
  start(["tests/fixtures/scheduler-child.ts", mode], env);

async function runToEnd<T = Record<string, unknown>>(process_: Started): Promise<T> {
  const code = await process_.exited;
  const line = process_.output().split("\n").find((l) => l.startsWith("RESULT "));
  if (code !== 0 || !line) throw new Error(`scheduler process failed (exit ${code}):\n${process_.output()}`);
  return JSON.parse(line.slice("RESULT ".length)) as T;
}

/** Runs one scheduler process to completion, as a fresh start of the app would. */
const restartAndRun = async <T = Record<string, unknown>>(mode: "activate" | "tick", env: Record<string, string> = {}) =>
  runToEnd<T>(scheduler(mode, env));

async function until(check: () => Promise<boolean>, what: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/* ------------------------------------------------------------------- fixtures */

async function scheduledOverdue(contacts: number, name = "Overdue") {
  const listId = await createList(`${name} ${rand()}`);
  await addBulkContacts(listId, contacts, `${rand()}.test`);
  return createCampaign({
    name, listIds: [listId], status: "SCHEDULED", scheduledAt: new Date(Date.now() - HOUR),
  });
}

async function recipientCount(campaignId: string) {
  const [row] = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM campaign_recipients WHERE campaign_id = ${campaignId}`;
  return Number(row.n);
}

/** Slows the insert of one recipient down, holding the activation transaction open for `seconds`. */
async function slowDownInsertOf(email: string, seconds: number) {
  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION test_slow() RETURNS trigger AS $$
    BEGIN PERFORM pg_sleep(${seconds}); RETURN NEW; END
    $$ LANGUAGE plpgsql`);
  await sql.unsafe(`DROP TRIGGER IF EXISTS test_slow_trigger ON campaign_recipients`);
  await sql.unsafe(`
    CREATE TRIGGER test_slow_trigger BEFORE INSERT ON campaign_recipients
    FOR EACH ROW WHEN (NEW.email_normalized = '${email}') EXECUTE FUNCTION test_slow()`);
}

/* ---------------------------------------------------------------------- tests */

describe("a scheduler process that dies part-way through starting a campaign", () => {
  it("leaves the campaign SCHEDULED, whole and untouched, and the next process starts it exactly once", async () => {
    const listId = await createList("Crash");
    await addBulkContacts(listId, 20, `${rand()}.test`);
    await sql`INSERT INTO contacts (email, email_normalized) VALUES ('slow@example.test','slow@example.test')`;
    await sql`INSERT INTO contact_list_members (list_id, contact_id) SELECT ${listId}, id FROM contacts WHERE email_normalized = 'slow@example.test'`;
    const id = await createCampaign({
      name: "Crash", listIds: [listId], status: "SCHEDULED", scheduledAt: new Date(Date.now() - HOUR),
    });
    const before = await getCampaign(id);
    await slowDownInsertOf("slow@example.test", 3);

    // The process gets as far as changing the status and starts writing the queue…
    const doomed = scheduler("activate");
    await until(async () => {
      const [row] = await sql<{ n: string }[]>`
        SELECT count(*)::text AS n FROM pg_stat_activity
        WHERE datname = current_database() AND state = 'active' AND wait_event = 'PgSleep'
          AND query ILIKE '%campaign_recipients%'`;
      return Number(row.n) > 0;
    }, "the activation to be under way");

    // …and is killed there, as by a crash or an OOM kill, with no chance to clean up.
    doomed.child.kill("SIGKILL");
    await doomed.exited;

    // Nothing of the half-done work is visible: still SCHEDULED, not QUEUED-without-a-queue.
    expect(await getCampaign(id)).toEqual(before);
    // The database drops the dead client's session, rolling its transaction back.
    await until(async () => {
      const [row] = await sql<{ n: string }[]>`
        SELECT count(*)::text AS n FROM pg_stat_activity
        WHERE datname = current_database() AND query ILIKE '%campaign_recipients%' AND pid <> pg_backend_pid()
          AND state <> 'idle'`;
      return Number(row.n) === 0;
    }, "the abandoned transaction to end");
    expect(await getCampaign(id)).toEqual(before);
    expect(await recipientCount(id)).toBe(0);

    // A restarted process finds it overdue and starts it, once, completely.
    await sql.unsafe(`DROP TRIGGER test_slow_trigger ON campaign_recipients`);
    const recovered = await restartAndRun<{ activated: number; records: { outcome: string }[] }>("activate");

    expect(recovered.activated).toBe(1);
    expect((await getCampaign(id)).status).toBe("QUEUED");
    expect(await countByStatus(id)).toEqual({ QUEUED: 21 });
    expect((await getCampaign(id)).total_recipients).toBe(21);

    // And a further restart finds nothing to do.
    const again = await restartAndRun<{ due: number; activated: number }>("activate");
    expect(again).toMatchObject({ due: 0, activated: 0 });
    expect(await recipientCount(id)).toBe(21);
  }, 90_000);
});

describe("two schedulers running at once", () => {
  it("start a due campaign exactly once between them, however they interleave", async () => {
    const id = await scheduledOverdue(1_500);
    const startAt = Date.now() + 6_000; // enough for both processes to finish booting
    const env = { CHILD_START_AT: String(startAt) };

    const [a, b] = await Promise.all([runToEnd<{ activated: number; skipped: number; due: number }>(scheduler("activate", env)),
      runToEnd<{ activated: number; skipped: number; due: number }>(scheduler("activate", env))]);

    expect(a.activated + b.activated).toBe(1);
    expect((await getCampaign(id)).status).toBe("QUEUED");
    const rows = await recipientRows(id);
    expect(rows).toHaveLength(1_500);
    expect(new Set(rows.map((r) => r.email_normalized)).size).toBe(1_500);
    expect((await getCampaign(id)).total_recipients).toBe(1_500);
  }, 90_000);

  it("both run whole ticks against the same queue and send every address exactly once", async () => {
    const id = await scheduledOverdue(40);
    const startAt = Date.now() + 6_000;
    const env = { CHILD_START_AT: String(startAt) };

    const [a, b] = await Promise.all([
      runToEnd<{ activatedCampaigns: number; sent: number }>(scheduler("tick", env)),
      runToEnd<{ activatedCampaigns: number; sent: number }>(scheduler("tick", env)),
    ]);

    expect(a.activatedCampaigns + b.activatedCampaigns).toBe(1);
    expect(a.sent + b.sent).toBe(40);
    const recipients = smtp.messages.flatMap((m) => m.to);
    expect(recipients).toHaveLength(40);
    expect(new Set(recipients).size).toBe(40);
    expect((await getCampaign(id)).status).toBe("COMPLETED");
  }, 90_000);
});

describe("restarting the app over and over while a scheduled campaign runs", () => {
  it("sends each address once, honours the hourly limit in every process, and finishes", async () => {
    // 10 emails an hour allows 9 (safety factor 0.95): 20 recipients take three "hours".
    vi.stubEnv("SMTP_MAX_EMAILS_PER_HOUR", "10");
    const id = await scheduledOverdue(20);

    const first = await restartAndRun<{ activatedCampaigns: number; sent: number; rateLimited: boolean }>("tick");
    expect(first).toMatchObject({ activatedCampaigns: 1, sent: 9, rateLimited: true });
    expect((await getCampaign(id)).status).toBe("SENDING");

    // Restart straight away: the limit is remembered in the database, so nothing more is sent.
    const second = await restartAndRun<{ activatedCampaigns: number; sent: number; rateLimited: boolean }>("tick");
    expect(second).toMatchObject({ activatedCampaigns: 0, sent: 0, rateLimited: true });

    // An hour goes by; another restart.
    await sql`UPDATE smtp_send_log SET occurred_at = occurred_at - interval '2 hours'`;
    const third = await restartAndRun<{ sent: number }>("tick");
    expect(third.sent).toBe(9);

    await sql`UPDATE smtp_send_log SET occurred_at = occurred_at - interval '2 hours'`;
    const fourth = await restartAndRun<{ sent: number; completedCampaigns: number }>("tick");
    expect(fourth).toMatchObject({ sent: 2, completedCampaigns: 1 });

    const recipients = smtp.messages.flatMap((m) => m.to);
    expect(recipients).toHaveLength(20);
    expect(new Set(recipients).size).toBe(20);
    expect((await countByStatus(id))).toEqual({ SENT: 20 });
    expect((await getCampaign(id)).status).toBe("COMPLETED");

    // A further restart changes nothing.
    const fifth = await restartAndRun<{ sent: number; activatedCampaigns: number }>("tick");
    expect(fifth).toMatchObject({ sent: 0, activatedCampaigns: 0 });
    expect(smtp.messages).toHaveLength(20);
  }, 120_000);
});

describe("starting the app again (boot-time migrations)", () => {
  it("does not touch scheduled campaigns", async () => {
    const id = await scheduledOverdue(3);
    const future = await createCampaign({
      name: "Later", status: "SCHEDULED", scheduledAt: new Date(Date.now() + 5 * HOUR),
    });
    const before = [await getCampaign(id), await getCampaign(future)];

    // What the container's entrypoint runs on every boot.
    const migrate = start(["scripts/migrate.ts"]);
    expect(await migrate.exited).toBe(0);
    expect(migrate.output()).toContain("Migrations applied.");

    expect([await getCampaign(id), await getCampaign(future)]).toEqual(before);
  }, 60_000);
});

describe("the ticker script", () => {
  /** A stand-in for the app: records the requests the ticker makes. */
  async function fakeApp(): Promise<{ server: Server; url: string; requests: { method?: string; authorization?: string; url?: string }[] }> {
    const requests: { method?: string; authorization?: string; url?: string }[] = [];
    const server = createServer((req, res) => {
      requests.push({ method: req.method, authorization: req.headers.authorization, url: req.url });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ claimed: 0, reclaimed: 0, activatedCampaigns: 0 }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests };
  }

  it("starts ticking the worker endpoint with its secret, on the configured interval", async () => {
    const app = await fakeApp();
    const ticker = start(["scripts/worker-loop.ts"], {
      WORKER_TARGET_URL: app.url, WORKER_SECRET: "the-shared-secret", WORKER_TICK_INTERVAL_SECONDS: "1",
    });
    try {
      await until(async () => app.requests.length >= 2, "two ticks", 30_000);
    } finally {
      ticker.child.kill("SIGKILL");
      await ticker.exited;
      await new Promise<void>((resolve) => app.server.close(() => resolve()));
    }

    expect(app.requests[0]).toEqual({ method: "POST", authorization: "Bearer the-shared-secret", url: "/api/worker/tick" });
    expect(ticker.output()).toContain("ticking");
  }, 60_000);

  it("refuses to start without the shared secret, rather than ticking unauthenticated", async () => {
    const ticker = start(["scripts/worker-loop.ts"], { WORKER_SECRET: "" });

    expect(await ticker.exited).toBe(1);
    expect(ticker.output()).toContain("WORKER_SECRET is not set");
  }, 30_000);

  it("keeps running, and keeps trying, while the app is not there", async () => {
    // Nothing listens on this port: every tick is refused.
    const app = await fakeApp();
    const deadUrl = app.url;
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
    const ticker = start(["scripts/worker-loop.ts"], {
      WORKER_TARGET_URL: deadUrl, WORKER_SECRET: "s", WORKER_TICK_INTERVAL_SECONDS: "1",
    });
    try {
      await until(async () => (ticker.output().match(/tick failed/g) ?? []).length >= 1, "a failed tick", 30_000);
      expect(ticker.child.exitCode).toBeNull(); // still alive
    } finally {
      ticker.child.kill("SIGKILL");
      await ticker.exited;
    }
  }, 60_000);
});
