import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import { badRequest, conflict, isUuid, notFound, readJson, withAuthMutation } from "@/lib/api";
import { rescheduleCampaign } from "@/lib/campaign-activation";
import { scheduleDraftCampaign, scheduleErrorKey } from "@/lib/campaign-send";
import { clock } from "@/lib/clock";
import { parseScheduledAt } from "@/lib/scheduling";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Schedules a DRAFT campaign for a later send.
 *
 * Applies the same readiness rules as /send, so a campaign that could not be sent
 * now cannot be scheduled either — the mistake surfaces today, not when the time
 * arrives. It records the time and flips the status; it queues no recipients and
 * sends nothing. (The rules live in `scheduleDraftCampaign`.)
 *
 * The DRAFT -> SCHEDULED transition is a conditional UPDATE, so of two concurrent
 * requests only one can win (the other gets a 409), exactly as with /send.
 */
export async function POST(request: Request, ctx: Ctx) {
  return withAuthMutation(async () => {
    const { id } = await ctx.params;

    const { scheduledAt } = await scheduleDraftCampaign(
      id,
      async () => (await readJson<{ scheduledAt?: unknown }>(request)).scheduledAt,
    );

    return NextResponse.json({ ok: true, scheduledAt: scheduledAt.toISOString() });
  });
}

/**
 * Moves an already SCHEDULED campaign to another time.
 *
 * The body is `{ scheduledAt }`: an ISO-8601 instant with a zone designator, checked
 * by the same `parseScheduledAt` as the first scheduling and compared with the
 * application's clock (the system's, or the test clock while one is held). It is the
 * only thing this endpoint reads: the status, and every other field, are not the
 * client's to set.
 *
 *  - 200 `{ ok, scheduledAt, campaign }`  the campaign is still SCHEDULED, at the new (UTC) time
 *  - 400                                  no time, a malformed one, or one that is not in the future
 *  - 401 / 403                            no session / a request from another site
 *  - 404                                  no such campaign
 *  - 409                                  it is not SCHEDULED (any longer), or its time has come and
 *                                         the scheduler is entitled to start it; nothing changed
 *
 * The write itself is conditional on the status and on the time still being ahead
 * (see `rescheduleCampaign`), so the checks above the write only choose the wording:
 * a request racing the scheduler is settled by the database, not by them.
 */
export async function PATCH(request: Request, ctx: Ctx) {
  return withAuthMutation(async () => {
    const { id } = await ctx.params;
    if (!isUuid(id)) notFound("err.campaign.notFound");

    const [campaign] = await db
      .select({ status: campaigns.status })
      .from(campaigns)
      .where(eq(campaigns.id, id))
      .limit(1);
    if (!campaign) notFound("err.campaign.notFound");
    if (campaign.status !== "SCHEDULED") conflict("err.campaign.rescheduleState", { status: campaign.status });

    const body = await readJson<{ scheduledAt?: unknown }>(request);
    const parsed = parseScheduledAt(body.scheduledAt, clock.now());
    if (!parsed.ok) badRequest(scheduleErrorKey(parsed.code), undefined, { code: parsed.code, field: "scheduledAt" });

    const result = await rescheduleCampaign(id, parsed.date, { now: clock.dbNow() });
    switch (result.outcome) {
      case "not_found":
        return notFound("err.campaign.notFound");
      case "conflict":
        return conflict(
          result.due ? "err.campaign.rescheduleDue" : "err.campaign.rescheduleState",
          { status: result.status },
        );
      default:
        return NextResponse.json({
          ok: true,
          scheduledAt: result.campaign.scheduledAt?.toISOString(),
          campaign: result.campaign,
        });
    }
  });
}
