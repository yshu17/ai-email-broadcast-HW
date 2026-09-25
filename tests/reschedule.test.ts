import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "@/lib/db";
import { PATCH as reschedule, POST as schedule } from "@/app/api/campaigns/[id]/schedule/route";
import { POST as cancelScheduled } from "@/app/api/campaigns/[id]/cancel-scheduled/route";
import { POST as sendNow } from "@/app/api/campaigns/[id]/send/route";
import { GET as getCampaignRoute } from "@/app/api/campaigns/[id]/route";
import { GET as listCampaigns } from "@/app/api/campaigns/route";
import { activateDueCampaigns, queueCampaign, rescheduleCampaign } from "@/lib/campaign-activation";
import { runTick } from "@/lib/worker";
import { startFakeSmtp, type FakeSmtp } from "./smtp-server";
import {
  addBulkContacts, createCampaign, createList, getCampaign, getScheduledAtUtc, recipientRows, resetDatabase,
  restartProcess,
} from "./helpers";

/**
 * Changing the time of a campaign that is already SCHEDULED, and the race between
 * that and the worker starting it. The database, the worker and the SMTP server are
 * all real (the SMTP server is an in-process fake, so nothing leaves the machine);
 * only the session check is stubbed.
 *
 * Time is moved by handing the scheduler a `now` (as the activation tests do), so a
 * campaign due "tomorrow" can be watched not starting today and starting tomorrow.
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
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await smtp.close();
});

afterAll(async () => { await sql.end(); });

const HOUR = 60 * 60 * 1000;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const request = (method: string, body?: unknown) =>
  new Request("https://mail.example.test/api", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** Whole seconds, so an instant survives the trip through ISO text unchanged. */
const inHours = (hours: number) => new Date(Math.floor((Date.now() + hours * HOUR) / 1000) * 1000);
const move = (id: string, to: Date | string | undefined, extra: Record<string, unknown> = {}) =>
  reschedule(request("PATCH", { scheduledAt: to instanceof Date ? to.toISOString() : to, ...extra }), ctx(id));

/** A SCHEDULED campaign, due `at`, with `contacts` recipients waiting to be generated. */
async function scheduled(at: Date = inHours(24), contacts = 3, name = "Autumn sale") {
  const listId = await createList(`${name} list`);
  await addBulkContacts(listId, contacts, `${Math.random().toString(36).slice(2, 8)}.test`);
  return createCampaign({ name, listIds: [listId], status: "SCHEDULED", scheduledAt: at });
}

async function count(table: "campaign_recipients" | "campaigns" | "campaign_lists", campaignId?: string) {
  const [row] = campaignId === undefined
    ? await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM ${sql(table)}`
    : await sql<{ n: string }[]>`
        SELECT count(*)::text AS n FROM ${sql(table)} WHERE ${sql(table === "campaigns" ? "id" : "campaign_id")} = ${campaignId}`;
  return Number(row.n);
}

const iso = (date: Date) => date.toISOString();

/* ---------------------------------------------------------------- the endpoint */

describe("PATCH /api/campaigns/:id/schedule", () => {
  it("moves a SCHEDULED campaign to the new time and returns the updated campaign", async () => {
    const id = await scheduled(inHours(24), 3, "Autumn sale");
    const later = inHours(48);

    const response = await move(id, later);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, scheduledAt: iso(later) });
    expect(body.campaign).toMatchObject({ id, name: "Autumn sale", status: "SCHEDULED", scheduledAt: iso(later) });
    expect(await getScheduledAtUtc(id)).toBe(iso(later));
    expect((await getCampaign(id)).status).toBe("SCHEDULED");
  });

  it("stores the new time as a UTC instant, whatever offset it was written with", async () => {
    const id = await scheduled();
    const target = inHours(72);
    // The same instant, written as the wall clock of a zone at +05:30 and one at -08:00.
    const written = (offsetMinutes: number, label: string) =>
      `${new Date(target.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 19)}${label}`;

    for (const spelling of [written(330, "+05:30"), written(-480, "-08:00"), iso(target)]) {
      const response = await move(id, spelling);
      expect(response.status).toBe(200);
      expect(await getScheduledAtUtc(id)).toBe(iso(target));
    }
  });

  it("tells apart the two instants behind a wall-clock time that clocks going back repeat", async () => {
    const id = await scheduled();
    const target = new Date("2099-10-25T01:30:00.000Z"); // an hour that is repeated in Europe

    await move(id, "2099-10-25T02:30:00+01:00");
    const first = await getScheduledAtUtc(id);
    await move(id, "2099-10-25T02:30:00+00:00");
    const second = await getScheduledAtUtc(id);

    expect(first).toBe(iso(target));
    expect(second).toBe("2099-10-25T02:30:00.000Z");
    expect(new Date(first!).getTime() + HOUR).toBe(new Date(second!).getTime());
  });

  it("leaves the status, the recipients, the lists and everything else about the campaign alone", async () => {
    const id = await scheduled(inHours(24), 4, "Keep me");
    const before = await getCampaign(id);

    await move(id, inHours(48));

    const after = await getCampaign(id);
    for (const column of ["name", "subject", "compiled_html", "content_html", "status", "total_recipients", "created_at", "started_at", "completed_at"]) {
      expect(after[column], column).toEqual(before[column]);
    }
    expect(await count("campaign_recipients", id)).toBe(0);
    expect(await count("campaign_lists", id)).toBe(1);
  });

  it("does not let the client change the status through this endpoint", async () => {
    const id = await scheduled();

    const response = await move(id, inHours(48), { status: "QUEUED", completedAt: "2026-01-01T00:00:00Z", name: "Hacked" });

    expect(response.status).toBe(200);
    const row = await getCampaign(id);
    expect(row.status).toBe("SCHEDULED");
    expect(row.name).toBe("Autumn sale");
    expect(row.completed_at).toBeNull();
    expect(await count("campaign_recipients", id)).toBe(0);
  });

  it("stamps updated_at", async () => {
    const id = await scheduled();
    await sql`UPDATE campaigns SET updated_at = now() - interval '1 day' WHERE id = ${id}`;
    const stamp = async () => new Date((await getCampaign(id)).updated_at as string | Date).getTime();
    const before = await stamp();

    await move(id, inHours(48));

    expect(await stamp()).toBeGreaterThan(before);
  });

  it("is a no-op that still succeeds when the same time is saved again", async () => {
    const at = inHours(24);
    const id = await scheduled(at);

    const response = await move(id, at);

    expect(response.status).toBe(200);
    expect(await getScheduledAtUtc(id)).toBe(iso(at));
    expect((await getCampaign(id)).status).toBe("SCHEDULED");
  });

  it("shows the new time in the campaign list and on the campaign's own page", async () => {
    const id = await scheduled(inHours(24));
    const later = inHours(50);
    await move(id, later);

    const { campaigns } = await (await listCampaigns()).json();
    expect(campaigns.find((c: { id: string }) => c.id === id)).toMatchObject({ status: "SCHEDULED", scheduledAt: iso(later) });

    const { campaign } = await (await getCampaignRoute(request("GET"), ctx(id))).json();
    expect(campaign).toMatchObject({ status: "SCHEDULED", scheduledAt: iso(later) });
  });
});

describe("what the endpoint refuses to accept as a new time", () => {
  it.each([
    ["nothing at all", undefined, "SCHEDULE_REQUIRED"],
    ["an empty string", "", "SCHEDULE_REQUIRED"],
    ["a number", 1_900_000_000_000, "SCHEDULE_REQUIRED"],
    ["text that is not a date", "tomorrow morning", "SCHEDULE_FORMAT"],
    ["a wall-clock time with no zone", "2099-10-15T09:00:00", "SCHEDULE_FORMAT"],
    ["a date that does not exist", "2099-02-31T10:00:00Z", "SCHEDULE_INVALID"],
    ["an hour that does not exist", "2099-02-10T24:00:00Z", "SCHEDULE_INVALID"],
  ])("%s → 400, and the old time stays", async (_label, value, code) => {
    const at = inHours(24);
    const id = await scheduled(at);

    const response = await move(id, value as string | undefined);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({ code, field: "scheduledAt" });
    expect(typeof body.error).toBe("string");
    expect(await getScheduledAtUtc(id)).toBe(iso(at));
  });

  it("rejects a time in the past on its own, whatever the browser checked", async () => {
    const at = inHours(24);
    const id = await scheduled(at);

    const response = await move(id, inHours(-1));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "SCHEDULE_PAST", error: "The scheduled time must be in the future." });
    expect(await getScheduledAtUtc(id)).toBe(iso(at));
    expect((await getCampaign(id)).status).toBe("SCHEDULED");
  });

  it("rejects the current moment as well as the past, and accepts the next second", async () => {
    const at = inHours(24);
    const id = await scheduled(at);
    const now = new Date(Math.floor(Date.now() / 1000) * 1000);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);

    expect((await move(id, now)).status).toBe(400);
    expect(await getScheduledAtUtc(id)).toBe(iso(at));

    const next = new Date(now.getTime() + 1000);
    expect((await move(id, next)).status).toBe(200);
    expect(await getScheduledAtUtc(id)).toBe(iso(next));
  });

  it("rejects a body that is not JSON", async () => {
    const id = await scheduled();
    const response = await reschedule(
      new Request("https://mail.example.test/api", { method: "PATCH", body: "not json" }), ctx(id),
    );
    expect(response.status).toBe(400);
  });
});

describe("which campaigns can be moved", () => {
  it("answers 404 for a campaign that does not exist, and for something that is not an id", async () => {
    expect((await move("00000000-0000-4000-8000-000000000000", inHours(48))).status).toBe(404);
    expect((await move("not-a-uuid", inHours(48))).status).toBe(404);
  });

  it.each(["DRAFT", "QUEUED", "SENDING", "PAUSED", "COMPLETED", "CANCELLED"] as const)(
    "refuses a %s campaign with 409 and changes nothing",
    async (status) => {
      const at = status === "DRAFT" ? null : inHours(-2);
      const id = await createCampaign({ status, scheduledAt: at });
      const before = await getCampaign(id);

      const response = await move(id, inHours(48));

      expect(response.status).toBe(409);
      expect((await response.json()).error).toContain(status);
      const after = await getCampaign(id);
      expect(after.status).toBe(status);
      expect(after.scheduled_at).toEqual(before.scheduled_at);
      expect(after.updated_at).toEqual(before.updated_at);
    },
  );

  it("refuses a campaign whose time has already come, even while it still reads SCHEDULED", async () => {
    const due = inHours(-0.01); // 36 seconds ago; the worker has not got to it yet
    const id = await scheduled(due);

    const response = await move(id, inHours(48));

    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/already due|about to start|started/i);
    expect(await getScheduledAtUtc(id)).toBe(iso(due));
    // ...and it is still the worker's to start.
    expect((await activateDueCampaigns()).activated).toBe(1);
  });
});

/* -------------------------------------------------------- the race with the worker */

describe("a change of time and the worker starting the campaign at the same moment", () => {
  it("waits for an activation that is in progress and then loses to it, changing nothing", async () => {
    const at = inHours(1);
    const id = await scheduled(at, 3);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => { locked = resolve; });

    // What the worker does in the middle of activating: hold the row, flip it to QUEUED.
    // (The row is still in the future by the database's clock: only a status check
    // *inside* the write can save the caller here.)
    const activating = sql.begin(async (tx) => {
      await tx`SELECT id FROM campaigns WHERE id = ${id} FOR UPDATE`;
      await tx`UPDATE campaigns SET status = 'QUEUED' WHERE id = ${id}`;
      locked();
      await gate;
    });
    await isLocked;

    let response: Response;
    try {
      const moving = move(id, inHours(48));
      let settled = false;
      void moving.then(() => { settled = true; });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false); // it cannot decide until the other transaction has

      release();
      await activating;
      response = await moving;
    } finally {
      release(); // never leave the row locked for the next test
    }

    expect(response.status).toBe(409);
    const row = await getCampaign(id);
    expect(row.status).toBe("QUEUED");
    expect(await getScheduledAtUtc(id)).toBe(iso(at));
  });

  it("makes the worker skip a campaign whose time change is in progress, and then see the new time", async () => {
    const id = await scheduled(inHours(1), 3);
    const later = inHours(48);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => { locked = resolve; });

    // What the endpoint does, held open so the worker arrives mid-way.
    const changing = sql.begin(async (tx) => {
      await tx`UPDATE campaigns SET scheduled_at = ${later.toISOString()}::timestamptz WHERE id = ${id} AND status = 'SCHEDULED'`;
      locked();
      await gate;
    });
    await isLocked;

    try {
      const during = await activateDueCampaigns({ now: inHours(2) });
      expect(during).toMatchObject({ activated: 0, failed: 0 });
    } finally {
      release(); // never leave the row locked for the next test
    }
    await changing;
    // The worker's clock says "two hours from now": due under the old time, not under the new one.
    const after = await activateDueCampaigns({ now: inHours(2) });
    expect(after).toMatchObject({ due: 0, activated: 0 });
    expect((await getCampaign(id)).status).toBe("SCHEDULED");
    expect(await count("campaign_recipients", id)).toBe(0);
  });

  it("refuses to queue a candidate whose time was moved after the worker had already picked it", async () => {
    const id = await scheduled(inHours(1), 3);
    // The worker's candidate list was read while the campaign was due; then the move lands.
    await move(id, inHours(48));

    const outcome = await queueCampaign(id, "SCHEDULED", { now: inHours(2) });

    expect(outcome).toEqual({ ok: false, reason: "unavailable" });
    expect((await getCampaign(id)).status).toBe("SCHEDULED");
    expect(await count("campaign_recipients", id)).toBe(0);
  });

  it("lets exactly one of a simultaneous move and activation win, every time", async () => {
    const outcomes = new Set<string>();

    for (let round = 0; round < 25; round += 1) {
      const old = inHours(1);
      const later = inHours(3);
      const id = await scheduled(old, 2);

      // The worker's clock is two hours ahead: the campaign is due under `old`, not under `later`.
      const [response, activation] = await Promise.all([move(id, later), activateDueCampaigns({ now: inHours(2) })]);

      const row = await getCampaign(id);
      const queued = await count("campaign_recipients", id);
      if (response.status === 200) {
        // The move won: the worker saw the new time and left the campaign alone.
        expect(row.status).toBe("SCHEDULED");
        expect(await getScheduledAtUtc(id)).toBe(iso(later));
        expect(queued).toBe(0);
        expect(activation.activated).toBe(0);
        outcomes.add("moved");
      } else {
        // The activation won: the move was refused and the queue is whole.
        expect(response.status).toBe(409);
        expect(row.status).toBe("QUEUED");
        expect(await getScheduledAtUtc(id)).toBe(iso(old));
        expect(queued).toBe(2);
        expect(activation.activated).toBe(1);
        outcomes.add("activated");
      }
    }
    expect(outcomes.size).toBeGreaterThan(0);
  });

  it("holds when many moves and many workers all race for the same campaign", async () => {
    const old = inHours(1);
    const id = await scheduled(old, 5);

    const results = await Promise.all([
      ...Array.from({ length: 4 }, (_, i) => move(id, inHours(10 + i))),
      ...Array.from({ length: 4 }, () => activateDueCampaigns({ now: inHours(2) })),
    ]);

    const moves = results.slice(0, 4) as Response[];
    const activations = results.slice(4) as Awaited<ReturnType<typeof activateDueCampaigns>>[];
    const row = await getCampaign(id);
    const activated = activations.reduce((sum, r) => sum + r.activated, 0);

    if (row.status === "QUEUED") {
      expect(activated).toBe(1);
      expect(await count("campaign_recipients", id)).toBe(5);
      expect(await getScheduledAtUtc(id)).toBe(iso(old)); // nothing moved it before it started
    } else {
      expect(row.status).toBe("SCHEDULED");
      expect(activated).toBe(0);
      expect(await count("campaign_recipients", id)).toBe(0);
      expect(moves.some((r) => r.status === 200)).toBe(true);
    }
    expect(moves.every((r) => r.status === 200 || r.status === 409)).toBe(true);
  });
});

/* ------------------------------------------------- what the scheduler does with it */

describe("the scheduler after a change of time", () => {
  it("does not start the campaign at its old time, and starts it at the new one", async () => {
    // "Was 15 Oct 10:30, is now 16 Oct 09:00" — a day and a bit later.
    const oldTime = inHours(24);
    const newTime = inHours(47);
    const id = await scheduled(oldTime, 3);
    await move(id, newTime);

    const atOldTime = await activateDueCampaigns({ now: new Date(oldTime.getTime() + 60_000) });
    expect(atOldTime).toMatchObject({ due: 0, activated: 0 });
    expect((await getCampaign(id)).status).toBe("SCHEDULED");
    expect(await count("campaign_recipients", id)).toBe(0);

    const atNewTime = await activateDueCampaigns({ now: newTime });
    expect(atNewTime).toMatchObject({ due: 1, activated: 1 });
    expect((await getCampaign(id)).status).toBe("QUEUED");
    expect(await count("campaign_recipients", id)).toBe(3);

    // The existing worker then sends it, exactly as for any other campaign.
    await runTick({ timeBudgetMs: 10_000 });
    expect(smtp.messages).toHaveLength(3);
    expect((await getCampaign(id)).status).toBe("COMPLETED");
  });

  it("starts the campaign at an earlier time when it is moved to an earlier moment that is still ahead", async () => {
    // "Was 16 Oct 09:00, is now 15 Oct 18:00".
    const oldTime = inHours(30);
    const earlier = inHours(9);
    const id = await scheduled(oldTime, 2);
    await move(id, earlier);

    expect((await activateDueCampaigns({ now: new Date(earlier.getTime() - 1000) })).activated).toBe(0);
    expect((await activateDueCampaigns({ now: earlier })).activated).toBe(1);
    expect((await getCampaign(id)).status).toBe("QUEUED");
    expect(await count("campaign_recipients", id)).toBe(2);
  });

  it("does not need a job, a timer or a queue entry: nothing exists for the campaign until it starts", async () => {
    const id = await scheduled(inHours(24), 3);

    await move(id, inHours(30));
    await move(id, inHours(20));
    await move(id, inHours(26));

    expect(await count("campaign_recipients", id)).toBe(0);
    expect(await count("campaigns")).toBe(1);
    expect(await count("campaign_lists", id)).toBe(1);
  });

  it("queues each recipient once, however many times the time was changed before it started", async () => {
    const id = await scheduled(inHours(24), 4);
    for (const hours of [30, 20, 26, 22, 22]) expect((await move(id, inHours(hours))).status).toBe(200);
    const last = await getScheduledAtUtc(id);

    await activateDueCampaigns({ now: new Date(new Date(last!).getTime() + 1000) });
    await activateDueCampaigns({ now: new Date(new Date(last!).getTime() + 2000) });

    const rows = await recipientRows(id);
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.email_normalized)).size).toBe(4);
  });

  it("keeps the last time that was saved across an application restart, and uses it", async () => {
    const id = await scheduled(inHours(24), 2);
    const chosen = inHours(40);
    await move(id, chosen);

    await restartProcess();

    expect(await getScheduledAtUtc(id)).toBe(iso(chosen));
    expect((await activateDueCampaigns({ now: inHours(30) })).activated).toBe(0);
    expect((await activateDueCampaigns({ now: chosen })).activated).toBe(1);
  });
});

/* ------------------------------------------------ neighbouring behaviour intact */

describe("everything around it still works", () => {
  it("cancels a campaign whose time was changed", async () => {
    const id = await scheduled(inHours(24), 3);
    await move(id, inHours(48));

    const response = await cancelScheduled(request("POST"), ctx(id));

    expect(response.status).toBe(200);
    const row = await getCampaign(id);
    expect(row.status).toBe("CANCELLED");
    expect(await getScheduledAtUtc(id)).toBe(iso(new Date((await response.json()).campaign.scheduledAt)));
    expect((await activateDueCampaigns({ now: inHours(72) })).due).toBe(0);
  });

  it("refuses to move a campaign that was cancelled", async () => {
    const id = await scheduled(inHours(24), 3);
    await cancelScheduled(request("POST"), ctx(id));

    expect((await move(id, inHours(48))).status).toBe(409);
    expect((await getCampaign(id)).status).toBe("CANCELLED");
  });

  it("still schedules a draft for the first time, and the result can then be moved", async () => {
    const listId = await createList("Subscribers");
    await addBulkContacts(listId, 2, "first.test");
    const id = await createCampaign({ listIds: [listId] });
    const first = inHours(24);

    const created = await schedule(request("POST", { scheduledAt: first.toISOString() }), ctx(id));
    expect(created.status).toBe(200);
    expect((await getCampaign(id)).status).toBe("SCHEDULED");
    expect(await getScheduledAtUtc(id)).toBe(iso(first));

    const later = inHours(36);
    expect((await move(id, later)).status).toBe(200);
    expect(await getScheduledAtUtc(id)).toBe(iso(later));
    // POST is still only for a DRAFT; moving a schedule is what PATCH is for.
    expect((await schedule(request("POST", { scheduledAt: inHours(40).toISOString() }), ctx(id))).status).toBe(409);
  });

  it("still sends immediately, and a campaign sent that way cannot be moved", async () => {
    const listId = await createList("Subscribers");
    await addBulkContacts(listId, 3, "now.test");
    const id = await createCampaign({ listIds: [listId] });

    const response = await sendNow(request("POST"), ctx(id));
    expect(response.status).toBe(200);
    await runTick({ timeBudgetMs: 10_000 });

    expect(smtp.messages).toHaveLength(3);
    expect((await getCampaign(id)).status).toBe("COMPLETED");
    expect((await move(id, inHours(48))).status).toBe(409);
  });
});

/* ------------------------------------------------------------- the function itself */

describe("rescheduleCampaign", () => {
  it("reports what it did, so callers can tell a move from a refusal", async () => {
    const id = await scheduled(inHours(24));
    const later = inHours(30);

    const moved = await rescheduleCampaign(id, later);
    expect(moved).toMatchObject({ outcome: "rescheduled" });
    if (moved.outcome === "rescheduled") expect(moved.campaign.scheduledAt).toEqual(later);

    expect(await rescheduleCampaign("00000000-0000-4000-8000-000000000000", later)).toEqual({ outcome: "not_found" });

    const started = await createCampaign({ status: "SENDING", scheduledAt: inHours(-1) });
    expect(await rescheduleCampaign(started, later)).toEqual({ outcome: "conflict", status: "SENDING", due: false });

    const overdue = await scheduled(inHours(-1));
    expect(await rescheduleCampaign(overdue, later)).toEqual({ outcome: "conflict", status: "SCHEDULED", due: true });
  });

  it("judges 'already due' by the same clock the scheduler uses", async () => {
    const at = inHours(24);
    const id = await scheduled(at);

    // With the clock a day and an hour on, the campaign is already the scheduler's.
    expect(await rescheduleCampaign(id, inHours(48), { now: inHours(25) })).toMatchObject({ outcome: "conflict", due: true });
    // With the clock a moment before it is due, it is still the person's.
    expect(await rescheduleCampaign(id, inHours(48), { now: new Date(at.getTime() - 1000) })).toMatchObject({ outcome: "rescheduled" });
  });
});
