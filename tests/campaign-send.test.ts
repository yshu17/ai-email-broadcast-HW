import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "@/lib/db";
import { POST as sendCampaign } from "@/app/api/campaigns/[id]/send/route";
import {
  addContact, countByStatus, createCampaign, createList, getCampaign, resetDatabase, suppress,
} from "./helpers";

/**
 * Immediate send, pinned down before and after it was refactored onto the shared
 * queueing service that scheduled campaigns also use.
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

beforeEach(async () => {
  await resetDatabase();
  vi.stubEnv("SMTP_HOST", "smtp.example.test");
  vi.stubEnv("SMTP_PORT", "587");
  vi.stubEnv("SMTP_FROM_EMAIL", "news@example.test");
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => { await sql.end(); });

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const send = (id: string) => sendCampaign(new Request("https://mail.example.test/api", { method: "POST" }), ctx(id));

async function listWith(...emails: string[]) {
  const listId = await createList("Subscribers");
  for (const email of emails) await addContact(listId, email);
  return listId;
}

describe("POST /api/campaigns/:id/send", () => {
  it("queues one recipient row per unique address and reports the numbers", async () => {
    const listA = await listWith("a@example.com", "shared@example.com");
    const listB = await listWith("shared@example.com", "b@example.com");
    const id = await createCampaign({ listIds: [listA, listB] });

    const response = await send(id);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, inserted: 3, total: 3, duplicatesRemoved: 1 });
    const row = await getCampaign(id);
    expect(row.status).toBe("QUEUED");
    expect(row.total_recipients).toBe(3);
    expect(await countByStatus(id)).toEqual({ QUEUED: 3 });
  });

  it("leaves suppressed addresses out of the queue", async () => {
    const list = await listWith("ok@example.com", "gone@example.com");
    await suppress("gone@example.com");
    const id = await createCampaign({ listIds: [list] });

    const body = await (await send(id)).json();

    expect(body).toMatchObject({ total: 1, skippedSuppressed: 1 });
  });

  it("returns 404 for an unknown campaign", async () => {
    expect((await send("00000000-0000-0000-0000-000000000000")).status).toBe(404);
  });

  it.each(["SCHEDULED", "QUEUED", "SENDING", "PAUSED", "COMPLETED", "CANCELLED"] as const)(
    "returns 409 for a campaign that is already %s",
    async (status) => {
      const list = await listWith("a@example.com");
      const id = await createCampaign({
        listIds: [list], status, scheduledAt: status === "SCHEDULED" ? new Date(Date.now() + 86_400_000) : null,
      });

      const response = await send(id);

      expect(response.status).toBe(409);
      expect((await response.json()).error).toContain(status);
      expect((await getCampaign(id)).status).toBe(status);
      expect(await countByStatus(id)).toEqual({});
    },
  );

  it.each([
    ["has no subject", { subject: " " }, /subject/i],
    ["has an empty body", { html: " " }, /body is empty/i],
  ])("returns 400 when the campaign %s, leaving it a DRAFT", async (_label, overrides, message) => {
    const list = await listWith("a@example.com");
    const id = await createCampaign({ listIds: [list], ...overrides });

    const response = await send(id);

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(message);
    expect((await getCampaign(id)).status).toBe("DRAFT");
  });

  it("returns 400 when SMTP is not configured", async () => {
    vi.stubEnv("SMTP_HOST", "");
    const list = await listWith("a@example.com");
    const id = await createCampaign({ listIds: [list] });

    const response = await send(id);

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/smtp/i);
    expect((await getCampaign(id)).status).toBe("DRAFT");
  });

  it("returns 400 and rolls back to DRAFT when there is nobody to send to", async () => {
    const list = await listWith("gone@example.com");
    await suppress("gone@example.com");
    const id = await createCampaign({ listIds: [list] });

    const response = await send(id);

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/no recipients/i);
    expect((await getCampaign(id)).status).toBe("DRAFT");
    expect(await countByStatus(id)).toEqual({});
  });

  it("lets exactly one of two simultaneous clicks queue the campaign", async () => {
    const list = await listWith("a@example.com", "b@example.com", "c@example.com");
    const id = await createCampaign({ listIds: [list] });

    const responses = await Promise.all([send(id), send(id)]);

    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await countByStatus(id)).toEqual({ QUEUED: 3 });
    expect((await getCampaign(id)).total_recipients).toBe(3);
  });

  it("does not record a scheduledAt for an immediate send", async () => {
    const list = await listWith("a@example.com");
    const id = await createCampaign({ listIds: [list] });
    await send(id);
    expect((await getCampaign(id)).scheduled_at).toBeNull();
  });
});
