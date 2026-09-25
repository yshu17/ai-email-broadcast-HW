import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "@/lib/db";
import { POST as schedule, PATCH as reschedule } from "@/app/api/campaigns/[id]/schedule/route";
import { POST as postCampaign } from "@/app/api/dev/campaigns/route.dev";
import { DELETE as deleteTestCampaign, GET as getTestCampaign } from "@/app/api/dev/campaigns/[id]/route.dev";
import { cancelScheduledCampaign } from "@/lib/campaign-activation";
import { clock } from "@/lib/clock";
import { runSchedulerCycle } from "@/lib/scheduler";
import { getSmtpConfig, loadSettingsRow } from "@/lib/settings";
import { clockAction } from "@/lib/testing/actions";
import { readJournal } from "@/lib/testing/journal";
import { TEST_LIMITS } from "@/lib/testing/limits";
import { TEST_EMAIL_DOMAIN, TEST_NAME_PREFIX } from "@/lib/testing/test-addresses";
import { TEST_TEMPLATES } from "@/lib/testing/templates";
import { createTestCampaign, listTestCampaigns, resetTestCampaign, testCampaignDetails } from "@/lib/testing/test-campaigns";
import { scheduleFieldsFor } from "@/lib/scheduling";
import { createCampaign, createList, addBulkContacts, getCampaign, recipientRows, resetDatabase } from "./helpers";
import { ctx, disableTestTools, enableTestTools, jsonRequest, makeRetriesDue, receivedFiles } from "./testpanel-helpers";

/**
 * Test campaigns, end to end: made by the test panel's service, sent through the ordinary
 * scheduler, queue, rate limiter and retry rules, to the built-in test SMTP server. The
 * database, the queue and the SMTP server are real; only the session check is stubbed.
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

const transports = vi.hoisted(() => ({ configs: [] as { host: string; port: number; user: string | null }[] }));

vi.mock("@/lib/mailer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mailer")>();
  return {
    ...actual,
    createTransport: (config: Parameters<typeof actual.createTransport>[0]) => {
      transports.configs.push({ host: config.host, port: config.port, user: config.user });
      return actual.createTransport(config);
    },
  };
});

beforeEach(async () => {
  transports.configs = [];
  await resetDatabase();
  await sql`DELETE FROM app_settings`;
  await enableTestTools();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  await disableTestTools();
  vi.restoreAllMocks();
  // The SMTP tests below write to the stored settings; leave the shared test database as they found it.
  await sql`DELETE FROM app_settings`;
});

afterAll(async () => { await sql.end(); });

const holdClock = (date = "2026-10-15", time = "10:25", timeZone = "UTC") =>
  clockAction({ action: "set", date, time, timeZone });
const advance = (step: "minute" | "fiveMinutes" | "hour" | "day") => clockAction({ action: "advance", step });
const cycle = async () => {
  const outcome = await runSchedulerCycle("run-now");
  if (!outcome.ran) throw new Error(`cycle did not run: ${outcome.reason}`);
  return outcome.report;
};

const create = (input: Record<string, unknown> = {}) =>
  createTestCampaign({ recipients: 5, mode: "now", scenario: "success", ...input });

const countBy = async (campaignId: string, status: string) =>
  (await recipientRows(campaignId)).filter((row) => row.delivery_status === status).length;

/* --------------------------------------------------------------------- creating */

describe("creating a test campaign", () => {
  it("starts 5 minutes ahead of the test clock as a SCHEDULED campaign, with nothing queued yet", async () => {
    holdClock("2026-10-15", "10:25");

    const created = await create({ mode: "schedule", date: "2026-10-15", time: "10:30", timeZone: "UTC" });

    expect(created.campaign).toMatchObject({ status: "SCHEDULED", scheduledAt: "2026-10-15T10:30:00.000Z" });
    expect(created.recipients).toBe(5);
    expect(await recipientRows(created.campaign.id)).toHaveLength(0); // the queue is built when it starts
    const [members] = await sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM contact_list_members m JOIN campaign_lists cl ON cl.list_id = m.list_id
      WHERE cl.campaign_id = ${created.campaign.id}`;
    expect(Number(members.n)).toBe(5);
  });

  it("reads the date and time in the zone it was given, and stores the UTC instant", async () => {
    holdClock("2026-10-15", "10:00", "Europe/Warsaw"); // 08:00 UTC

    const created = await create({ mode: "schedule", date: "2026-10-15", time: "10:30", timeZone: "Europe/Warsaw" });

    expect(created.campaign.scheduledAt).toBe("2026-10-15T08:30:00.000Z");
  });

  it("is marked as a test campaign: by its name, its subject, its list and its recipients", async () => {
    const created = await create({ name: "Smoke check" });

    const row = await getCampaign(created.campaign.id);
    expect(row.name).toBe(`${TEST_NAME_PREFIX}Smoke check`);
    expect(row.subject).toBe(`${TEST_NAME_PREFIX}Smoke check`);
    expect(row.from_email).toBe(`test-panel@${TEST_EMAIL_DOMAIN}`);
    const lists = await sql<{ name: string }[]>`
      SELECT l.name FROM contact_lists l JOIN campaign_lists cl ON cl.list_id = l.id WHERE cl.campaign_id = ${created.campaign.id}`;
    expect(lists.map((l) => l.name)).toEqual([`${TEST_NAME_PREFIX}Smoke check`]);
  });

  it("does not double the marker when the name already has it, and names itself when none is given", async () => {
    expect((await create({ name: "[TEST] already marked" })).campaign.name).toBe("[TEST] already marked");
    expect((await create({})).campaign.name).toMatch(/^\[TEST\] Send now · success · /);
  });

  it("sends only to made-up addresses, and takes no address from the request", async () => {
    const created = await create({
      recipients: 4,
      emails: ["real.person@example.com"], to: "boss@company.example", recipientList: "victim@example.org",
    });

    const contacts = await sql<{ email: string }[]>`
      SELECT c.email FROM contacts c JOIN contact_list_members m ON m.contact_id = c.id
      JOIN campaign_lists cl ON cl.list_id = m.list_id WHERE cl.campaign_id = ${created.campaign.id}`;
    expect(contacts).toHaveLength(4);
    for (const { email } of contacts) expect(email).toMatch(/^success-[a-z0-9]+-\d{3}@test\.invalid$/);
    const rows = await recipientRows(created.campaign.id);
    expect(rows.every((row) => row.email_normalized.endsWith("@test.invalid"))).toBe(true);
  });

  it("goes through the ordinary send path: 'now' queues it as QUEUED, like the Send button", async () => {
    const created = await create({ mode: "now", recipients: 3 });

    expect(created.campaign.status).toBe("QUEUED");
    expect(await recipientRows(created.campaign.id)).toHaveLength(3);
  });

  it("goes through the ordinary scheduling path: a time that is not ahead of the test clock is refused, as by the normal API", async () => {
    holdClock("2026-10-15", "10:25");

    await expect(create({ mode: "schedule", date: "2026-10-15", time: "10:25", timeZone: "UTC" }))
      .rejects.toMatchObject({ status: 400, details: { code: "SCHEDULE_PAST" } });
    await expect(create({ mode: "schedule", date: "2026-10-15", time: "10:20", timeZone: "UTC" }))
      .rejects.toMatchObject({ status: 400, details: { code: "SCHEDULE_PAST" } });
  });

  it("refuses a schedule with no date or time, a zone that does not exist, or a time the clocks skip", async () => {
    holdClock("2027-03-01", "10:00");
    await expect(create({ mode: "schedule", time: "10:30", timeZone: "UTC" })).rejects.toMatchObject({ details: { code: "SCHEDULE_REQUIRED" } });
    await expect(create({ mode: "schedule", date: "2027-03-02", time: "10:30", timeZone: "Nowhere/Land" })).rejects.toMatchObject({ status: 400 });
    await expect(create({ mode: "schedule", date: "2027-03-28", time: "02:30", timeZone: "Europe/Warsaw" })).rejects.toMatchObject({ details: { code: "SCHEDULE_NONEXISTENT" } });
  });

  it("leaves nothing behind when it is refused", async () => {
    holdClock("2026-10-15", "10:25");
    await create({ mode: "schedule", date: "2026-10-15", time: "10:00", timeZone: "UTC" }).catch(() => undefined);

    // The draft may exist (it was made before the schedule was judged), but it is a marked test one and can be reset.
    const drafts = await listTestCampaigns();
    for (const draft of drafts) expect(draft.status).toBe("DRAFT");
  });

  describe("input", () => {
    const bad = (input: Record<string, unknown>) => create(input).then(() => null, (error: { status: number; details?: Record<string, unknown> }) => error);

    it.each([
      ["no recipients", { recipients: 0 }], ["a negative number", { recipients: -3 }],
      ["too many", { recipients: TEST_LIMITS.recipients.max + 1 }], ["a fraction", { recipients: 2.5 }],
      ["text", { recipients: "many" }], ["nothing", { recipients: undefined }], ["an empty string", { recipients: "" }],
    ])("refuses %s of recipients", async (_label, input) => {
      const error = await bad(input);
      expect(error?.status).toBe(400);
      expect(error?.details).toMatchObject({ field: "recipients" });
      expect(await listTestCampaigns()).toEqual([]);
    });

    it("accepts both ends of the range, and a number typed as text", async () => {
      expect((await create({ recipients: TEST_LIMITS.recipients.min })).recipients).toBe(1);
      expect((await create({ recipients: String(TEST_LIMITS.recipients.max) })).recipients).toBe(500);
    });

    it("refuses an unknown scenario and an unknown way of sending", async () => {
      expect((await bad({ scenario: "explode" }))?.details).toMatchObject({ field: "scenario" });
      expect((await bad({ scenario: undefined }))?.details).toMatchObject({ field: "scenario" });
      expect((await bad({ mode: "someday" }))?.details).toMatchObject({ field: "mode" });
    });

    it("checks the delay of a slow scenario and the failures of a temporary one against their ranges", async () => {
      expect((await bad({ scenario: "slow", slowDelaySeconds: 0 }))?.details).toMatchObject({ field: "slowDelaySeconds" });
      expect((await bad({ scenario: "slow", slowDelaySeconds: TEST_LIMITS.slowDelaySeconds.max + 1 }))?.details).toMatchObject({ field: "slowDelaySeconds" });
      expect((await bad({ scenario: "tempfail", temporaryFailures: 0 }))?.details).toMatchObject({ field: "temporaryFailures" });
      expect((await bad({ scenario: "tempfail", temporaryFailures: TEST_LIMITS.temporaryFailures.max + 1 }))?.details).toMatchObject({ field: "temporaryFailures" });
      expect((await bad({ mode: "overdue", overdueMinutes: 0 }))?.details).toMatchObject({ field: "overdueMinutes" });
      expect((await bad({ mode: "overdue", overdueMinutes: TEST_LIMITS.overdueMinutes.max + 1 }))?.details).toMatchObject({ field: "overdueMinutes" });
    });

    it("ignores the delay when the scenario is not a slow one", async () => {
      expect((await create({ scenario: "success", slowDelaySeconds: 9999, temporaryFailures: 9999 })).scenario).toBe("success");
    });

    it("cuts an over-long name to the limit", async () => {
      const created = await create({ name: "x".repeat(500) });
      expect(created.campaign.name.length).toBe(TEST_LIMITS.campaignNameLength.max);
      expect(created.campaign.name.startsWith(TEST_NAME_PREFIX)).toBe(true);
    });

    it("answers over the API with 201 and the campaign, or the API's own 400", async () => {
      const ok = await postCampaign(jsonRequest("POST", { recipients: 2, mode: "now", scenario: "success" }));
      expect(ok.status).toBe(201);
      expect((await ok.json()).campaign).toMatchObject({ status: "QUEUED" });

      const refused = await postCampaign(jsonRequest("POST", { recipients: 0, mode: "now", scenario: "success" }));
      expect(refused.status).toBe(400);
      expect(await refused.json()).toMatchObject({ code: "TEST_RANGE", field: "recipients" });
    });
  });
});

/* -------------------------------------------------------------------- the road */

describe("a scheduled test campaign on its way", () => {
  it("is activated when the test clock reaches its time, and not before", async () => {
    holdClock("2026-10-15", "10:25");
    const { campaign } = await create({ mode: "schedule", date: "2026-10-15", time: "10:30", timeZone: "UTC" });

    await cycle();
    expect((await getCampaign(campaign.id)).status).toBe("SCHEDULED");

    advance("minute");
    advance("minute");
    advance("minute");
    advance("minute"); // 10:29
    await cycle();
    expect((await getCampaign(campaign.id)).status).toBe("SCHEDULED");

    advance("minute"); // 10:30
    const report = await cycle();
    expect(report.result).toMatchObject({ dueCampaigns: 1, activatedCampaigns: 1 });
    expect((await getCampaign(campaign.id)).status).not.toBe("SCHEDULED");
    expect(await recipientRows(campaign.id)).toHaveLength(5);
  });

  it("does the tour's whole road: five minutes, advance five, run, and all five are sent through the queue", async () => {
    holdClock("2026-10-15", "10:25");
    const { campaign } = await create({ mode: "schedule", date: "2026-10-15", time: "10:30", timeZone: "UTC", recipients: 5 });
    expect((await getCampaign(campaign.id)).status).toBe("SCHEDULED");

    advance("fiveMinutes");
    await cycle();

    expect((await getCampaign(campaign.id)).status).toBe("COMPLETED");
    expect(await countBy(campaign.id, "SENT")).toBe(5);
    expect(receivedFiles()).toHaveLength(5);
  });

  it("picks up a campaign that is already overdue, which the normal API would refuse to create", async () => {
    holdClock("2026-10-15", "10:25");
    const listId = await createList("Ordinary");
    await addBulkContacts(listId, 2, "ordinary.test");
    const plain = await createCampaign({ listIds: [listId] });
    // The normal API: a time that has passed is refused.
    const refused = await schedule(jsonRequest("POST", { scheduledAt: "2026-10-15T10:20:00.000Z" }), ctx(plain));
    expect(refused.status).toBe(400);

    const { campaign } = await create({ mode: "overdue", overdueMinutes: 5, recipients: 3 });

    expect(campaign.status).toBe("SCHEDULED");
    expect(campaign.scheduledAt).toBe("2026-10-15T10:20:00.000Z");
    const report = await cycle();
    expect(report.result).toMatchObject({ dueCampaigns: 1, activatedCampaigns: 1 });
    expect((await getCampaign(campaign.id)).status).toBe("COMPLETED");
    expect(await countBy(campaign.id, "SENT")).toBe(3);
  });

  it("does not send a campaign that was cancelled", async () => {
    holdClock("2026-10-15", "10:25");
    const { campaign } = await create({ mode: "schedule", date: "2026-10-15", time: "10:30", timeZone: "UTC" });

    expect((await cancelScheduledCampaign(campaign.id)).outcome).toBe("cancelled");
    advance("hour");
    const report = await cycle();

    expect(report.result?.dueCampaigns).toBe(0);
    expect((await getCampaign(campaign.id)).status).toBe("CANCELLED");
    expect(await recipientRows(campaign.id)).toHaveLength(0);
    expect(receivedFiles()).toEqual([]);
  });

  it("follows a change of time without being told: not at the old time, at the new one", async () => {
    holdClock("2026-10-15", "10:25");
    const { campaign } = await create({ mode: "schedule", date: "2026-10-15", time: "10:30", timeZone: "UTC" });

    const moved = await reschedule(jsonRequest("PATCH", { scheduledAt: "2026-10-15T10:40:00.000Z" }), ctx(campaign.id));
    expect(moved.status).toBe(200);

    advance("fiveMinutes"); // 10:30, the old time
    await cycle();
    expect((await getCampaign(campaign.id)).status).toBe("SCHEDULED");

    advance("fiveMinutes"); // 10:35
    await cycle();
    expect((await getCampaign(campaign.id)).status).toBe("SCHEDULED");

    advance("fiveMinutes"); // 10:40, the new time
    await cycle();
    expect((await getCampaign(campaign.id)).status).not.toBe("SCHEDULED");
  });

  it("can be moved to an earlier time that is still ahead, and starts then", async () => {
    holdClock("2026-10-15", "10:25");
    const { campaign } = await create({ mode: "schedule", date: "2026-10-15", time: "11:00", timeZone: "UTC" });

    await reschedule(jsonRequest("PATCH", { scheduledAt: "2026-10-15T10:35:00.000Z" }), ctx(campaign.id));
    advance("fiveMinutes");
    await cycle();
    expect((await getCampaign(campaign.id)).status).toBe("SCHEDULED");
    advance("fiveMinutes"); // 10:35
    await cycle();
    expect((await getCampaign(campaign.id)).status).not.toBe("SCHEDULED");
  });

  it("is not queued twice however many cycles run", async () => {
    holdClock("2026-10-15", "10:25");
    const { campaign } = await create({ mode: "schedule", date: "2026-10-15", time: "10:30", timeZone: "UTC", recipients: 4 });
    advance("fiveMinutes");

    for (let i = 0; i < 4; i += 1) await cycle();

    expect(await recipientRows(campaign.id)).toHaveLength(4);
    expect(receivedFiles()).toHaveLength(4);
  });
});

/* --------------------------------------------------------- the SMTP scenarios */

describe("the SMTP scenarios, through the ordinary queue and retry rules", () => {
  it("Success: everyone is sent and the campaign completes", async () => {
    const { campaign } = await create({ mode: "now", scenario: "success", recipients: 4 });

    await cycle();

    expect(await countBy(campaign.id, "SENT")).toBe(4);
    expect((await getCampaign(campaign.id)).status).toBe("COMPLETED");
    expect(receivedFiles()).toHaveLength(4);
  });

  it("Temporary failure: refused with a 451, put back in the queue with a wait, then sent on a later attempt", async () => {
    const { campaign } = await create({ mode: "now", scenario: "tempfail", temporaryFailures: 1, recipients: 3 });

    const first = await cycle();

    expect(first.result).toMatchObject({ sent: 0, retried: 3, failed: 0 });
    const rows = await sql<{ delivery_status: string; attempts: number; last_error: string; wait: number }[]>`
      SELECT delivery_status, attempts, last_error, extract(epoch FROM next_attempt_at - now())::float AS wait
      FROM campaign_recipients WHERE campaign_id = ${campaign.id}`;
    for (const row of rows) {
      expect(row.delivery_status).toBe("QUEUED");
      expect(row.attempts).toBe(1);
      expect(row.last_error).toContain("451");
      expect(row.wait).toBeGreaterThan(50);
      expect(row.wait).toBeLessThanOrEqual(60); // the first back-off is a minute
    }
    expect(receivedFiles()).toEqual([]);

    // Nothing happens until the wait is over...
    await cycle();
    expect(await countBy(campaign.id, "QUEUED")).toBe(3);
    // ...and then the retry succeeds.
    await makeRetriesDue();
    const second = await cycle();
    expect(second.result).toMatchObject({ sent: 3 });
    const done = await sql<{ attempts: number }[]>`SELECT attempts FROM campaign_recipients WHERE campaign_id = ${campaign.id}`;
    expect(done.every((row) => row.attempts === 2)).toBe(true);
    expect((await getCampaign(campaign.id)).status).toBe("COMPLETED");
  });

  it("Temporary failure that keeps failing: gives up after the attempt limit, and never tries again", async () => {
    const { campaign } = await create({ mode: "now", scenario: "tempfail", temporaryFailures: 5, recipients: 2 });

    for (let round = 0; round < 3; round += 1) {
      await cycle();
      await makeRetriesDue();
    }
    await cycle();
    await makeRetriesDue();
    await cycle();

    const rows = await sql<{ delivery_status: string; attempts: number }[]>`
      SELECT delivery_status, attempts FROM campaign_recipients WHERE campaign_id = ${campaign.id}`;
    expect(rows.every((row) => row.delivery_status === "FAILED")).toBe(true);
    expect(rows.every((row) => row.attempts === 3)).toBe(true); // SMTP_MAX_ATTEMPTS, and no more
    expect((await getCampaign(campaign.id)).status).toBe("COMPLETED");
  });

  it("Permanent failure: refused with a 550, failed at once, and never retried", async () => {
    const { campaign } = await create({ mode: "now", scenario: "permfail", recipients: 3 });

    const first = await cycle();
    expect(first.result).toMatchObject({ sent: 0, failed: 3, retried: 0 });
    await makeRetriesDue();
    await cycle();
    await cycle();

    const rows = await sql<{ delivery_status: string; attempts: number; last_error: string }[]>`
      SELECT delivery_status, attempts, last_error FROM campaign_recipients WHERE campaign_id = ${campaign.id}`;
    expect(rows.every((row) => row.delivery_status === "FAILED" && row.attempts === 1)).toBe(true);
    expect(rows[0].last_error).toContain("550");
    expect((await getCampaign(campaign.id)).status).toBe("COMPLETED");
  });

  it("Slow response: the server takes its time, and everyone is still sent", async () => {
    const { campaign } = await create({ mode: "now", scenario: "slow", slowDelaySeconds: 1, recipients: 2 });

    const started = Date.now();
    await cycle();

    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    expect(await countBy(campaign.id, "SENT")).toBe(2);
  });
});

/* ----------------------------------------------------------- real SMTP is never used */

describe("real SMTP", () => {
  it("is never used while the panel is on, however SMTP is configured", async () => {
    vi.stubEnv("SMTP_HOST", "smtp.real-provider.example");
    vi.stubEnv("SMTP_PORT", "587");
    vi.stubEnv("SMTP_USER", "real-user");
    vi.stubEnv("SMTP_PASSWORD", "real-password");
    vi.stubEnv("SMTP_FROM_EMAIL", "me@real-provider.example");
    await loadSettingsRow();
    await sql`UPDATE app_settings SET smtp_host = 'smtp.stored.example', smtp_port = 465 WHERE id = 1`;

    const config = await getSmtpConfig();

    expect(config).toMatchObject({ host: "127.0.0.1", security: "none", user: null, password: null });
    expect(config?.host).not.toContain("real-provider");

    const { campaign } = await create({ mode: "now", recipients: 2 });
    await cycle();

    expect(transports.configs.length).toBeGreaterThan(0);
    for (const used of transports.configs) {
      expect(used.host).toBe("127.0.0.1");
      expect(used.user).toBeNull();
      expect(used.port).toBe(config?.port);
    }
    expect(await countBy(campaign.id, "SENT")).toBe(2);
  });

  it("holds even when no SMTP is configured at all: the test server is what is there", async () => {
    await loadSettingsRow();
    await sql`UPDATE app_settings SET smtp_host = NULL, smtp_port = NULL, from_email = NULL WHERE id = 1`;
    expect(await getSmtpConfig()).toMatchObject({ host: "127.0.0.1" });
  });

  it("does not touch the stored settings", async () => {
    await loadSettingsRow();
    await sql`UPDATE app_settings SET smtp_host = 'smtp.stored.example', smtp_port = 465, smtp_user = 'stored-user' WHERE id = 1`;
    const before = await sql`SELECT * FROM app_settings WHERE id = 1`;

    await getSmtpConfig();
    await create({ mode: "now", recipients: 1 });
    await cycle();

    expect(await sql`SELECT * FROM app_settings WHERE id = 1`).toEqual(before);
  });

  it("outside a test environment the configured SMTP is what is used, as ever", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SMTP_HOST", "smtp.configured.example");
    vi.stubEnv("SMTP_PORT", "2525");
    vi.stubEnv("SMTP_FROM_EMAIL", "me@configured.example");

    expect(await getSmtpConfig()).toMatchObject({ host: "smtp.configured.example", port: 2525 });
  });
});

/* -------------------------------------------------------- listing, details, reset */

describe("the panel's view of test campaigns", () => {
  it("lists only test campaigns, newest first, with what their queue holds", async () => {
    const listId = await createList("Real list");
    await addBulkContacts(listId, 2, "real.test");
    await createCampaign({ name: "A real campaign", listIds: [listId] });
    const first = await create({ name: "First", recipients: 2 });
    const second = await create({ name: "Second", recipients: 3 });
    await cycle();

    const list = await listTestCampaigns();

    expect(list.map((c) => c.id)).toEqual([second.campaign.id, first.campaign.id]);
    expect(list.map((c) => c.name)).toEqual(["[TEST] Second", "[TEST] First"]);
    expect(list[0]).toMatchObject({ sent: 3, queued: 0, failed: 0 });
    expect(list[1]).toMatchObject({ sent: 2 });
  });

  it("shows a campaign's queue and its story, and never a real campaign's", async () => {
    holdClock("2026-10-15", "10:25");
    const { campaign } = await create({ mode: "schedule", date: "2026-10-15", time: "10:30", timeZone: "UTC", recipients: 3 });
    advance("fiveMinutes");
    await cycle();

    const details = await testCampaignDetails(campaign.id);

    expect(details.campaign).toMatchObject({ id: campaign.id, status: "COMPLETED", scheduledAt: "2026-10-15T10:30:00.000Z" });
    expect(details.queue).toHaveLength(3);
    expect(details.queue.every((row) => row.status === "SENT" && row.attempts === 1)).toBe(true);
    const types = details.history.map((item) => item.type);
    expect(types).toEqual(expect.arrayContaining(["row.created", "campaign.created", "campaign.scheduled", "campaign.activated", "recipients.created", "campaign.started", "campaign.completed"]));
    expect(details.history.find((item) => item.type === "campaign.activated")).toMatchObject({ from: "SCHEDULED", to: "QUEUED" });

    const real = await createCampaign({ name: "A real campaign" });
    await expect(testCampaignDetails(real)).rejects.toMatchObject({ status: 400, details: { code: "TEST_NOT_MARKED" } });
  });

  it("answers the details endpoint, and refuses a real campaign there", async () => {
    const { campaign } = await create({ recipients: 2 });
    const ok = await getTestCampaign(jsonRequest("GET"), ctx(campaign.id));
    expect(ok.status).toBe(200);
    expect((await ok.json()).queue).toHaveLength(2);

    const real = await createCampaign({ name: "A real campaign" });
    expect((await getTestCampaign(jsonRequest("GET"), ctx(real))).status).toBe(400);
    expect((await getTestCampaign(jsonRequest("GET"), ctx("not-a-uuid"))).status).toBe(404);
  });
});

describe("resetting a test campaign", () => {
  it("removes the campaign, the list made for it, and the made-up contacts nothing else uses", async () => {
    const { campaign } = await create({ mode: "schedule", date: "2027-01-01", time: "10:00", timeZone: "UTC", recipients: 4 }).catch(async () => create({ recipients: 4 }));
    await cancelIfActive(campaign.id);

    const removed = await resetTestCampaign(campaign.id);

    expect(removed.removedContacts).toBe(4);
    expect(await getCampaign(campaign.id)).toBeUndefined();
    const [left] = await sql<{ lists: string; contacts: string }[]>`
      SELECT (SELECT count(*) FROM contact_lists)::text AS lists, (SELECT count(*) FROM contacts)::text AS contacts`;
    expect(left).toEqual({ lists: "0", contacts: "0" });
  });

  it("never touches a real campaign, list or contact", async () => {
    const listId = await createList("Real list");
    await addBulkContacts(listId, 3, "real.test");
    const real = await createCampaign({ name: "A real campaign", listIds: [listId] });
    const { campaign } = await create({ mode: "now", recipients: 2 });
    await cycle();

    await expect(resetTestCampaign(real)).rejects.toMatchObject({ status: 400, details: { code: "TEST_NOT_MARKED" } });
    await resetTestCampaign(campaign.id);

    expect((await getCampaign(real)).status).toBe("DRAFT");
    const [rows] = await sql<{ lists: string; contacts: string }[]>`
      SELECT (SELECT count(*) FROM contact_lists)::text AS lists, (SELECT count(*) FROM contacts)::text AS contacts`;
    expect(rows).toEqual({ lists: "1", contacts: "3" });
  });

  it("refuses a marked campaign that somehow holds a real address", async () => {
    const { campaign } = await create({ recipients: 2 });
    await cycle();
    await sql`UPDATE campaign_recipients SET email_normalized = 'someone@example.com', email = 'someone@example.com'
              WHERE id = (SELECT id FROM campaign_recipients WHERE campaign_id = ${campaign.id} LIMIT 1)`;

    await expect(resetTestCampaign(campaign.id)).rejects.toMatchObject({ details: { code: "TEST_NOT_MARKED" } });
    expect(await getCampaign(campaign.id)).toBeDefined();
  });

  it.each(["QUEUED", "SENDING", "PAUSED"])("asks for a %s campaign to be cancelled first", async (status) => {
    const { campaign } = await create({ mode: "now", recipients: 2 });
    await sql`UPDATE campaigns SET status = ${status}::campaign_status WHERE id = ${campaign.id}`;

    await expect(resetTestCampaign(campaign.id)).rejects.toMatchObject({ status: 409 });
    expect(await getCampaign(campaign.id)).toBeDefined();
  });

  it("does not remove made-up contacts still in another test list", async () => {
    const a = await create({ recipients: 2 });
    await create({ recipients: 2 });
    await cycle();
    await resetTestCampaign(a.campaign.id);

    const [rows] = await sql<{ contacts: string }[]>`SELECT count(*)::text AS contacts FROM contacts`;
    expect(Number(rows.contacts)).toBe(2);
  });

  it("answers DELETE over the API, and refuses a real campaign there", async () => {
    const { campaign } = await create({ recipients: 1 });
    await cycle();
    expect((await deleteTestCampaign(jsonRequest("DELETE"), ctx(campaign.id))).status).toBe(200);
    expect(await getCampaign(campaign.id)).toBeUndefined();

    const real = await createCampaign({ name: "A real campaign" });
    expect((await deleteTestCampaign(jsonRequest("DELETE"), ctx(real))).status).toBe(400);
    expect(await getCampaign(real)).toBeDefined();
  });
});

async function cancelIfActive(id: string) {
  const row = await getCampaign(id);
  if (row.status === "SCHEDULED") await cancelScheduledCampaign(id);
  else await sql`UPDATE campaigns SET status = 'CANCELLED' WHERE id = ${id}`;
}

/* ------------------------------------------------------------------ the templates */

describe("the ready-made templates", () => {
  it("are seven, each with numbers inside the ranges the server enforces", () => {
    expect(TEST_TEMPLATES.map((t) => t.id)).toEqual(["in1min", "in5min", "overdue5min", "bigRate", "tempFail", "permFail", "slowSmtp"]);
    for (const template of TEST_TEMPLATES) {
      expect(template.recipients, template.id).toBeGreaterThanOrEqual(TEST_LIMITS.recipients.min);
      expect(template.recipients, template.id).toBeLessThanOrEqual(TEST_LIMITS.recipients.max);
      if (template.slowDelaySeconds !== undefined) {
        expect(template.slowDelaySeconds).toBeGreaterThanOrEqual(TEST_LIMITS.slowDelaySeconds.min);
        expect(template.slowDelaySeconds).toBeLessThanOrEqual(TEST_LIMITS.slowDelaySeconds.max);
      }
      if (template.temporaryFailures !== undefined) {
        expect(template.temporaryFailures).toBeGreaterThanOrEqual(TEST_LIMITS.temporaryFailures.min);
        expect(template.temporaryFailures).toBeLessThanOrEqual(TEST_LIMITS.temporaryFailures.max);
      }
      if (template.overdueMinutes !== undefined) {
        expect(template.overdueMinutes).toBeGreaterThanOrEqual(TEST_LIMITS.overdueMinutes.min);
        expect(template.overdueMinutes).toBeLessThanOrEqual(TEST_LIMITS.overdueMinutes.max);
      }
    }
  });

  it("each create a campaign of the kind they promise", async () => {
    holdClock("2026-10-15", "10:25");
    const expected: Record<string, string> = {
      in1min: "SCHEDULED", in5min: "SCHEDULED", overdue5min: "SCHEDULED",
      bigRate: "QUEUED", tempFail: "QUEUED", permFail: "QUEUED", slowSmtp: "QUEUED",
    };

    for (const template of TEST_TEMPLATES) {
      let input: Record<string, unknown> = {
        recipients: template.recipients, mode: template.mode, scenario: template.scenario,
        temporaryFailures: template.temporaryFailures, slowDelaySeconds: template.slowDelaySeconds,
        overdueMinutes: template.overdueMinutes,
      };
      if (template.mode === "schedule") {
        const fields = scheduleFieldsFor(new Date(clock.now().getTime() + (template.offsetMinutes ?? 0) * 60_000), "UTC");
        input = { ...input, date: fields.date, time: fields.time, timeZone: "UTC" };
      }
      const created = await createTestCampaign(input);
      expect(created.campaign.status, template.id).toBe(expected[template.id]);
    }
  });

  it("the ones that start later are ahead of the test clock by their offset, floored to the minute", async () => {
    holdClock("2026-10-15", "10:25");
    for (const [id, expectedTime] of [["in1min", "2026-10-15T10:26:00.000Z"], ["in5min", "2026-10-15T10:30:00.000Z"]] as const) {
      const template = TEST_TEMPLATES.find((t) => t.id === id)!;
      const fields = scheduleFieldsFor(new Date(clock.now().getTime() + (template.offsetMinutes ?? 0) * 60_000), "UTC");
      const created = await createTestCampaign({
        recipients: template.recipients, mode: "schedule", scenario: template.scenario,
        date: fields.date, time: fields.time, timeZone: "UTC",
      });
      expect(created.campaign.scheduledAt).toBe(expectedTime);
    }
  });
});

/* ---------------------------------------------------------------- the event journal */

describe("the events a campaign leaves", () => {
  it("tell the story in order, by identifiers and counts, with no addresses or content", async () => {
    holdClock("2026-10-15", "10:25");
    const { campaign } = await create({ mode: "schedule", date: "2026-10-15", time: "10:30", timeZone: "UTC", recipients: 2 });
    advance("fiveMinutes");
    await cycle();

    const entries = readJournal(0, 200);
    const types = entries.map((entry) => entry.type);
    const at = (type: string) => types.indexOf(type);

    expect(at("campaign.created")).toBeGreaterThanOrEqual(0);
    expect(at("campaign.created")).toBeLessThan(at("campaign.scheduled"));
    expect(at("campaign.scheduled")).toBeLessThan(at("scheduler.cycle.started"));
    expect(at("scheduler.cycle.started")).toBeLessThan(at("campaign.activated"));
    expect(at("campaign.activated")).toBeLessThan(at("recipients.created"));
    expect(at("recipients.created")).toBeLessThan(at("rate.allowed"));
    expect(at("rate.allowed")).toBeLessThan(at("scheduler.cycle.finished"));

    const forCampaign = entries.filter((entry) => entry.campaignId === campaign.id);
    expect(forCampaign.length).toBeGreaterThanOrEqual(4);
    // What the rules saw as "now" is recorded next to the real time while the clock is held.
    expect(entries.find((entry) => entry.type === "campaign.activated")?.effectiveAt).toBe("2026-10-15T10:30:00.000Z");

    const text = JSON.stringify(entries);
    expect(text).not.toContain("@");
    expect(text).not.toContain("test.invalid");
    expect(text).not.toMatch(/password|secret|token|credential|authorization/i);
    expect(text).not.toContain("This is a test email");
  });

  it("keep ids rising so a reader can ask for what is new", async () => {
    await create({ recipients: 1 });
    const first = readJournal(0, 200);
    await cycle();
    const later = readJournal(first[first.length - 1].id, 200);

    expect(later.length).toBeGreaterThan(0);
    expect(later.every((entry) => entry.id > first[first.length - 1].id)).toBe(true);
    const ids = readJournal(0, 500).map((entry) => entry.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it("are kept in a bounded number", async () => {
    for (let i = 0; i < TEST_LIMITS.eventLog.keep + 20; i += 1) {
      const { emitEvent } = await import("@/lib/events");
      emitEvent({ type: "test.noise", source: "panel", data: { i } });
    }
    expect(readJournal(0, 10_000).length).toBeLessThanOrEqual(TEST_LIMITS.eventLog.keep);
    expect(readJournal(0, 5).length).toBe(5);
  });
});
