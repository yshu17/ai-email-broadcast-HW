import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { campaignLists, campaigns } from "./db/schema";
import { badRequest, conflict, notFound } from "./api";
import { queueCampaign } from "./campaign-activation";
import { previewAudience } from "./campaign-recipients";
import { clock } from "./clock";
import { emitEvent } from "./events";
import { parseScheduledAt } from "./scheduling";
import { getSmtpConfig } from "./settings";
import { hasMessage, type MessageKey } from "../i18n/translate";

/**
 * The two ways a DRAFT campaign leaves the editor, as functions.
 *
 * They are what `POST /api/campaigns/:id/send` and `POST /api/campaigns/:id/schedule`
 * do, moved here unchanged so that the test panel starts a test campaign along the
 * very same path, with the same readiness rules and the same protection against two
 * requests at once, rather than a copy of it. Failures are thrown as the API's own
 * refusals (`HttpError`), so a route needs no translation of them.
 */

/** The dictionary key for a schedule rule, e.g. SCHEDULE_PAST; a code without its own text reads as "invalid". */
export function scheduleErrorKey(code: string): MessageKey {
  const key = `err.schedule.${code}`;
  return hasMessage(key) ? key : "err.schedule.SCHEDULE_INVALID";
}

/** What must be true of a campaign, and of the app, before it can be sent or scheduled. */
async function assertReadyToSend(campaign: typeof campaigns.$inferSelect): Promise<string[]> {
  if (!campaign.subject.trim()) badRequest("err.campaign.subjectRequired");
  if (!campaign.compiledHtml.trim()) badRequest("err.campaign.bodyEmpty");

  const config = await getSmtpConfig();
  if (!config) badRequest("err.smtp.configureBeforeSend");

  const lists = await db
    .select({ listId: campaignLists.listId })
    .from(campaignLists)
    .where(eq(campaignLists.campaignId, campaign.id));
  return lists.map((l) => l.listId);
}

/**
 * DRAFT -> SCHEDULED at `scheduledAt`.
 *
 * Applies the same readiness rules as sending now, so a campaign that could not be
 * sent now cannot be scheduled either — the mistake surfaces today, not when the
 * time arrives. It records the time and flips the status; it queues no recipients
 * and sends nothing. The time is judged against `clock.now()`: the system clock, or
 * the test clock while one is held.
 *
 * The transition is a conditional UPDATE, so of two concurrent requests only one can
 * win (the other gets a 409), exactly as when sending now.
 *
 * `readScheduledAt` supplies the requested time and is called only once the campaign
 * has been found and is a DRAFT, so a request for a campaign that cannot be scheduled
 * is refused for that reason before its body is even looked at.
 */
export async function scheduleDraftCampaign(
  campaignId: string,
  readScheduledAt: () => unknown | Promise<unknown>,
): Promise<{ scheduledAt: Date }> {
  const rows = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  const campaign = rows[0];
  if (!campaign) notFound("err.campaign.notFound");
  if (campaign.status !== "DRAFT") conflict("err.campaign.alreadyStatus", { status: campaign.status });

  const parsed = parseScheduledAt(await readScheduledAt(), clock.now());
  if (!parsed.ok) badRequest(scheduleErrorKey(parsed.code), undefined, { code: parsed.code, field: "scheduledAt" });

  const listIds = await assertReadyToSend(campaign);
  const audience = await previewAudience(listIds);
  if (audience.finalRecipients === 0) badRequest("err.campaign.noRecipients");

  const updated = await db
    .update(campaigns)
    .set({ status: "SCHEDULED", scheduledAt: parsed.date, updatedAt: new Date() })
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.status, "DRAFT")))
    .returning({ scheduledAt: campaigns.scheduledAt });

  if (updated.length === 0) conflict("err.campaign.alreadyScheduled");

  emitEvent({
    type: "campaign.scheduled", source: "api", campaignId, from: "DRAFT", to: "SCHEDULED",
    data: { scheduledAt: parsed.date.toISOString() },
  });
  return { scheduledAt: updated[0].scheduledAt ?? parsed.date };
}

/**
 * DRAFT -> QUEUED: materializes the queue and hands the campaign to the worker.
 *
 * The hand-off itself is `queueCampaign`, the same routine the worker uses when a
 * scheduled campaign's time arrives. It runs as one transaction whose first step
 * claims the DRAFT campaign, so of two concurrent requests (a double-clicked
 * button, a retried request) only one can win — the other gets a 409 — and a
 * failure part-way leaves the campaign a DRAFT rather than QUEUED but empty.
 *
 * Nothing is sent here — this only enqueues.
 */
export async function sendDraftCampaign(campaignId: string) {
  const rows = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  const campaign = rows[0];
  if (!campaign) notFound("err.campaign.notFound");
  if (campaign.status !== "DRAFT") conflict("err.campaign.alreadyStatus", { status: campaign.status });
  await assertReadyToSend(campaign);

  const outcome = await queueCampaign(campaignId, "DRAFT");

  if (!outcome.ok) {
    if (outcome.reason === "no_recipients") {
      // Nothing to send: the campaign was left a DRAFT, so it stays editable.
      badRequest("err.campaign.noRecipients");
    }
    conflict("err.campaign.alreadyQueued");
  }

  emitEvent({
    type: "campaign.queued", source: "api", campaignId, from: "DRAFT", to: "QUEUED",
    data: { recipients: outcome.queued.total },
  });
  return outcome.queued;
}
