import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, sql as raw } from "drizzle-orm";
import { db, sql } from "../db";
import { campaignLists, campaignRecipients, campaigns, contactLists } from "../db/schema";
import { badRequest, conflict, notFound } from "../api";
import { scheduleDraftCampaign, scheduleErrorKey, sendDraftCampaign } from "../campaign-send";
import { clock } from "../clock";
import { emitEvent } from "../events";
import { importContacts } from "../import";
import { resolveWallClock, type Occurrence } from "../scheduling";
import { rejectField, rejectInteger } from "./api";
import { assertTestPanelEnabled } from "./access";
import { readCampaignJournal } from "./journal";
import { TEST_LIMITS, checkInteger, isSmtpScenario, type SmtpScenario } from "./limits";
import { TEST_EMAIL_DOMAIN, TEST_NAME_PREFIX, isTestName, testAddress, type TestAddressPlan } from "./test-addresses";
import type { SendMode } from "./templates";

/**
 * Test campaigns: made only by the test panel, only for made-up recipients, and marked.
 *
 * A campaign is a *test* campaign when its name begins `[TEST] `; the list it is sent to
 * is named the same way and holds nothing but `@test.invalid` addresses. That is what
 * "explicitly marked" means here, and it is what every risky action (reset) checks first.
 *
 * Nothing is done in a private way. The recipients are imported by the same `importContacts`
 * as a real import; the campaign is sent, or scheduled, by the very functions behind the
 * "Send" and "Schedule" buttons (`sendDraftCampaign`, `scheduleDraftCampaign`), so it takes
 * the ordinary road: the queue, the scheduler, the rate limiter, the retry rules. The one
 * exception is a campaign that is already overdue, which the normal API rightly refuses to
 * create; that alone is written directly, as a SCHEDULED campaign whose time has passed.
 */
export type CreateTestCampaignInput = {
  name?: unknown;
  recipients?: unknown;
  mode?: unknown;
  /** For `schedule`: wall-clock `YYYY-MM-DD`, `HH:mm`, and the IANA zone they are read in. */
  date?: unknown;
  time?: unknown;
  timeZone?: unknown;
  /** Which of two repeated wall-clock times is meant, when clocks going back repeat it. */
  occurrence?: unknown;
  scenario?: unknown;
  slowDelaySeconds?: unknown;
  temporaryFailures?: unknown;
  /** For `overdue`. */
  overdueMinutes?: unknown;
};

export type TestCampaignSummary = {
  id: string;
  name: string;
  status: string;
  scheduledAt: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  /** Rows in the queue: it stays 0 until a scheduled campaign starts. */
  totalRecipients: number;
  queued: number;
  sending: number;
  sent: number;
  failed: number;
};

const MODES: readonly SendMode[] = ["now", "schedule", "overdue"];

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** A short lowercase id that keeps one campaign's addresses apart from another's. */
function newBatchId(): string {
  return randomBytes(4).toString("hex").slice(0, 6);
}

function scenarioPlan(scenario: SmtpScenario, slowDelaySeconds: number, temporaryFailures: number): TestAddressPlan {
  if (scenario === "slow") return { scenario, delaySeconds: slowDelaySeconds };
  if (scenario === "tempfail") return { scenario, failures: temporaryFailures };
  return { scenario };
}

function defaultName(mode: SendMode, scenario: SmtpScenario): string {
  const stamp = clock.now().toISOString().slice(11, 16);
  return `${mode === "now" ? "Send now" : mode === "schedule" ? "Scheduled" : "Overdue"} · ${scenario} · ${stamp}`;
}

/** The instant a `schedule` request means, or a refusal in the API's own words. */
function resolveScheduledInstant(input: CreateTestCampaignInput): string {
  const date = typeof input.date === "string" ? input.date : "";
  const time = typeof input.time === "string" ? input.time : "";
  const timeZone = typeof input.timeZone === "string" ? input.timeZone : "";
  if (!isValidTimeZone(timeZone)) rejectField("err.test.timeZone", "timeZone");

  const wall = resolveWallClock(date, time, timeZone);
  if (!wall.ok) badRequest(scheduleErrorKey(wall.code), undefined, { code: wall.code, field: "scheduledAt" });

  // Two readings of a repeated time: the person's pick, else the earlier one.
  const occurrence: Occurrence = input.occurrence === "second" ? "second" : "first";
  const chosen = wall.candidates.length > 1 && occurrence === "second" ? wall.candidates[1] : wall.candidates[0];
  return chosen.toISOString();
}

export async function createTestCampaign(input: CreateTestCampaignInput) {
  assertTestPanelEnabled("Test campaigns");

  const mode = input.mode as SendMode;
  if (!MODES.includes(mode)) rejectField("err.test.mode", "mode");
  if (!isSmtpScenario(input.scenario)) rejectField("err.test.scenario", "scenario");
  const scenario = input.scenario;

  const recipients = checkInteger("recipients", input.recipients);
  if (!recipients.ok) rejectInteger("recipients", recipients.code);

  // Only what the chosen scenario uses is required; the rest is ignored.
  let slowDelaySeconds: number = TEST_LIMITS.slowDelaySeconds.default;
  if (scenario === "slow") {
    const slow = checkInteger("slowDelaySeconds", input.slowDelaySeconds ?? slowDelaySeconds);
    if (!slow.ok) rejectInteger("slowDelaySeconds", slow.code);
    slowDelaySeconds = slow.value;
  }
  let temporaryFailures: number = TEST_LIMITS.temporaryFailures.default;
  if (scenario === "tempfail") {
    const failures = checkInteger("temporaryFailures", input.temporaryFailures ?? temporaryFailures);
    if (!failures.ok) rejectInteger("temporaryFailures", failures.code);
    temporaryFailures = failures.value;
  }
  let overdueMinutes: number = TEST_LIMITS.overdueMinutes.default;
  if (mode === "overdue") {
    const overdue = checkInteger("overdueMinutes", input.overdueMinutes ?? overdueMinutes);
    if (!overdue.ok) rejectInteger("overdueMinutes", overdue.code);
    overdueMinutes = overdue.value;
  }

  const scheduledFor = mode === "schedule" ? resolveScheduledInstant(input) : null;

  const rawName = typeof input.name === "string" ? input.name.trim() : "";
  const bare = (rawName.startsWith(TEST_NAME_PREFIX) ? rawName.slice(TEST_NAME_PREFIX.length) : rawName) || defaultName(mode, scenario);
  const name = `${TEST_NAME_PREFIX}${bare}`.slice(0, TEST_LIMITS.campaignNameLength.max);

  // 1. Made-up recipients, in a list of their own, by the ordinary import.
  const batch = newBatchId();
  const plan = scenarioPlan(scenario, slowDelaySeconds, temporaryFailures);
  const addresses = Array.from({ length: recipients.value }, (_, index) => testAddress(plan, batch, index + 1));

  const [list] = await db
    .insert(contactLists)
    .values({ name, description: "Created by the test panel. Safe to delete." })
    .returning();
  await importContacts(
    list.id,
    addresses.map((email, index) => ({ email, firstName: "Test", lastName: `Recipient ${index + 1}` })),
  );

  // 2. The campaign, as a DRAFT, marked by its name and its subject.
  const body = `<p>This is a test email from the test panel.</p><p>SMTP scenario: <b>${scenario}</b>.</p>`;
  const [draft] = await db
    .insert(campaigns)
    .values({
      name,
      subject: name,
      fromName: "Test panel",
      fromEmail: `test-panel@${TEST_EMAIL_DOMAIN}`,
      contentHtml: body,
      compiledHtml: body,
    })
    .returning();
  await db.insert(campaignLists).values({ campaignId: draft.id, listId: list.id });
  emitEvent({ type: "campaign.created", source: "panel", campaignId: draft.id, to: "DRAFT", data: { test: true } });

  // 3. Down the ordinary road.
  if (mode === "now") {
    await sendDraftCampaign(draft.id);
  } else if (mode === "schedule") {
    await scheduleDraftCampaign(draft.id, () => scheduledFor);
  } else {
    const overdueAt = new Date(clock.now().getTime() - overdueMinutes * 60_000);
    const [late] = await db
      .update(campaigns)
      .set({ status: "SCHEDULED", scheduledAt: overdueAt, updatedAt: new Date() })
      .where(and(eq(campaigns.id, draft.id), eq(campaigns.status, "DRAFT")))
      .returning({ scheduledAt: campaigns.scheduledAt });
    if (!late) conflict("err.campaign.alreadyScheduled");
    emitEvent({
      type: "campaign.scheduled", source: "panel", campaignId: draft.id, from: "DRAFT", to: "SCHEDULED",
      data: { scheduledAt: overdueAt.toISOString(), overdue: true },
    });
  }

  const [created] = await db.select().from(campaigns).where(eq(campaigns.id, draft.id)).limit(1);
  return {
    campaign: {
      id: created.id,
      name: created.name,
      status: created.status,
      scheduledAt: created.scheduledAt?.toISOString() ?? null,
    },
    recipients: recipients.value,
    scenario,
  };
}

/** The test campaigns, newest first, with what their queue holds. */
export async function listTestCampaigns(limit = 20): Promise<TestCampaignSummary[]> {
  const rows = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      status: campaigns.status,
      scheduledAt: campaigns.scheduledAt,
      createdAt: campaigns.createdAt,
      startedAt: campaigns.startedAt,
      completedAt: campaigns.completedAt,
      totalRecipients: campaigns.totalRecipients,
      queued: raw<number>`count(*) FILTER (WHERE ${campaignRecipients.deliveryStatus} = 'QUEUED')::int`,
      sending: raw<number>`count(*) FILTER (WHERE ${campaignRecipients.deliveryStatus} = 'SENDING')::int`,
      sent: raw<number>`count(*) FILTER (WHERE ${campaignRecipients.deliveryStatus} = 'SENT')::int`,
      failed: raw<number>`count(*) FILTER (WHERE ${campaignRecipients.deliveryStatus} = 'FAILED')::int`,
    })
    .from(campaigns)
    .leftJoin(campaignRecipients, eq(campaignRecipients.campaignId, campaigns.id))
    .where(raw`starts_with(${campaigns.name}, ${TEST_NAME_PREFIX})`)
    .groupBy(campaigns.id)
    .orderBy(desc(campaigns.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    ...row,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  }));
}

export type QueueRow = {
  email: string;
  status: string;
  attempts: number;
  nextAttemptAt: string;
  sentAt: string | null;
  lastError: string | null;
};

/** The queue rows of one test campaign. Only test campaigns: the panel does not browse real ones. */
export async function testCampaignQueue(campaignId: string, limit = 200): Promise<QueueRow[]> {
  await requireTestCampaign(campaignId);
  const rows = await db
    .select()
    .from(campaignRecipients)
    .where(eq(campaignRecipients.campaignId, campaignId))
    .orderBy(asc(campaignRecipients.createdAt), asc(campaignRecipients.emailNormalized))
    .limit(limit);
  return rows.map((row) => ({
    email: row.email,
    status: row.deliveryStatus,
    attempts: row.attempts,
    nextAttemptAt: row.nextAttemptAt.toISOString(),
    sentAt: row.sentAt?.toISOString() ?? null,
    // Already stripped of anything sensitive when it was stored (`sanitizeErrorMessage`).
    lastError: row.lastError,
  }));
}

export type HistoryItem = {
  at: string;
  type: string;
  from?: string;
  to?: string;
  data?: Record<string, string | number | boolean | null>;
};

/**
 * One test campaign in detail: its queue, and the story of its statuses.
 *
 * The story is put together from what the database itself knows (when it was created, started
 * and completed), which survives a restart, and from the events this process has seen, which
 * add every transition and cycle but are gone after a restart.
 */
export async function testCampaignDetails(campaignId: string) {
  const campaign = await requireTestCampaign(campaignId);
  const queue = await testCampaignQueue(campaignId);

  const history: HistoryItem[] = [{ at: campaign.createdAt.toISOString(), type: "row.created", to: "DRAFT" }];
  if (campaign.startedAt) history.push({ at: campaign.startedAt.toISOString(), type: "row.started", to: "SENDING" });
  if (campaign.completedAt) history.push({ at: campaign.completedAt.toISOString(), type: "row.completed", to: campaign.status });
  for (const entry of readCampaignJournal(campaignId)) {
    history.push({ at: entry.at, type: entry.type, from: entry.from, to: entry.to, data: entry.data });
  }
  history.sort((a, b) => a.at.localeCompare(b.at));

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      /** The stored instant, UTC. The panel also shows it in the person's own zone. */
      scheduledAt: campaign.scheduledAt?.toISOString() ?? null,
      createdAt: campaign.createdAt.toISOString(),
    },
    queue,
    history,
  };
}

async function requireTestCampaign(campaignId: string) {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!campaign) notFound("err.campaign.notFound");
  // Anything not marked is not the test panel's to look at or touch.
  if (!isTestName(campaign.name)) badRequest("err.test.notTestCampaign", undefined, { code: "TEST_NOT_MARKED" });
  return campaign;
}

/**
 * Deletes one test campaign, the list made for it, and the made-up contacts nothing else
 * uses. Only a campaign marked as a test one, whose every recipient address is a test address,
 * and only when nothing is sending: cancel it first. Real campaigns, lists and contacts are
 * never looked at.
 */
export async function resetTestCampaign(campaignId: string): Promise<{ removedContacts: number }> {
  assertTestPanelEnabled("Test campaign reset");
  const campaign = await requireTestCampaign(campaignId);
  if (["QUEUED", "SENDING", "PAUSED"].includes(campaign.status)) conflict("err.campaign.cancelBeforeDelete");

  // Belt and braces on the marker: nothing that is not a test address may be in its queue or list.
  const stray = await sql<{ n: string }[]>`
    SELECT count(*)::text AS n FROM (
      SELECT email_normalized AS e FROM campaign_recipients WHERE campaign_id = ${campaignId}
      UNION
      SELECT c.email_normalized FROM contact_list_members m
        JOIN contacts c ON c.id = m.contact_id
        JOIN campaign_lists cl ON cl.list_id = m.list_id
        WHERE cl.campaign_id = ${campaignId}
    ) addresses
    WHERE e NOT LIKE ${`%@${TEST_EMAIL_DOMAIN}`}
  `;
  if (Number(stray[0]?.n ?? 0) > 0) badRequest("err.test.notTestCampaign", undefined, { code: "TEST_NOT_MARKED" });

  const listIds = (
    await db.select({ id: campaignLists.listId }).from(campaignLists).where(eq(campaignLists.campaignId, campaignId))
  ).map((row) => row.id);

  await db.delete(campaigns).where(eq(campaigns.id, campaignId));

  // The lists made for it (marked the same way, and not used by any other campaign).
  if (listIds.length > 0) {
    await sql`
      DELETE FROM contact_lists l
      WHERE l.id = ANY(${listIds}::uuid[])
        AND starts_with(l.name, ${TEST_NAME_PREFIX})
        AND NOT EXISTS (SELECT 1 FROM campaign_lists cl WHERE cl.list_id = l.id)
    `;
  }
  // The made-up contacts that are now in no list at all.
  const removed = await sql<{ id: string }[]>`
    DELETE FROM contacts c
    WHERE c.email_normalized LIKE ${`%@${TEST_EMAIL_DOMAIN}`}
      AND NOT EXISTS (SELECT 1 FROM contact_list_members m WHERE m.contact_id = c.id)
    RETURNING c.id
  `;
  emitEvent({ type: "test.campaign.reset", source: "panel", data: { contacts: removed.length } });
  return { removedContacts: removed.length };
}
