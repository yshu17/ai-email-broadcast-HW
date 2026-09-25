import { NextResponse } from "next/server";
import { conflict, isUuid, notFound, withAuthMutation } from "@/lib/api";
import { cancelScheduledCampaign } from "@/lib/campaign-activation";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Cancels a campaign that is scheduled but has not started: SCHEDULED -> CANCELLED.
 *
 * Deliberately separate from `/cancel`, which stops a send that is under way
 * (QUEUED, SENDING, PAUSED). This one only ever acts on SCHEDULED, so a stale
 * page showing "scheduled" can never cancel a campaign that has since started.
 * The request body is not read: the status to move from is not the client's to say.
 *
 *  - 200 `{ ok, alreadyCancelled: false, campaign }`  it was SCHEDULED and now is CANCELLED
 *  - 200 `{ ok, alreadyCancelled: true,  campaign }`  a repeat; nothing changed
 *  - 404                                               no such campaign
 *  - 409                                               already started (or never scheduled); nothing changed
 *
 * Nothing is deleted, and `scheduledAt` is kept as history.
 */
export async function POST(_request: Request, ctx: Ctx) {
  return withAuthMutation(async () => {
    const { id } = await ctx.params;
    if (!isUuid(id)) notFound("err.campaign.notFound");

    const result = await cancelScheduledCampaign(id);
    switch (result.outcome) {
      case "not_found":
        return notFound("err.campaign.notFound");
      case "conflict":
        return conflict("err.campaign.cancelScheduledState", { status: result.status });
      default:
        return NextResponse.json({
          ok: true,
          alreadyCancelled: result.outcome === "already_cancelled",
          campaign: result.campaign,
        });
    }
  });
}
