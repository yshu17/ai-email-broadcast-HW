import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "@/lib/db";
import { GET as listCampaigns, POST as createCampaignApi } from "@/app/api/campaigns/route";
import { GET as getCampaignApi, PATCH as patchCampaignApi } from "@/app/api/campaigns/[id]/route";
import { POST as scheduleApi } from "@/app/api/campaigns/[id]/schedule/route";
import { POST as sendApi } from "@/app/api/campaigns/[id]/send/route";
import { POST as cancelScheduledApi } from "@/app/api/campaigns/[id]/cancel-scheduled/route";
import { activateDueCampaigns } from "@/lib/campaign-activation";
import { runTick } from "@/lib/worker";
import { toScheduledAt } from "@/lib/scheduling";
import { startFakeSmtp, type FakeSmtp } from "./smtp-server";
import {
  addBulkContacts, countByStatus, createList, getCampaign, getScheduledAtUtc, recipientRows, resetDatabase,
  restartProcess,
} from "./helpers";

/**
 * The whole feature end to end, the way the interface drives it: the same API
 * routes create, fill in, schedule and cancel a campaign; the database is read
 * directly; and a scheduler cycle then hands it to the ordinary queue, worker,
 * rate limiter and (fake, in-process) SMTP server.
 *
 * Time is controlled twice over. The server's own clock, used to validate what the
 * client sends, is a fake `Date`. The scheduler's clock is injected (`now`), so
 * "moving time forward" is literal: the very same database row is looked at again
 * at 09:55, 10:00 or 10:15. Nothing waits.
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

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const request = (body?: unknown, method = "POST") =>
  new Request("https://mail.example.test/api", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const at = (iso: string) => new Date(iso);
const rand = () => Math.random().toString(36).slice(2, 8);

async function audience(contacts: number) {
  const listId = await createList(`List ${rand()}`);
  await addBulkContacts(listId, contacts, `${rand()}.test`);
  return listId;
}

/** What the wizard does before the last step: create the draft, then fill in subject, body and lists. */
async function draftViaApi(listId: string, name = "Autumn sale"): Promise<string> {
  const created = await createCampaignApi(request({ name }));
  expect(created.status).toBe(201);
  const { campaign } = await created.json();
  expect(campaign).toMatchObject({ status: "DRAFT", scheduledAt: null });

  const patched = await patchCampaignApi(
    request({ subject: "Hello {{firstName}}", contentHtml: "<p>Hi {{firstName}}</p>", listIds: [listId] }, "PATCH"),
    ctx(campaign.id),
  );
  expect(patched.status).toBe(200);
  return campaign.id;
}

/** What the last step does on "Schedule": read the wall-clock time in the user's zone, send the UTC instant. */
async function scheduleViaApi(id: string, wallDate: string, wallTime: string, timeZone: string, now: Date) {
  const chosen = toScheduledAt(wallDate, wallTime, now, { timeZone });
  if (!chosen.ok) throw new Error(`the form refused it: ${chosen.error}`);
  return scheduleApi(request({ scheduledAt: chosen.date.toISOString() }), ctx(id));
}

async function listRow(id: string) {
  const { campaigns } = await (await listCampaigns()).json();
  return campaigns.find((c: { id: string }) => c.id === id);
}

async function hourPasses() {
  await sql`UPDATE smtp_send_log SET occurred_at = occurred_at - interval '2 hours'`;
}

async function sentInLastHour() {
  const [row] = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM smtp_send_log WHERE occurred_at > now() - interval '1 hour'`;
  return Number(row.n);
}

describe("a scheduled campaign, from the wizard's API calls to delivered mail", () => {
  it("goes SCHEDULED, QUEUED, SENDING, COMPLETED at its time, through the ordinary queue and rate limit", async () => {
    // 10 an hour, with the 0.95 safety factor, allows 9: fifteen recipients take two "hours".
    vi.stubEnv("SMTP_MAX_EMAILS_PER_HOUR", "10");
    const listId = await audience(15);
    // The user's clock reads 09:50 in Madrid (07:50 UTC); they pick 10:00 there.
    const now = at("2026-10-15T07:50:00.000Z");
    vi.useFakeTimers({ toFake: ["Date"], now });
    const id = await draftViaApi(listId);

    const scheduled = await scheduleViaApi(id, "2026-10-15", "10:00", "Europe/Madrid", now);

    // Saved: SCHEDULED, an unambiguous UTC instant, nothing queued.
    expect(scheduled.status).toBe(200);
    expect(await scheduled.json()).toMatchObject({ ok: true, scheduledAt: "2026-10-15T08:00:00.000Z" });
    expect(await getCampaign(id)).toMatchObject({ status: "SCHEDULED", total_recipients: 0 });
    expect(await getScheduledAtUtc(id)).toBe("2026-10-15T08:00:00.000Z");
    expect(await recipientRows(id)).toHaveLength(0);
    // Visible in the list and in the detail, as the same instant.
    expect(await listRow(id)).toMatchObject({ status: "SCHEDULED", scheduledAt: "2026-10-15T08:00:00.000Z", estimatedRecipients: 15 });
    const detail = await (await getCampaignApi(request(undefined, "GET"), ctx(id))).json();
    expect(detail.campaign).toMatchObject({ status: "SCHEDULED", scheduledAt: "2026-10-15T08:00:00.000Z" });

    // 09:55 Madrid: not yet.
    const early = await runTick({ timeBudgetMs: 10_000, now: at("2026-10-15T07:55:00.000Z") });
    expect(early).toMatchObject({ activatedCampaigns: 0, sent: 0 });
    expect((await getCampaign(id)).status).toBe("SCHEDULED");
    expect(smtp.messages).toHaveLength(0);

    // 10:00 exactly: due (<=). The scheduler's whole job is to queue it, not to send.
    const activation = await activateDueCampaigns({ now: at("2026-10-15T08:00:00.000Z") });
    expect(activation).toMatchObject({ due: 1, activated: 1, failed: 0 });
    expect((await getCampaign(id)).status).toBe("QUEUED");
    expect(await countByStatus(id)).toEqual({ QUEUED: 15 });
    expect(smtp.messages).toHaveLength(0);

    // The worker takes it from the queue, at the rate limit: nine now, so still SENDING.
    const first = await runTick({ timeBudgetMs: 10_000, now: at("2026-10-15T08:00:30.000Z") });
    expect(first).toMatchObject({ activatedCampaigns: 0, sent: 9, rateLimited: true });
    expect((await getCampaign(id)).status).toBe("SENDING");
    expect(await sentInLastHour()).toBe(9);

    // An hour later the rest goes, and the campaign completes.
    await hourPasses();
    const second = await runTick({ timeBudgetMs: 10_000, now: at("2026-10-15T09:01:00.000Z") });
    expect(second.sent).toBe(6);
    expect((await getCampaign(id)).status).toBe("COMPLETED");
    expect(await countByStatus(id)).toEqual({ SENT: 15 });

    const recipients = smtp.messages.flatMap((m) => m.to);
    expect(recipients).toHaveLength(15);
    expect(new Set(recipients).size).toBe(15);
  });

  it("queues a large campaign at once, but never delivers more than the hourly allowance in an hour", async () => {
    vi.stubEnv("SMTP_MAX_EMAILS_PER_HOUR", "100"); // 95 an hour with the safety factor
    const listId = await audience(240);
    const now = at("2026-10-15T07:50:00.000Z");
    vi.useFakeTimers({ toFake: ["Date"], now });
    const id = await draftViaApi(listId, "Big one");
    await scheduleViaApi(id, "2026-10-15", "10:00", "Europe/Madrid", now);

    const due = at("2026-10-15T08:00:00.000Z");
    await activateDueCampaigns({ now: due });
    // The whole audience is in the queue from the start…
    expect(await countByStatus(id)).toEqual({ QUEUED: 240 });
    expect(smtp.messages).toHaveLength(0);

    // …and goes out over three "hours", never more than 95 in any of them.
    const perHour: number[] = [];
    for (let hour = 0; hour < 3; hour += 1) {
      const before = smtp.messages.length;
      await runTick({ timeBudgetMs: 60_000, now: due });
      perHour.push(smtp.messages.length - before);
      expect(await sentInLastHour()).toBeLessThanOrEqual(95);
      await hourPasses();
    }

    expect(perHour).toEqual([95, 95, 50]);
    expect((await getCampaign(id)).status).toBe("COMPLETED");
    expect(new Set(smtp.messages.flatMap((m) => m.to)).size).toBe(240);
  }, 90_000);

  it("shares one queue and one hourly budget with an immediate campaign", async () => {
    vi.stubEnv("SMTP_MAX_EMAILS_PER_HOUR", "10");
    const now = at("2026-10-15T07:50:00.000Z");
    vi.useFakeTimers({ toFake: ["Date"], now });
    const immediate = await draftViaApi(await audience(6), "Now");
    const later = await draftViaApi(await audience(6), "Later");
    await scheduleViaApi(later, "2026-10-15", "10:00", "Europe/Madrid", now);

    expect((await sendApi(request(), ctx(immediate))).status).toBe(200);
    await activateDueCampaigns({ now: at("2026-10-15T08:00:00.000Z") });
    const tick = await runTick({ timeBudgetMs: 10_000, now: at("2026-10-15T08:00:00.000Z") });

    // Twelve are queued between them, in one table; the one budget lets nine through.
    expect(tick.sent).toBe(9);
    expect(smtp.messages).toHaveLength(9);
    expect(await sentInLastHour()).toBe(9);
    const [{ n }] = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM campaign_recipients`;
    expect(Number(n)).toBe(12);
  });

  it("retries a temporary failure like any other queued mail", async () => {
    const listId = await audience(3);
    const now = at("2026-10-15T07:50:00.000Z");
    vi.useFakeTimers({ toFake: ["Date"], now });
    const id = await draftViaApi(listId);
    await scheduleViaApi(id, "2026-10-15", "10:00", "Europe/Madrid", now);
    const [firstRow] = await sql<{ email: string }[]>`SELECT email FROM contacts ORDER BY email LIMIT 1`;
    smtp.rejectRecipients.set(firstRow.email, 451);

    const tick = await runTick({ timeBudgetMs: 10_000, now: at("2026-10-15T08:00:00.000Z") });

    expect(tick).toMatchObject({ activatedCampaigns: 1, sent: 2, retried: 1 });
    const rows = await recipientRows(id);
    expect(rows.filter((r) => r.delivery_status === "QUEUED")).toHaveLength(1);
    expect((await getCampaign(id)).status).toBe("SENDING");
  });
});

describe("cancelling before the start, through the API", () => {
  it("means nothing is queued and nothing is sent when the time comes", async () => {
    const listId = await audience(5);
    const now = at("2026-10-15T07:50:00.000Z");
    vi.useFakeTimers({ toFake: ["Date"], now });
    const id = await draftViaApi(listId);
    await scheduleViaApi(id, "2026-10-15", "10:00", "Europe/Madrid", now);

    const cancelled = await cancelScheduledApi(request(), ctx(id));

    expect(cancelled.status).toBe(200);
    expect(await getCampaign(id)).toMatchObject({ status: "CANCELLED" });
    expect(await listRow(id)).toMatchObject({ status: "CANCELLED", scheduledAt: "2026-10-15T08:00:00.000Z" });

    const tick = await runTick({ timeBudgetMs: 10_000, now: at("2026-10-15T09:00:00.000Z") });
    expect(tick).toMatchObject({ activatedCampaigns: 0, sent: 0, claimed: 0 });
    expect(await recipientRows(id)).toHaveLength(0);
    expect(smtp.messages).toHaveLength(0);
  });

  it("is refused, with a conflict, once the campaign has been queued", async () => {
    const listId = await audience(5);
    const now = at("2026-10-15T07:50:00.000Z");
    vi.useFakeTimers({ toFake: ["Date"], now });
    const id = await draftViaApi(listId);
    await scheduleViaApi(id, "2026-10-15", "10:00", "Europe/Madrid", now);
    await activateDueCampaigns({ now: at("2026-10-15T08:00:00.000Z") });

    const cancelled = await cancelScheduledApi(request(), ctx(id));

    expect(cancelled.status).toBe(409);
    expect((await getCampaign(id)).status).toBe("QUEUED");
    await runTick({ timeBudgetMs: 10_000, now: at("2026-10-15T08:00:00.000Z") });
    expect(smtp.messages).toHaveLength(5);
  });
});

describe("restarting the scheduler around the scheduled time (10:00 in Madrid)", () => {
  async function scheduledForTen() {
    const listId = await audience(4);
    const now = at("2026-10-15T07:40:00.000Z"); // 09:40 in Madrid
    vi.useFakeTimers({ toFake: ["Date"], now });
    const id = await draftViaApi(listId);
    await scheduleViaApi(id, "2026-10-15", "10:00", "Europe/Madrid", now);
    vi.useRealTimers();
    return id;
  }

  it("stopped at 09:50, started again at 09:55: the campaign starts at 10:00", async () => {
    const id = await scheduledForTen();
    await runTick({ timeBudgetMs: 10_000, now: at("2026-10-15T07:50:00.000Z") });

    await restartProcess(); // the process is gone; only the database remains

    expect((await runTick({ timeBudgetMs: 10_000, now: at("2026-10-15T07:55:00.000Z") })).activatedCampaigns).toBe(0);
    expect(await getCampaign(id)).toMatchObject({ status: "SCHEDULED" });
    expect(await getScheduledAtUtc(id)).toBe("2026-10-15T08:00:00.000Z");

    const atTen = await runTick({ timeBudgetMs: 10_000, now: at("2026-10-15T08:00:00.000Z") });
    expect(atTen).toMatchObject({ activatedCampaigns: 1, sent: 4 });
    expect((await getCampaign(id)).status).toBe("COMPLETED");
  });

  it("stopped at 09:50, started again at 10:15: found overdue and queued, once", async () => {
    const id = await scheduledForTen();
    await restartProcess();

    const late = await runTick({ timeBudgetMs: 10_000, now: at("2026-10-15T08:15:00.000Z") });

    expect(late).toMatchObject({ activatedCampaigns: 1, sent: 4 });
    expect((await getCampaign(id)).status).toBe("COMPLETED");
    const [line] = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .filter((c) => c[0] === "[scheduler] activated campaign");
    expect(line[1]).toMatchObject({ campaignId: id, scheduledAt: "2026-10-15T08:00:00.000Z", lateSeconds: 15 * 60 });

    // Further restarts change nothing.
    await restartProcess();
    expect((await runTick({ timeBudgetMs: 10_000, now: at("2026-10-15T08:30:00.000Z") })).activatedCampaigns).toBe(0);
    expect(smtp.messages).toHaveLength(4);
  });

  it("does not start a cancelled campaign after the restart, and does start the others that were missed", async () => {
    const cancelledId = await scheduledForTen();
    const keptId = await scheduledForTen();
    await cancelScheduledApi(request(), ctx(cancelledId));
    await restartProcess();

    const result = await activateDueCampaigns({ now: at("2026-10-15T08:15:00.000Z") });

    expect(result).toMatchObject({ due: 1, activated: 1 });
    expect((await getCampaign(cancelledId)).status).toBe("CANCELLED");
    expect((await getCampaign(keptId)).status).toBe("QUEUED");
  });

  it("lets two schedulers race for it and start it once", async () => {
    const id = await scheduledForTen();

    const [a, b] = await Promise.all([
      activateDueCampaigns({ now: at("2026-10-15T08:00:00.000Z") }),
      activateDueCampaigns({ now: at("2026-10-15T08:00:00.000Z") }),
    ]);

    expect(a.activated + b.activated).toBe(1);
    expect(await recipientRows(id)).toHaveLength(4);
  });
});

describe("the scheduler's boundary with the clock", () => {
  it("treats a campaign due exactly now as due, and one a millisecond ahead as not due", async () => {
    const listId = await audience(2);
    const now = at("2026-10-15T07:50:00.000Z");
    vi.useFakeTimers({ toFake: ["Date"], now });
    const id = await draftViaApi(listId);
    await scheduleViaApi(id, "2026-10-15", "10:00", "Europe/Madrid", now);

    expect((await activateDueCampaigns({ now: at("2026-10-15T07:59:59.999Z") })).due).toBe(0);
    expect((await activateDueCampaigns({ now: at("2026-10-15T08:00:00.000Z") })).activated).toBe(1);
  });
});

describe("the scheduler has no way to send mail itself", () => {
  it("does not import the mailer, and a cycle with a working SMTP server sends nothing", async () => {
    const source = readFileSync("src/lib/campaign-activation.ts", "utf8");
    expect(source).not.toMatch(/nodemailer|from "\.\/mailer"|sendMessage|createTransport/);

    const listId = await audience(3);
    const now = at("2026-10-15T07:50:00.000Z");
    vi.useFakeTimers({ toFake: ["Date"], now });
    const id = await draftViaApi(listId);
    await scheduleViaApi(id, "2026-10-15", "10:00", "Europe/Madrid", now);

    await activateDueCampaigns({ now: at("2026-10-15T08:00:00.000Z") });

    expect(smtp.messages).toHaveLength(0);
    expect(await countByStatus(id)).toEqual({ QUEUED: 3 });
  });

  it("queues through the very routine the immediate Send button uses", () => {
    // The Send route hands the campaign to `sendDraftCampaign`, which is where the routine is called.
    const route = readFileSync("src/app/api/campaigns/[id]/send/route.ts", "utf8");
    const send = readFileSync("src/lib/campaign-send.ts", "utf8");
    const activation = readFileSync("src/lib/campaign-activation.ts", "utf8");
    expect(route).toMatch(/sendDraftCampaign\(id\)/);
    expect(send).toMatch(/queueCampaign\(campaignId, "DRAFT"\)/);
    expect(activation).toMatch(/queueCampaign\(candidate\.id, "SCHEDULED"/);
  });
});

describe("immediate send needs no schedule", () => {
  it("queues, sends and completes without any scheduledAt anywhere", async () => {
    const listId = await audience(4);
    const id = await draftViaApi(listId, "Now");

    const sent = await sendApi(request(), ctx(id));

    expect(sent.status).toBe(200);
    expect(await getScheduledAtUtc(id)).toBeNull();
    expect(await listRow(id)).toMatchObject({ status: "QUEUED", scheduledAt: null, estimatedRecipients: null });
    await runTick({ timeBudgetMs: 10_000 });
    expect((await getCampaign(id)).status).toBe("COMPLETED");
    expect(smtp.messages).toHaveLength(4);
  });
});
