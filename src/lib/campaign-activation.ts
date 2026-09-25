import { and, asc, count, eq, gt, lte, notExists, notInArray, sql } from "drizzle-orm";
import { db } from "./db";
import { campaignRecipients, campaigns } from "./db/schema";
import { generateRecipients, type GenerateResult } from "./campaign-recipients";
import { emitEvent } from "./events";

/**
 * Hands a campaign to the sending queue. Used by both routes into it:
 *
 *   DRAFT      -> QUEUED   the admin pressed "Queue campaign" (POST /send)
 *   SCHEDULED  -> QUEUED   the scheduled time arrived (activateDueCampaigns, below)
 *
 * Nothing here sends mail. It writes the campaign's recipient rows, which the
 * existing worker then claims, rate-limits and delivers exactly as it does for an
 * immediate send.
 */

export type QueueSource = "DRAFT" | "SCHEDULED";

export type QueueResult =
  | { ok: true; scheduledAt: Date | null; queued: GenerateResult }
  /** `unavailable`: not in the expected state, not due yet, or held by another worker. */
  | { ok: false; reason: "unavailable" | "no_recipients" };

class NoRecipients extends Error {}

/**
 * The status change and the recipient rows are ONE transaction:
 *
 *  - Claiming is `SELECT ... FOR UPDATE SKIP LOCKED` on the campaign row. Of any
 *    number of concurrent callers exactly one gets the row; the others see it
 *    locked (or already QUEUED) and get `unavailable` immediately, without waiting.
 *  - If anything fails — an error, a crash, a killed serverless invocation — the
 *    transaction rolls back and the campaign is still in its old status with no
 *    partial queue, so it can simply be tried again. There is no state in which a
 *    campaign is QUEUED but has no recipients.
 */
export async function queueCampaign(
  campaignId: string,
  from: QueueSource,
  options: { now?: Date } = {},
): Promise<QueueResult> {
  try {
    return await db.transaction(async (tx) => {
      const conditions = [eq(campaigns.id, campaignId), eq(campaigns.status, from)];
      // The database clock decides what is due, so every app instance agrees.
      // (`options.now` exists so tests can move time; nothing in the app passes it.)
      if (from === "SCHEDULED") conditions.push(lte(campaigns.scheduledAt, options.now ?? sql`now()`));

      const [claimed] = await tx
        .select({ scheduledAt: campaigns.scheduledAt })
        .from(campaigns)
        .where(and(...conditions))
        .for("update", { skipLocked: true });
      if (!claimed) return { ok: false, reason: "unavailable" } as const;

      await tx
        .update(campaigns)
        .set({ status: "QUEUED", updatedAt: new Date() })
        .where(eq(campaigns.id, campaignId));

      const queued = await generateRecipients(campaignId, tx);
      if (queued.total === 0) throw new NoRecipients();

      return { ok: true, scheduledAt: claimed.scheduledAt, queued } as const;
    });
  } catch (error) {
    // Thrown inside the transaction on purpose, so the status change is undone.
    if (error instanceof NoRecipients) return { ok: false, reason: "no_recipients" };
    throw error;
  }
}

/* ------------------------------------------------------ cancelling a schedule */

export type CancelScheduledResult =
  | { outcome: "cancelled"; campaign: typeof campaigns.$inferSelect }
  /** Nothing to do: it was already cancelled, so the request is a harmless repeat. */
  | { outcome: "already_cancelled"; campaign: typeof campaigns.$inferSelect }
  | { outcome: "not_found" }
  /** Already started (or never scheduled): too late, or not applicable. */
  | { outcome: "conflict"; status: string };

/**
 * SCHEDULED -> CANCELLED, before the campaign has started.
 *
 * It is the mirror image of activation, and the two race for the same single
 * transition out of SCHEDULED. Each is a conditional write on `status =
 * 'SCHEDULED'` against the same row, and the database serializes writers to a
 * row, so exactly one of them succeeds:
 *
 *  - Cancel first: the row is CANCELLED, so the worker's claim no longer matches
 *    it (or, if the cancel is still uncommitted, `SKIP LOCKED` steps over it).
 *  - Activation first: the campaign is QUEUED, so the UPDATE below matches
 *    nothing — it waits for the activation transaction to finish, re-checks the
 *    now-QUEUED row, and reports a conflict. A campaign that has started is
 *    never pulled back; that is what the separate `/cancel` endpoint is for.
 *
 * The status the caller believes the campaign is in never enters into it.
 */
export async function cancelScheduledCampaign(campaignId: string): Promise<CancelScheduledResult> {
  const [cancelled] = await db
    .update(campaigns)
    .set({ status: "CANCELLED", completedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.status, "SCHEDULED")))
    .returning();
  if (cancelled) {
    emitEvent({
      type: "campaign.cancelled", source: "api", campaignId, from: "SCHEDULED", to: "CANCELLED", data: { reason: "user" },
    });
    return { outcome: "cancelled", campaign: cancelled };
  }

  // Nothing matched. Look at why, to answer a repeat differently from a real conflict.
  const [current] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!current) return { outcome: "not_found" };
  if (current.status === "CANCELLED") return { outcome: "already_cancelled", campaign: current };
  return { outcome: "conflict", status: current.status };
}

/* ------------------------------------------------------ changing a schedule */

export type RescheduleResult =
  | { outcome: "rescheduled"; campaign: typeof campaigns.$inferSelect }
  | { outcome: "not_found" }
  /**
   * Nothing was changed. `due` means it is still SCHEDULED but its time has come, so
   * the scheduler is entitled to start it; otherwise it has already left SCHEDULED.
   */
  | { outcome: "conflict"; status: string; due: boolean };

/**
 * Moves a SCHEDULED campaign to another time, and only while the scheduler has not
 * yet earned the right to start it.
 *
 * Like cancelling, it is a conditional write against the one row the scheduler also
 * claims, so the database decides which of the two happens first:
 *
 *  - Move first: `scheduled_at` is the new time. The scheduler's claim re-reads the
 *    row under its lock (`scheduled_at <= now()`), sees a time in the future and
 *    leaves it — or, if the move is still uncommitted, `SKIP LOCKED` steps over it.
 *  - Activation first: the row is QUEUED (or locked by the activation). The UPDATE
 *    below waits for that transaction, re-checks the row it left behind, matches
 *    nothing, and reports a conflict. A campaign that has started is never pulled back.
 *
 * `scheduled_at > now()` is part of the condition, on the same clock the scheduler
 * uses, so a campaign whose time has come cannot be moved even in the seconds before
 * a worker tick has got to it and while a stale page still reads "scheduled".
 *
 * Nothing else is touched: no queue rows are written (there is none yet), and there
 * is no job or timer to replace — the scheduler reads `scheduled_at` afresh every tick.
 * `options.now` replaces the database clock so tests can move time; the app never passes it.
 */
export async function rescheduleCampaign(
  campaignId: string,
  scheduledAt: Date,
  options: { now?: Date } = {},
): Promise<RescheduleResult> {
  const [moved] = await db
    .update(campaigns)
    .set({ scheduledAt, updatedAt: new Date() })
    .where(and(
      eq(campaigns.id, campaignId),
      eq(campaigns.status, "SCHEDULED"),
      gt(campaigns.scheduledAt, options.now ?? sql`now()`),
    ))
    .returning();
  if (moved) {
    emitEvent({
      type: "campaign.rescheduled", source: "api", campaignId, from: "SCHEDULED", to: "SCHEDULED",
      data: { scheduledAt: scheduledAt.toISOString() },
    });
    return { outcome: "rescheduled", campaign: moved };
  }

  // Nothing matched. Look at why, so the caller can say it.
  const [current] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!current) return { outcome: "not_found" };
  return { outcome: "conflict", status: current.status, due: current.status === "SCHEDULED" };
}

/* ------------------------------------------------------- scheduled campaigns */

/**
 * Most campaigns started in one worker cycle. It bounds the time one tick spends
 * activating; whatever is left is still SCHEDULED and is taken, oldest first, by
 * the next cycle. Override with SCHEDULER_BATCH_LIMIT.
 */
const DEFAULT_BATCH_LIMIT = 100;

function batchLimit(): number {
  const configured = Number(process.env.SCHEDULER_BATCH_LIMIT);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_BATCH_LIMIT;
}

/**
 * Errors that mean "the database (or the link to it) is not there", as opposed to
 * "this campaign could not be processed". The first kind is the same for every
 * campaign, so a cycle stops at once instead of trying each one against it.
 */
const CONNECTION_ERROR_CODES = new Set([
  // Node / postgres.js
  "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "EAI_AGAIN",
  "CONNECT_TIMEOUT", "CONNECTION_CLOSED", "CONNECTION_DESTROYED", "CONNECTION_ENDED",
  // Postgres: administrator shutdown, crash shutdown, cannot connect now, connection exceptions, too many connections
  "57P01", "57P02", "57P03", "08000", "08001", "08003", "08004", "08006", "53300",
]);

export function isConnectionFailure(error: unknown): boolean {
  // The query layer wraps the driver's error, so look through `cause` as well.
  for (let depth = 0, current: unknown = error; current && depth < 4; depth += 1) {
    const { code, cause, errors } = current as { code?: unknown; cause?: unknown; errors?: unknown[] };
    if (typeof code === "string" && CONNECTION_ERROR_CODES.has(code)) return true;
    if (Array.isArray(errors) && errors.some((inner) => isConnectionFailure(inner))) return true;
    current = cause;
  }
  return false;
}

export type ActivationRecord = {
  campaignId: string;
  scheduledAt: Date | null;
  outcome: "activated" | "skipped" | "no_recipients" | "failed";
  recipients?: number;
  error?: string;
};

export type ActivationResult = {
  /** Campaigns found due (and looked at) in this cycle. */
  due: number;
  activated: number;
  /** Already taken by another worker (or no longer due) by the time we got to them. */
  skipped: number;
  /** Due, but with nobody left to send to: cancelled rather than retried forever. */
  noRecipients: number;
  failed: number;
  /** The cycle stopped early because the database could not be reached; the rest wait for the next one. */
  connectionLost: boolean;
  records: ActivationRecord[];
};

/**
 * Finds SCHEDULED campaigns whose time has come and queues them.
 *
 * Meant to run at the start of every worker tick (see `runTick`). It keeps no
 * state of its own: the schedule lives in the `campaigns` table, so a restarted
 * worker, or a different instance, simply finds whatever is overdue — however
 * long it has been — on its next cycle. "Due" is `scheduled_at <= now()`, never
 * "equal to this minute", so a campaign whose moment passed while nothing was
 * running is picked up first thing, oldest schedule first.
 *
 * Each campaign is activated independently: one that fails is logged and left
 * SCHEDULED for the next cycle, and the rest carry on. Campaigns that fail do not
 * count against `limit` (the most campaigns *started* per cycle), so a few that
 * keep failing cannot crowd out the ones queued behind them. The exception is a
 * lost database connection, which ends the cycle: it would fail them all.
 *
 * `now` replaces the database clock for the comparison, so tests can move time; the
 * app itself never passes it.
 */
export async function activateDueCampaigns(
  options: { limit?: number; deadline?: number; now?: Date } = {},
): Promise<ActivationResult> {
  const result: ActivationResult = {
    due: 0, activated: 0, skipped: 0, noRecipients: 0, failed: 0, connectionLost: false, records: [],
  };
  const limit = options.limit ?? batchLimit();
  const pastDeadline = () => options.deadline !== undefined && Date.now() >= options.deadline;
  const tried = new Set<string>();

  while (result.activated + result.noRecipients < limit && !result.connectionLost) {
    // Out of time budget: leave the rest, still SCHEDULED, for the next cycle.
    if (pastDeadline()) break;

    let page: { id: string; scheduledAt: Date | null }[];
    try {
      const conditions = [eq(campaigns.status, "SCHEDULED"), lte(campaigns.scheduledAt, options.now ?? sql`now()`)];
      if (tried.size > 0) conditions.push(notInArray(campaigns.id, [...tried]));
      page = await db
        .select({ id: campaigns.id, scheduledAt: campaigns.scheduledAt })
        .from(campaigns)
        .where(and(...conditions))
        .orderBy(asc(campaigns.scheduledAt), asc(campaigns.id))
        .limit(limit - result.activated - result.noRecipients);
    } catch (error) {
      // Do not stop the worker from sending what is already queued.
      console.error("[scheduler] could not look for due campaigns", { error: describe(error) });
      result.failed += 1;
      result.connectionLost = isConnectionFailure(error);
      break;
    }
    if (page.length === 0) break;
    result.due += page.length;

    for (const candidate of page) {
      if (pastDeadline()) break;
      tried.add(candidate.id);

      const record: ActivationRecord = {
        campaignId: candidate.id, scheduledAt: candidate.scheduledAt, outcome: "failed",
      };
      try {
        const outcome = await queueCampaign(candidate.id, "SCHEDULED", { now: options.now });
        const activatedAt = options.now ?? new Date();

        if (outcome.ok) {
          record.outcome = "activated";
          record.recipients = outcome.queued.total;
          result.activated += 1;
          emitEvent({
            type: "campaign.activated", source: "scheduler", campaignId: candidate.id, from: "SCHEDULED", to: "QUEUED",
            data: { scheduledAt: candidate.scheduledAt?.toISOString() ?? null },
          });
          emitEvent({
            type: "recipients.created", source: "scheduler", campaignId: candidate.id,
            data: { count: outcome.queued.total },
          });
          console.log("[scheduler] activated campaign", {
            campaignId: candidate.id,
            scheduledAt: candidate.scheduledAt?.toISOString() ?? null,
            activatedAt: activatedAt.toISOString(),
            lateSeconds: candidate.scheduledAt
              ? Math.round((activatedAt.getTime() - candidate.scheduledAt.getTime()) / 1000)
              : null,
            recipients: outcome.queued.total,
          });
        } else if (outcome.reason === "no_recipients") {
          await cancelEmptyCampaign(candidate.id);
          record.outcome = "no_recipients";
          result.noRecipients += 1;
          emitEvent({
            type: "campaign.cancelled", source: "scheduler", campaignId: candidate.id, from: "SCHEDULED", to: "CANCELLED",
            data: { reason: "noRecipients" },
          });
          console.log("[scheduler] cancelled campaign: no recipients left at its scheduled time", {
            campaignId: candidate.id,
            scheduledAt: candidate.scheduledAt?.toISOString() ?? null,
            activatedAt: activatedAt.toISOString(),
          });
        } else {
          record.outcome = "skipped";
          result.skipped += 1;
        }
      } catch (error) {
        record.error = describe(error);
        result.failed += 1;
        result.connectionLost = isConnectionFailure(error);
        emitEvent({
          type: "scheduler.activation.failed", source: "scheduler", campaignId: candidate.id,
          data: { databaseLost: result.connectionLost },
        });
        console.error(
          result.connectionLost
            ? "[scheduler] database unavailable; leaving the remaining campaigns for the next cycle"
            : "[scheduler] activation failed; will retry on the next cycle",
          {
            campaignId: candidate.id,
            scheduledAt: candidate.scheduledAt?.toISOString() ?? null,
            error: record.error,
          },
        );
      }
      result.records.push(record);
      if (result.connectionLost) break;
    }
  }

  return result;
}

/* ------------------------------------------------------ stuck-campaign repair */

/** How long a QUEUED campaign may have no queue before it is treated as stuck. Override with STUCK_CAMPAIGN_GRACE_SECONDS. */
const DEFAULT_STUCK_GRACE_SECONDS = 300;

function stuckGraceSeconds(): number {
  const configured = Number(process.env.STUCK_CAMPAIGN_GRACE_SECONDS);
  return Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_STUCK_GRACE_SECONDS;
}

export type RecoveryRecord = {
  campaignId: string;
  outcome: "recovered" | "cancelled" | "skipped" | "failed";
  recipients?: number;
  error?: string;
};

export type RecoveryResult = {
  found: number;
  recovered: number;
  cancelled: number;
  skipped: number;
  failed: number;
  records: RecoveryRecord[];
};

/**
 * Repairs the one state that would otherwise be permanent: a campaign that is
 * QUEUED but has no recipient rows at all. Nothing claims from it, and nothing
 * completes it (a campaign only completes from SENDING), so it would sit there
 * for ever.
 *
 * The current code cannot produce it — `queueCampaign` changes the status and
 * writes the queue in one transaction — but the database may still hold one from
 * before that change, or from an older instance still running mid-deploy that
 * wrote the two separately. The repair is the same step again, and safe to repeat:
 * write the queue (`ON CONFLICT DO NOTHING`, so never a duplicate) under the
 * campaign's row lock, and if the audience has vanished, cancel it — it sent
 * nothing, so it must not be shown as COMPLETED.
 *
 * Campaigns younger than the grace period are left alone, since an older
 * instance may be about to write theirs.
 */
export async function recoverStuckCampaigns(
  options: { limit?: number; deadline?: number } = {},
): Promise<RecoveryResult> {
  const result: RecoveryResult = { found: 0, recovered: 0, cancelled: 0, skipped: 0, failed: 0, records: [] };

  let stuck: { id: string }[];
  try {
    stuck = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(and(
        eq(campaigns.status, "QUEUED"),
        lte(campaigns.updatedAt, sql`now() - (${stuckGraceSeconds()} * interval '1 second')`),
        notExists(
          db.select({ one: campaignRecipients.id }).from(campaignRecipients)
            .where(eq(campaignRecipients.campaignId, campaigns.id)),
        ),
      ))
      .orderBy(asc(campaigns.updatedAt), asc(campaigns.id))
      .limit(options.limit ?? batchLimit());
  } catch (error) {
    console.error("[scheduler] could not look for stuck campaigns", { error: describe(error) });
    result.failed += 1;
    return result;
  }
  result.found = stuck.length;

  for (const { id } of stuck) {
    if (options.deadline !== undefined && Date.now() >= options.deadline) break;
    const record: RecoveryRecord = { campaignId: id, outcome: "failed" };
    try {
      const outcome = await db.transaction(async (tx) => {
        const [held] = await tx
          .select({ id: campaigns.id })
          .from(campaigns)
          .where(and(eq(campaigns.id, id), eq(campaigns.status, "QUEUED")))
          .for("update", { skipLocked: true });
        if (!held) return { kind: "skipped" } as const;

        // Under the lock: is it still empty?
        const [existing] = await tx
          .select({ n: count() })
          .from(campaignRecipients)
          .where(eq(campaignRecipients.campaignId, id));
        if (Number(existing?.n ?? 0) > 0) return { kind: "skipped" } as const;

        const queued = await generateRecipients(id, tx);
        if (queued.total === 0) {
          await tx
            .update(campaigns)
            .set({ status: "CANCELLED", completedAt: new Date(), updatedAt: new Date() })
            .where(eq(campaigns.id, id));
          return { kind: "cancelled" } as const;
        }
        return { kind: "recovered", recipients: queued.total } as const;
      });

      record.outcome = outcome.kind;
      if (outcome.kind === "recovered") {
        record.recipients = outcome.recipients;
        result.recovered += 1;
        emitEvent({
          type: "campaign.recovered", source: "scheduler", campaignId: id, data: { recipients: outcome.recipients },
        });
        console.log("[scheduler] gave a queue to a campaign that was QUEUED without one", {
          campaignId: id, recipients: outcome.recipients,
        });
      } else if (outcome.kind === "cancelled") {
        result.cancelled += 1;
        console.log("[scheduler] cancelled a campaign that was QUEUED without a queue and has no recipients", {
          campaignId: id,
        });
      } else {
        result.skipped += 1;
      }
    } catch (error) {
      record.error = describe(error);
      result.failed += 1;
      console.error("[scheduler] could not repair a stuck campaign; will retry on the next cycle", {
        campaignId: id, error: record.error,
      });
      if (isConnectionFailure(error)) {
        result.records.push(record);
        break;
      }
    }
    result.records.push(record);
  }

  return result;
}

/**
 * A scheduled campaign whose audience is gone (everyone unsubscribed, lists
 * emptied) has nothing to send. Retrying it every cycle would never change that,
 * so it is closed as CANCELLED. Conditional, so it is safe to repeat.
 */
async function cancelEmptyCampaign(campaignId: string): Promise<void> {
  await db
    .update(campaigns)
    .set({ status: "CANCELLED", completedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.status, "SCHEDULED")));
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
