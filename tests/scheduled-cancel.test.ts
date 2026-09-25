import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "@/lib/db";
import { POST as cancelScheduled } from "@/app/api/campaigns/[id]/cancel-scheduled/route";
import { POST as cancelCampaign } from "@/app/api/campaigns/[id]/cancel/route";
import { GET as listCampaigns } from "@/app/api/campaigns/route";
import { activateDueCampaigns, queueCampaign } from "@/lib/campaign-activation";
import { runTick } from "@/lib/worker";
import { startFakeSmtp, type FakeSmtp } from "./smtp-server";
import {
  addBulkContacts, addRecipient, countByStatus, createCampaign, createList, getCampaign, getScheduledAtUtc,
  resetDatabase,
} from "./helpers";

/**
 * Cancelling a SCHEDULED campaign, and the race between that and the worker
 * starting it. The database, the worker and the SMTP server are all real (the
 * SMTP server is an in-process fake, so nothing leaves the machine); only the
 * session check is stubbed.
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
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await smtp.close();
});

afterAll(async () => { await sql.end(); });

const HOUR = 60 * 60 * 1000;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const postRequest = (body?: unknown) =>
  new Request("https://mail.example.test/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const cancel = (id: string, body?: unknown) => cancelScheduled(postRequest(body), ctx(id));

/** A SCHEDULED campaign with `contacts` recipients waiting to be generated. */
async function scheduled(dueInMs = 24 * HOUR, contacts = 3, name = "Autumn sale") {
  const listId = await createList(`${name} list`);
  await addBulkContacts(listId, contacts, `${Math.random().toString(36).slice(2, 8)}.test`);
  return createCampaign({
    name, listIds: [listId], status: "SCHEDULED", scheduledAt: new Date(Date.now() + dueInMs),
  });
}

async function timePasses(campaignId: string) {
  await sql`UPDATE campaigns SET scheduled_at = now() - interval '1 second' WHERE id = ${campaignId}`;
}

async function recipientCount(campaignId: string) {
  const [row] = await sql<{ n: string }[]>`
    SELECT count(*)::text AS n FROM campaign_recipients WHERE campaign_id = ${campaignId}
  `;
  return Number(row.n);
}

describe("POST /api/campaigns/:id/cancel-scheduled", () => {
  it("moves a SCHEDULED campaign to CANCELLED and returns it", async () => {
    const id = await scheduled();

    const response = await cancel(id);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, alreadyCancelled: false });
    expect(body.campaign).toMatchObject({ id, status: "CANCELLED" });
    expect((await getCampaign(id)).status).toBe("CANCELLED");
  });

  it("keeps the campaign, its scheduled time and its lists for the history", async () => {
    const id = await scheduled(24 * HOUR, 3, "Keep me");
    const before = await getScheduledAtUtc(id);

    const body = await (await cancel(id)).json();

    expect(await getScheduledAtUtc(id)).toBe(before);
    expect(body.campaign.scheduledAt).toBe(before);
    expect(body.campaign.name).toBe("Keep me");
    const [lists] = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM campaign_lists WHERE campaign_id = ${id}`;
    expect(Number(lists.n)).toBe(1);
    const [contacts] = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM contacts`;
    expect(Number(contacts.n)).toBe(3);
  });

  it("stamps the moment it was closed, like every other cancellation", async () => {
    const id = await scheduled();

    await cancel(id);

    const row = await getCampaign(id);
    expect(row.completed_at).not.toBeNull();
    expect(row.started_at).toBeNull();
  });

  it("queues nothing and sends nothing", async () => {
    const id = await scheduled();

    await cancel(id);

    expect(await recipientCount(id)).toBe(0);
    expect(smtp.messages).toHaveLength(0);
  });

  it("answers 404 for a campaign that does not exist, and for something that cannot be an id", async () => {
    expect((await cancel("00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await cancel("not-a-uuid")).status).toBe(404);
  });

  it.each(["DRAFT", "QUEUED", "SENDING", "PAUSED", "COMPLETED"] as const)(
    "refuses a %s campaign with 409 and leaves it exactly as it was",
    async (status) => {
      const id = await createCampaign({ status, scheduledAt: status === "DRAFT" ? null : new Date(Date.now() - HOUR) });
      const before = await getCampaign(id);

      const response = await cancel(id);

      expect(response.status).toBe(409);
      expect((await response.json()).error).toContain(status);
      expect(await getCampaign(id)).toEqual(before);
    },
  );

  it("does not touch the queue of a campaign that is already sending", async () => {
    const id = await createCampaign({ status: "SENDING" });
    await addRecipient(id, "a@example.test");
    await addRecipient(id, "b@example.test");
    await addRecipient(id, "c@example.test", { deliveryStatus: "SENT" });

    expect((await cancel(id)).status).toBe(409);

    expect((await getCampaign(id)).status).toBe("SENDING");
    expect(await countByStatus(id)).toEqual({ QUEUED: 2, SENT: 1 });
  });

  it("is safe to repeat: the second request changes nothing and reports the campaign as already cancelled", async () => {
    const id = await scheduled();
    await cancel(id);
    const afterFirst = await getCampaign(id);

    const second = await cancel(id);

    expect(second.status).toBe(200);
    const body = await second.json();
    expect(body).toMatchObject({ ok: true, alreadyCancelled: true });
    expect(body.campaign.status).toBe("CANCELLED");
    expect(await getCampaign(id)).toEqual(afterFirst);
  });

  it("does not trust a status sent by the client", async () => {
    const scheduledId = await scheduled();
    const queuedId = await createCampaign({ status: "QUEUED" });

    // Claiming it is QUEUED does not turn a SCHEDULED campaign into anything else …
    await cancel(scheduledId, { status: "QUEUED", from: "QUEUED" });
    expect((await getCampaign(scheduledId)).status).toBe("CANCELLED");
    // … and claiming it is SCHEDULED does not make a QUEUED one cancellable.
    expect((await cancel(queuedId, { status: "SCHEDULED", from: "SCHEDULED" })).status).toBe(409);
    expect((await getCampaign(queuedId)).status).toBe("QUEUED");
  });

  it("cancels an overdue campaign the worker has not yet got round to", async () => {
    const id = await scheduled(24 * HOUR);
    await timePasses(id);

    expect((await cancel(id)).status).toBe(200);
    expect((await getCampaign(id)).status).toBe("CANCELLED");
  });
});

describe("a cancelled campaign never starts", () => {
  it("is not activated when its scheduled time arrives", async () => {
    const id = await scheduled(24 * HOUR);
    await cancel(id);
    await timePasses(id);

    const result = await activateDueCampaigns();

    expect(result).toMatchObject({ due: 0, activated: 0 });
    expect((await getCampaign(id)).status).toBe("CANCELLED");
    expect(await recipientCount(id)).toBe(0);
  });

  it("is not sent by a whole worker tick either", async () => {
    const id = await scheduled(24 * HOUR, 5);
    await cancel(id);
    await timePasses(id);

    const tick = await runTick({ timeBudgetMs: 10_000 });

    expect(tick.activatedCampaigns).toBe(0);
    expect(smtp.messages).toHaveLength(0);
    expect((await getCampaign(id)).status).toBe("CANCELLED");
  });

  it("leaves other scheduled campaigns alone", async () => {
    const cancelled = await scheduled(24 * HOUR, 2, "Cancelled");
    const kept = await scheduled(24 * HOUR, 2, "Kept");

    await cancel(cancelled);
    await timePasses(cancelled);
    await timePasses(kept);
    const result = await activateDueCampaigns();

    expect(result.activated).toBe(1);
    expect((await getCampaign(cancelled)).status).toBe("CANCELLED");
    expect((await getCampaign(kept)).status).toBe("QUEUED");
  });
});

describe("cancel versus activation", () => {
  it("cancels nothing once activation has won: the campaign stays QUEUED and keeps its queue", async () => {
    const id = await scheduled(24 * HOUR, 4);
    await timePasses(id);
    await activateDueCampaigns();

    const response = await cancel(id);

    expect(response.status).toBe(409);
    expect((await getCampaign(id)).status).toBe("QUEUED");
    expect(await countByStatus(id)).toEqual({ QUEUED: 4 });

    // The send carries on as if nobody had tried.
    await runTick({ timeBudgetMs: 10_000 });
    expect(smtp.messages).toHaveLength(4);
    expect((await getCampaign(id)).status).toBe("COMPLETED");
  });

  it("waits for an activation that is in progress and then loses to it", async () => {
    const id = await scheduled(-1_000, 3);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => { locked = resolve; });

    // What the worker does in the middle of activating: hold the row, flip it to QUEUED.
    const activating = sql.begin(async (tx) => {
      await tx`SELECT id FROM campaigns WHERE id = ${id} FOR UPDATE`;
      await tx`UPDATE campaigns SET status = 'QUEUED' WHERE id = ${id}`;
      locked();
      await gate;
    });
    await isLocked;

    const cancelling = cancel(id);
    let settled = false;
    void cancelling.then(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(settled).toBe(false); // it cannot decide until the other transaction has

    release();
    await activating;
    const response = await cancelling;

    expect(response.status).toBe(409);
    expect((await getCampaign(id)).status).toBe("QUEUED");
  });

  it("makes the worker skip, and not start, a campaign whose cancellation is in progress", async () => {
    const id = await scheduled(-1_000, 3);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => { locked = resolve; });

    // What the cancel endpoint does, held open so the worker arrives mid-way.
    const cancelling = sql.begin(async (tx) => {
      await tx`UPDATE campaigns SET status = 'CANCELLED', completed_at = now() WHERE id = ${id} AND status = 'SCHEDULED'`;
      locked();
      await gate;
    });
    await isLocked;

    const during = await activateDueCampaigns();
    expect(during).toMatchObject({ activated: 0, failed: 0 });

    release();
    await cancelling;
    expect((await activateDueCampaigns()).due).toBe(0);
    expect((await getCampaign(id)).status).toBe("CANCELLED");
    expect(await recipientCount(id)).toBe(0);
  });

  it("refuses to queue a candidate that was cancelled after the worker had already picked it", async () => {
    const id = await scheduled(-1_000, 3);
    // The worker found it SCHEDULED and due; before it gets to it, the cancel lands.
    await cancel(id);

    const outcome = await queueCampaign(id, "SCHEDULED");

    expect(outcome).toEqual({ ok: false, reason: "unavailable" });
    expect((await getCampaign(id)).status).toBe("CANCELLED");
    expect(await recipientCount(id)).toBe(0);
  });

  it("lets exactly one of a simultaneous cancel and activation win, every time", async () => {
    const outcomes = new Set<string>();

    for (let round = 0; round < 25; round += 1) {
      const id = await scheduled(-1_000, 2);

      const [cancelResponse, activation] = await Promise.all([cancel(id), activateDueCampaigns()]);

      const row = await getCampaign(id);
      const queued = await recipientCount(id);
      if (cancelResponse.status === 200) {
        // Cancellation won: nothing queued, nothing activated.
        expect(row.status).toBe("CANCELLED");
        expect(queued).toBe(0);
        expect(activation.activated).toBe(0);
        outcomes.add("cancelled");
      } else {
        // Activation won: the cancel was refused and the queue is whole.
        expect(cancelResponse.status).toBe(409);
        expect(row.status).toBe("QUEUED");
        expect(queued).toBe(2);
        expect(activation.activated).toBe(1);
        outcomes.add("activated");
      }
    }
    // Which side wins is up to the database; the point is it is always exactly one.
    expect(outcomes.size).toBeGreaterThan(0);
  });

  it("holds when many cancels and many workers all race for the same campaign", async () => {
    const id = await scheduled(-1_000, 5);

    const results = await Promise.all([
      ...Array.from({ length: 4 }, () => cancel(id)),
      ...Array.from({ length: 4 }, () => activateDueCampaigns()),
    ]);

    const cancels = results.slice(0, 4) as Response[];
    const activations = results.slice(4) as Awaited<ReturnType<typeof activateDueCampaigns>>[];
    const row = await getCampaign(id);
    const activated = activations.reduce((sum, r) => sum + r.activated, 0);

    if (row.status === "CANCELLED") {
      expect(activated).toBe(0);
      expect(cancels.every((r) => r.status === 200)).toBe(true);
      expect(await recipientCount(id)).toBe(0);
    } else {
      expect(row.status).toBe("QUEUED");
      expect(activated).toBe(1);
      expect(cancels.every((r) => r.status === 409)).toBe(true);
      expect(await recipientCount(id)).toBe(5);
    }
  });
});

describe("the existing cancel endpoint is unchanged", () => {
  it("still cancels a queued campaign's remaining emails", async () => {
    const id = await createCampaign({ status: "QUEUED" });
    await addRecipient(id, "a@example.test");

    const response = await cancelCampaign(postRequest(), ctx(id));

    expect(response.status).toBe(200);
    expect((await getCampaign(id)).status).toBe("CANCELLED");
    expect(await countByStatus(id)).toEqual({ CANCELLED: 1 });
  });

  it("still refuses a SCHEDULED campaign; cancelling those is a separate, stricter action", async () => {
    const id = await scheduled();

    expect((await cancelCampaign(postRequest(), ctx(id))).status).toBe(409);
    expect((await getCampaign(id)).status).toBe("SCHEDULED");
  });
});

describe("the campaign list after a cancellation", () => {
  it("reports CANCELLED and keeps the scheduled time", async () => {
    const id = await scheduled();
    const scheduledAt = await getScheduledAtUtc(id);
    await cancel(id);

    const { campaigns } = await (await listCampaigns()).json();

    expect(campaigns).toHaveLength(1);
    expect(campaigns[0]).toMatchObject({ id, status: "CANCELLED", scheduledAt });
  });
});
