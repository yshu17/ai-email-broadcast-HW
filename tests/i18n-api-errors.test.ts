import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Error texts an API route sends back are worded in the language the page asked for
 * (`x-locale`), and in English when nothing asks — which is what scripts, cron and
 * every existing test see.
 */
const language = vi.hoisted(() => ({ locale: "en" as "ru" | "en" }));

vi.mock("@/i18n/server", () => ({
  getLocale: async () => language.locale,
  getApiLocale: async () => language.locale,
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    requireUser: async () => ({ id: "test-admin", email: "admin@example.test" }),
    requireAdminMutation: async () => ({ id: "test-admin", email: "admin@example.test" }),
    assertSameOrigin: async () => undefined,
  };
});

import { sql } from "@/lib/db";
import { GET as getCampaign, PATCH as patchCampaign } from "@/app/api/campaigns/[id]/route";
import { POST as cancelScheduled } from "@/app/api/campaigns/[id]/cancel-scheduled/route";
import { POST as scheduleCampaign } from "@/app/api/campaigns/[id]/schedule/route";
import { POST as sendCampaign } from "@/app/api/campaigns/[id]/send/route";
import { POST as createContact } from "@/app/api/contacts/route";
import { createCampaign, resetDatabase } from "./helpers";

beforeEach(async () => {
  language.locale = "en";
  await resetDatabase();
});
afterAll(async () => { await sql.end(); });

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (body: unknown, method = "POST") =>
  new Request("https://mail.example.test/api", {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
const MISSING = "00000000-0000-4000-8000-000000000000";

async function errorOf(response: Response) {
  return (await response.json()) as { error: string; code?: string; field?: string };
}

describe("the same error in both languages", () => {
  it("reads as it always did in English", async () => {
    const response = await getCampaign(json(undefined, "GET"), ctx(MISSING));

    expect(response.status).toBe(404);
    expect((await errorOf(response)).error).toBe("Campaign not found");
  });

  it("reads in Russian when the page is in Russian", async () => {
    language.locale = "ru";

    const response = await getCampaign(json(undefined, "GET"), ctx(MISSING));

    expect(response.status).toBe(404);
    expect((await errorOf(response)).error).toBe("Рассылка не найдена");
  });

  it("keeps the HTTP status whatever the language", async () => {
    const id = await createCampaign({ status: "QUEUED" });
    const en = await sendCampaign(json(undefined), ctx(id));
    language.locale = "ru";
    const ru = await sendCampaign(json(undefined), ctx(id));

    expect(en.status).toBe(409);
    expect(ru.status).toBe(409);
    expect((await errorOf(en)).error).toBe("This campaign is already QUEUED");
    expect((await errorOf(ru)).error).toBe("Рассылка уже в статусе «В очереди»");
  });
});

describe("what is filled into a message", () => {
  it("names a status the way the interface does, so a message never mixes languages", async () => {
    const id = await createCampaign({ status: "SENDING" });
    language.locale = "ru";

    const response = await cancelScheduled(json(undefined), ctx(id));

    expect(response.status).toBe(409);
    expect((await errorOf(response)).error).toBe("Здесь можно отменить только запланированную рассылку; эта в статусе «Отправляется»");
  });

  it("names a field the way the form labels it", async () => {
    const id = await createCampaign();
    const tooLong = "x".repeat(201);

    const en = await patchCampaign(json({ name: tooLong }, "PATCH"), ctx(id));
    language.locale = "ru";
    const ru = await patchCampaign(json({ name: tooLong }, "PATCH"), ctx(id));

    expect((await errorOf(en)).error).toBe("Campaign name must be at most 200 characters");
    expect((await errorOf(ru)).error).toBe("Название рассылки: не более 200 символов");
  });

  it("fills in numbers", async () => {
    language.locale = "ru";
    const response = await createContact(json({ email: "a@example.test", firstName: "x".repeat(300) }));

    expect((await errorOf(response)).error).toBe("Имя: не более 200 символов");
  });

  it("words a missing required field in each language", async () => {
    const en = await createContact(json({ email: "" }));
    language.locale = "ru";
    const ru = await createContact(json({ email: "" }));

    expect((await errorOf(en)).error).toBe("Email is required");
    expect((await errorOf(ru)).error).toBe("Эл. почта: обязательное поле");
  });
});

describe("structured errors keep their machine-readable parts", () => {
  it("keeps code and field on a schedule error, and words the message in the language asked for", async () => {
    const id = await createCampaign();
    language.locale = "ru";

    const response = await scheduleCampaign(json({ scheduledAt: "2020-01-01T00:00:00Z" }), ctx(id));

    expect(response.status).toBe(400);
    expect(await errorOf(response)).toEqual({
      error: "Время отправки должно быть в будущем.", code: "SCHEDULE_PAST", field: "scheduledAt",
    });
  });

  it("gives the English wording of every schedule rule when nothing asks for Russian", async () => {
    const id = await createCampaign();
    const cases: [unknown, string, RegExp][] = [
      [undefined, "SCHEDULE_REQUIRED", /required/],
      ["2099-10-15T10:30", "SCHEDULE_FORMAT", /time zone/],
      ["2099-02-31T10:00:00Z", "SCHEDULE_INVALID", /valid date/],
      ["2020-01-01T00:00:00Z", "SCHEDULE_PAST", /future/],
    ];
    for (const [value, code, message] of cases) {
      const body = await errorOf(await scheduleCampaign(json({ scheduledAt: value }), ctx(id)));
      expect(body.code).toBe(code);
      expect(body.error).toMatch(message);
    }
  });

  it("has a Russian wording for every schedule rule too", async () => {
    const id = await createCampaign();
    language.locale = "ru";
    for (const value of [undefined, "2099-10-15T10:30", "2099-02-31T10:00:00Z", "2020-01-01T00:00:00Z"]) {
      const { error } = await errorOf(await scheduleCampaign(json({ scheduledAt: value }), ctx(id)));
      expect(error).toMatch(/[А-Яа-я]/);
    }
  });
});
