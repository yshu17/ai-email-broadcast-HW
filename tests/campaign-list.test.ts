import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "@/lib/db";
import { GET as listCampaigns } from "@/app/api/campaigns/route";
import { POST as sendCampaign } from "@/app/api/campaigns/[id]/send/route";
import { activateDueCampaigns } from "@/lib/campaign-activation";
import * as recipients from "@/lib/campaign-recipients";
import {
  addContact, createCampaign, createList, getCampaign, getScheduledAtUtc, resetDatabase, suppress,
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
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
afterAll(async () => { await sql.end(); });

type Row = {
  id: string; name: string; status: string; scheduledAt: string | null;
  totalRecipients: number; estimatedRecipients: number | null;
};

async function list(): Promise<Row[]> {
  const response = await listCampaigns();
  expect(response.status).toBe(200);
  return (await response.json()).campaigns;
}

const HOUR = 60 * 60 * 1000;

describe("GET /api/campaigns: scheduled campaigns", () => {
  it("lists a SCHEDULED campaign with its status and its scheduled time as an unambiguous UTC instant", async () => {
    const listId = await createList("Subscribers");
    await addContact(listId, "a@example.test");
    const id = await createCampaign({
      name: "Autumn sale", listIds: [listId], status: "SCHEDULED",
      scheduledAt: new Date("2099-10-15T08:30:00.000Z"),
    });

    const [row] = await list();

    expect(row).toMatchObject({ id, name: "Autumn sale", status: "SCHEDULED" });
    // ISO 8601 with an explicit Z: the same instant is stored, sent, and shown by every client.
    expect(row.scheduledAt).toBe("2099-10-15T08:30:00.000Z");
    expect(row.scheduledAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(await getScheduledAtUtc(id)).toBe("2099-10-15T08:30:00.000Z");
  });

  it("says nothing about a schedule for campaigns that are not scheduled", async () => {
    for (const status of ["DRAFT", "QUEUED", "SENDING", "PAUSED", "COMPLETED"] as const) {
      await createCampaign({ name: status, status });
    }

    const rows = await list();

    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row.scheduledAt).toBeNull();
      expect(row.estimatedRecipients).toBeNull();
    }
  });

  it("keeps a cancelled campaign's scheduled time for the record", async () => {
    await createCampaign({
      name: "Called off", status: "CANCELLED", scheduledAt: new Date(Date.now() + 24 * HOUR),
    });

    const [row] = await list();

    expect(row.status).toBe("CANCELLED");
    expect(row.scheduledAt).not.toBeNull();
    expect(row.estimatedRecipients).toBeNull();
  });

  it("shows every status side by side without disturbing the others", async () => {
    await createCampaign({ name: "draft", status: "DRAFT" });
    await createCampaign({ name: "scheduled", status: "SCHEDULED", scheduledAt: new Date(Date.now() + HOUR) });
    await createCampaign({ name: "sending", status: "SENDING" });
    await createCampaign({ name: "done", status: "COMPLETED" });

    const rows = await list();

    expect(Object.fromEntries(rows.map((r) => [r.name, r.status]))).toEqual({
      draft: "DRAFT", scheduled: "SCHEDULED", sending: "SENDING", done: "COMPLETED",
    });
  });
});

describe("GET /api/campaigns: the recipient estimate for a scheduled campaign", () => {
  /** Two overlapping lists and one unsubscribed address: 3 people will get the email. */
  async function audience() {
    const a = await createList("A");
    const b = await createList("B");
    await addContact(a, "one@example.test");
    await addContact(a, "shared@example.test");
    await addContact(b, "Shared@Example.test"); // the same person, differently cased
    await addContact(b, "two@example.test");
    await addContact(b, "gone@example.test");
    await suppress("gone@example.test");
    return [a, b];
  }

  it("counts each person once and leaves out anyone unsubscribed", async () => {
    const listIds = await audience();
    await createCampaign({
      status: "SCHEDULED", listIds, scheduledAt: new Date(Date.now() + HOUR),
    });

    const [row] = await list();

    expect(row.estimatedRecipients).toBe(3);
    // Nothing has been queued yet, so the stored total is still zero.
    expect(row.totalRecipients).toBe(0);
  });

  it("agrees with the audience preview the admin saw when scheduling", async () => {
    const listIds = await audience();
    await createCampaign({ status: "SCHEDULED", listIds, scheduledAt: new Date(Date.now() + HOUR) });

    const [row] = await list();

    expect((await recipients.previewAudience(listIds)).finalRecipients).toBe(row.estimatedRecipients);
  });

  it("matches what is actually queued when the campaign starts", async () => {
    const listIds = await audience();
    const id = await createCampaign({ status: "SCHEDULED", listIds, scheduledAt: new Date(Date.now() + HOUR) });
    const [before] = await list();

    await sql`UPDATE campaigns SET scheduled_at = now() - interval '1 second' WHERE id = ${id}`;
    await activateDueCampaigns();

    expect((await getCampaign(id)).total_recipients).toBe(before.estimatedRecipients);
    const [after] = await list();
    expect(after.status).toBe("QUEUED");
    expect(after.totalRecipients).toBe(3);
    expect(after.estimatedRecipients).toBeNull();
  });

  it("estimates each scheduled campaign from its own lists", async () => {
    const small = await createList("Small");
    const big = await createList("Big");
    await addContact(small, "s1@example.test");
    for (let i = 0; i < 5; i += 1) await addContact(big, `b${i}@example.test`);
    await createCampaign({ name: "small", status: "SCHEDULED", listIds: [small], scheduledAt: new Date(Date.now() + HOUR) });
    await createCampaign({ name: "big", status: "SCHEDULED", listIds: [big], scheduledAt: new Date(Date.now() + HOUR) });
    await createCampaign({ name: "empty", status: "SCHEDULED", scheduledAt: new Date(Date.now() + HOUR) });

    const rows = await list();

    expect(Object.fromEntries(rows.map((r) => [r.name, r.estimatedRecipients]))).toEqual({
      small: 1, big: 5, empty: 0,
    });
  });

  it("still lists the campaigns if the estimate cannot be worked out", async () => {
    await createCampaign({ name: "scheduled", status: "SCHEDULED", scheduledAt: new Date(Date.now() + HOUR) });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(recipients, "estimateRecipients").mockRejectedValue(new Error("database hiccup"));

    const [row] = await list();

    expect(row).toMatchObject({ name: "scheduled", status: "SCHEDULED", estimatedRecipients: null });
  });
});

describe("immediate send and the existing statuses are unaffected", () => {
  it("still queues a DRAFT straight away, with no schedule", async () => {
    const listId = await createList("Subscribers");
    await addContact(listId, "reader@example.com");
    const id = await createCampaign({ listIds: [listId] });

    const response = await sendCampaign(
      new Request("https://mail.example.test/api", { method: "POST" }),
      { params: Promise.resolve({ id }) },
    );

    expect(response.status).toBe(200);
    const [row] = await list();
    expect(row).toMatchObject({ id, status: "QUEUED", scheduledAt: null, totalRecipients: 1, estimatedRecipients: null });
  });
});
