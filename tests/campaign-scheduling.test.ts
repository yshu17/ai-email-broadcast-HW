import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "@/lib/db";
import { POST as scheduleCampaign } from "@/app/api/campaigns/[id]/schedule/route";
import { POST as sendCampaign } from "@/app/api/campaigns/[id]/send/route";
import { PATCH as patchCampaign, GET as getCampaignApi } from "@/app/api/campaigns/[id]/route";
import { GET as listCampaigns } from "@/app/api/campaigns/route";
import { formatScheduledTime, toScheduledAt } from "@/lib/scheduling";
import { POST as duplicateCampaign } from "@/app/api/campaigns/[id]/duplicate/route";
import {
  addContact, countByStatus, createCampaign, createList, getCampaign, getScheduledAtUtc, resetDatabase,
} from "./helpers";

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
  vi.stubEnv("SMTP_HOST", "smtp.example.test");
  vi.stubEnv("SMTP_PORT", "587");
  vi.stubEnv("SMTP_FROM_EMAIL", "news@example.test");
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => { await sql.end(); });

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const jsonRequest = (body: unknown, method = "POST") =>
  new Request("https://mail.example.test/api", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const inFuture = (ms: number) => new Date(Date.now() + ms).toISOString();
const DAY = 24 * 60 * 60 * 1000;

/** A DRAFT that would be accepted for sending: content, one list, one contact. */
async function readyCampaign(overrides: Parameters<typeof createCampaign>[0] = {}) {
  const listId = await createList("Subscribers");
  await addContact(listId, "reader@example.com", "Reader");
  return createCampaign({ listIds: [listId], ...overrides });
}

describe("POST /api/campaigns/:id/schedule", () => {
  it("moves a DRAFT to SCHEDULED and stores the requested instant", async () => {
    const id = await readyCampaign();
    const when = inFuture(2 * DAY);

    const response = await schedule(id, when);

    expect(response.status).toBe(200);
    const row = await getCampaign(id);
    expect(row.status).toBe("SCHEDULED");
    expect(await getScheduledAtUtc(id)).toBe(when);
  });

  it("stores UTC even when the client sent a local offset", async () => {
    const id = await readyCampaign();
    const future = new Date(Date.now() + 2 * DAY);
    future.setUTCSeconds(0, 0);
    const utc = future.toISOString();
    // The same instant, written as UTC+03:00 wall-clock time.
    const local = new Date(future.getTime() + 3 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "+03:00");

    expect((await schedule(id, local)).status).toBe(200);
    expect(await getScheduledAtUtc(id)).toBe(utc);
  });

  it("does not queue recipients or send anything yet", async () => {
    const id = await readyCampaign();
    await schedule(id, inFuture(DAY));

    expect(await countByStatus(id)).toEqual({});
    expect((await getCampaign(id)).total_recipients).toBe(0);
  });

  it("returns the stored instant so the client can display it", async () => {
    const id = await readyCampaign();
    const when = inFuture(DAY);
    const body = await (await schedule(id, when)).json();
    expect(body).toMatchObject({ ok: true, scheduledAt: when });
  });

  it("rejects a time in the past and leaves the campaign a DRAFT", async () => {
    const id = await readyCampaign();

    const response = await schedule(id, inFuture(-60_000));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/future/i);
    const row = await getCampaign(id);
    expect(row.status).toBe("DRAFT");
    expect(row.scheduled_at).toBeNull();
  });

  it.each([
    ["a missing value", undefined],
    ["an empty string", ""],
    ["a number", 1_900_000_000_000],
    ["a date without a time zone", "2099-10-15T10:30"],
    ["garbage", "next tuesday"],
    ["an impossible calendar date", "2099-02-31T10:00:00Z"],
  ])("rejects %s with 400", async (_label, value) => {
    const id = await readyCampaign();
    const response = await schedule(id, value);
    expect(response.status).toBe(400);
    expect((await getCampaign(id)).status).toBe("DRAFT");
  });

  it("returns 404 for an unknown campaign", async () => {
    const response = await schedule("00000000-0000-0000-0000-000000000000", inFuture(DAY));
    expect(response.status).toBe(404);
  });

  it.each(["QUEUED", "SENDING", "PAUSED", "COMPLETED", "CANCELLED"] as const)(
    "refuses a campaign that is already %s",
    async (status) => {
      const id = await readyCampaign({ status });
      expect((await schedule(id, inFuture(DAY))).status).toBe(409);
      const row = await getCampaign(id);
      expect(row.status).toBe(status);
      expect(row.scheduled_at).toBeNull();
    },
  );

  it("refuses to reschedule an already SCHEDULED campaign, keeping the original time", async () => {
    const original = new Date(Date.now() + DAY);
    const id = await readyCampaign({ status: "SCHEDULED", scheduledAt: original });

    expect((await schedule(id, inFuture(3 * DAY))).status).toBe(409);
    expect(await getScheduledAtUtc(id)).toBe(original.toISOString());
  });

  it("applies the same readiness rules as an immediate send", async () => {
    const noSubject = await readyCampaign({ subject: "  " });
    const noBody = await readyCampaign({ html: "  " });
    const noRecipients = await createCampaign({ listIds: [await createList("Empty")] });

    for (const id of [noSubject, noBody, noRecipients]) {
      expect((await schedule(id, inFuture(DAY))).status).toBe(400);
      expect((await getCampaign(id)).status).toBe("DRAFT");
    }
  });

  it("requires SMTP to be configured, like an immediate send", async () => {
    vi.stubEnv("SMTP_HOST", "");
    const id = await readyCampaign();
    const response = await schedule(id, inFuture(DAY));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/smtp/i);
  });

  it("lets exactly one of two simultaneous requests win", async () => {
    const id = await readyCampaign();
    const responses = await Promise.all([schedule(id, inFuture(DAY)), schedule(id, inFuture(2 * DAY))]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  });
});

describe("validation errors are structured, so the form can show them beside the field", () => {
  it("names the rule that failed and the field it concerns", async () => {
    const id = await readyCampaign();

    const past = await schedule(id, inFuture(-60_000));
    expect(past.status).toBe(400);
    expect(await past.json()).toMatchObject({
      code: "SCHEDULE_PAST",
      field: "scheduledAt",
      error: expect.stringMatching(/future/i),
    });

    const missing = await schedule(id, undefined);
    expect(await missing.json()).toMatchObject({ code: "SCHEDULE_REQUIRED", field: "scheduledAt" });

    const noZone = await schedule(id, "2099-10-15T10:30");
    expect(await noZone.json()).toMatchObject({ code: "SCHEDULE_FORMAT", field: "scheduledAt" });

    const impossible = await schedule(id, "2099-02-31T10:00:00Z");
    expect(await impossible.json()).toMatchObject({ code: "SCHEDULE_INVALID", field: "scheduledAt" });
  });

  it("does not tag non-schedule errors with a schedule code", async () => {
    const id = await readyCampaign({ subject: " " });
    const body = await (await schedule(id, inFuture(DAY))).json();
    expect(body.error).toMatch(/subject/i);
    expect(body.code).toBeUndefined();
  });
});

describe("the server judges the time by its own clock", () => {
  afterEach(() => vi.useRealTimers());

  const at = (iso: string) => vi.useFakeTimers({ toFake: ["Date"], now: new Date(iso) });

  it("refuses 12:00 when the server says it is already 14:00 that day", async () => {
    const id = await readyCampaign();
    at("2026-10-10T14:00:00Z");

    const response = await schedule(id, "2026-10-10T12:00:00Z");

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("SCHEDULE_PAST");
    expect((await getCampaign(id)).status).toBe("DRAFT");
  });

  it("refuses a time that is exactly the current instant, and accepts the next millisecond", async () => {
    const id = await readyCampaign();
    at("2026-10-10T14:00:00.000Z");

    expect((await schedule(id, "2026-10-10T14:00:00.000Z")).status).toBe(400);
    expect((await schedule(id, "2026-10-10T14:00:00.001Z")).status).toBe(200);
    expect(await getScheduledAtUtc(id)).toBe("2026-10-10T14:00:00.001Z");
  });

  it("refuses a time that was still in the future when the form was opened, but is not any more", async () => {
    const id = await readyCampaign();
    at("2026-10-10T14:00:00Z");
    // The form validated 14:05 fine, then sat open.
    const chosen = "2026-10-10T14:05:00Z";
    vi.setSystemTime(new Date("2026-10-10T14:06:00Z"));

    const response = await schedule(id, chosen);

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("SCHEDULE_PAST");
    expect((await getCampaign(id)).status).toBe("DRAFT");
  });

  it("does not care which offset the client wrote the same instant in", async () => {
    at("2026-10-10T14:00:00Z");
    const east = await readyCampaign();
    const west = await readyCampaign();

    // Both are 15:30Z, written as UTC+03:00 and UTC-05:00 wall-clock times.
    expect((await schedule(east, "2026-10-10T18:30:00+03:00")).status).toBe(200);
    expect((await schedule(west, "2026-10-10T10:30:00-05:00")).status).toBe(200);
    expect(await getScheduledAtUtc(east)).toBe("2026-10-10T15:30:00.000Z");
    expect(await getScheduledAtUtc(west)).toBe("2026-10-10T15:30:00.000Z");
  });

  it("handles a schedule that crosses midnight and the autumn DST change", async () => {
    at("2026-10-24T22:30:00Z");
    const id = await readyCampaign();
    // 2026-10-25 04:00 in Kyiv is 02:00Z once clocks have gone back to UTC+2.
    expect((await schedule(id, "2026-10-25T04:00:00+02:00")).status).toBe(200);
    expect(await getScheduledAtUtc(id)).toBe("2026-10-25T02:00:00.000Z");
  });

  it("answers a repeated request with 409 and leaves the first schedule untouched", async () => {
    const id = await readyCampaign();
    at("2026-10-10T14:00:00Z");

    expect((await schedule(id, "2026-10-10T16:00:00Z")).status).toBe(200);
    const repeat = await schedule(id, "2026-10-10T16:00:00Z");
    const other = await schedule(id, "2026-10-10T18:00:00Z");

    expect(repeat.status).toBe(409);
    expect(other.status).toBe(409);
    expect(await getScheduledAtUtc(id)).toBe("2026-10-10T16:00:00.000Z");
  });
});

describe("from the user's time zone to the database and back", () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    vi.useRealTimers();
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  const NOW = new Date("2026-09-24T12:00:00Z");
  /** What the browser does: read the wall-clock time in the user's zone, send the UTC instant. */
  function userSchedules(id: string, timeZone: string, date: string, time: string, now = NOW) {
    const chosen = toScheduledAt(date, time, now, { timeZone });
    if (!chosen.ok) throw new Error(`the form refused it: ${chosen.error}`);
    return schedule(id, chosen.date.toISOString());
  }

  it("keeps 15.10.2026 10:30 in Madrid as 08:30 UTC, whatever zone the server runs in", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    process.env.TZ = "Pacific/Auckland"; // the server is nowhere near the user
    const id = await readyCampaign();

    expect((await userSchedules(id, "Europe/Madrid", "2026-10-15", "10:30")).status).toBe(200);

    expect(await getScheduledAtUtc(id)).toBe("2026-10-15T08:30:00.000Z");
    const row = (await (await listCampaigns()).json()).campaigns[0];
    expect(row.scheduledAt).toBe("2026-10-15T08:30:00.000Z");
  });

  it("stores the same instant for users in different zones who mean the same moment", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    const madrid = await readyCampaign();
    const tokyo = await readyCampaign();
    const newYork = await readyCampaign();

    await userSchedules(madrid, "Europe/Madrid", "2026-10-15", "10:30");
    await userSchedules(tokyo, "Asia/Tokyo", "2026-10-15", "17:30");
    await userSchedules(newYork, "America/New_York", "2026-10-15", "04:30");

    for (const id of [madrid, tokyo, newYork]) {
      expect(await getScheduledAtUtc(id)).toBe("2026-10-15T08:30:00.000Z");
    }
  });

  it("stores the right instant either side of a daylight saving change", async () => {
    const march = new Date("2026-03-01T00:00:00Z");
    vi.useFakeTimers({ toFake: ["Date"], now: march });
    const before = await readyCampaign();
    const after = await readyCampaign();

    // Madrid, 29 March 2026: 01:59 is still winter time; 03:00 is the first minute of summer time.
    await userSchedules(before, "Europe/Madrid", "2026-03-29", "01:59", march);
    await userSchedules(after, "Europe/Madrid", "2026-03-29", "03:00", march);

    expect(await getScheduledAtUtc(before)).toBe("2026-03-29T00:59:00.000Z");
    expect(await getScheduledAtUtc(after)).toBe("2026-03-29T01:00:00.000Z");
  });

  it("shows the stored instant back as the same wall-clock time, with no offset applied twice", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    const id = await readyCampaign();
    await userSchedules(id, "Europe/Madrid", "2026-10-15", "10:30");

    const { scheduledAt } = (await (await getCampaignApi(new Request("https://mail.example.test/api"), ctx(id))).json()).campaign;

    expect(scheduledAt).toBe("2026-10-15T08:30:00.000Z");
    expect(formatScheduledTime(scheduledAt, { locale: "en-GB", timeZone: "Europe/Madrid" })).toContain("10:30");
    expect(formatScheduledTime(scheduledAt, { locale: "en-GB", timeZone: "Asia/Tokyo" })).toContain("17:30");
    expect(formatScheduledTime(scheduledAt, { locale: "en-GB", timeZone: "UTC" })).toContain("08:30");
  });
});

describe("a SCHEDULED campaign", () => {
  it("cannot be edited, like any campaign that has left DRAFT", async () => {
    const id = await readyCampaign({ status: "SCHEDULED", scheduledAt: new Date(Date.now() + DAY) });
    const response = await patchCampaign(jsonRequest({ subject: "Changed" }, "PATCH"), ctx(id));
    expect(response.status).toBe(409);
  });

  it("cannot be sent immediately through the old endpoint", async () => {
    const id = await readyCampaign({ status: "SCHEDULED", scheduledAt: new Date(Date.now() + DAY) });
    const response = await sendCampaign(jsonRequest({}), ctx(id));
    expect(response.status).toBe(409);
    expect((await getCampaign(id)).status).toBe("SCHEDULED");
  });

  it("is exposed with its scheduledAt by the detail and list APIs", async () => {
    const at = new Date(Date.now() + DAY);
    const id = await readyCampaign({ status: "SCHEDULED", scheduledAt: at });

    const detail = await (await getCampaignApi(new Request("https://mail.example.test/"), ctx(id))).json();
    expect(detail.campaign.status).toBe("SCHEDULED");
    expect(detail.campaign.scheduledAt).toBe(at.toISOString());

    const list = await (await listCampaigns()).json();
    expect(list.campaigns[0]).toMatchObject({ id, status: "SCHEDULED", scheduledAt: at.toISOString() });
  });

  it("duplicates into a plain DRAFT with no schedule", async () => {
    const id = await readyCampaign({ status: "SCHEDULED", scheduledAt: new Date(Date.now() + DAY) });
    const { campaign } = await (await duplicateCampaign(jsonRequest({}), ctx(id))).json();

    const copy = await getCampaign(campaign.id);
    expect(copy.status).toBe("DRAFT");
    expect(copy.scheduled_at).toBeNull();
  });

  it("is impossible to store without a scheduledAt", async () => {
    await expect(createCampaign({ status: "SCHEDULED", scheduledAt: null })).rejects.toThrow();
  });
});

describe("immediate send is unchanged", () => {
  it("still moves a DRAFT to QUEUED, queues recipients and leaves scheduledAt null", async () => {
    const id = await readyCampaign();

    const response = await sendCampaign(jsonRequest({}), ctx(id));

    expect(response.status).toBe(200);
    const row = await getCampaign(id);
    expect(row.status).toBe("QUEUED");
    expect(row.scheduled_at).toBeNull();
    expect(await countByStatus(id)).toEqual({ QUEUED: 1 });
  });

  it("ignores a scheduledAt smuggled into the send request", async () => {
    const id = await readyCampaign();
    await sendCampaign(jsonRequest({ scheduledAt: inFuture(DAY) }), ctx(id));
    expect((await getCampaign(id)).scheduled_at).toBeNull();
  });
});

function schedule(id: string, scheduledAt: unknown) {
  return scheduleCampaign(jsonRequest({ scheduledAt }), ctx(id));
}
