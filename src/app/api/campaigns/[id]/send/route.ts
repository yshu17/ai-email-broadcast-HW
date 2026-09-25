import { NextResponse } from "next/server";
import { withAuthMutation } from "@/lib/api";
import { sendDraftCampaign } from "@/lib/campaign-send";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Materializes the queue and hands the campaign to the worker.
 *
 * The hand-off itself is `queueCampaign`, the same routine the worker uses when a
 * scheduled campaign's time arrives (see `sendDraftCampaign`). It runs as one
 * transaction whose first step claims the DRAFT campaign, so of two concurrent
 * requests (a double-clicked button, a retried request) only one can win — the other
 * gets a 409 — and a failure part-way leaves the campaign a DRAFT rather than
 * QUEUED but empty.
 *
 * Nothing is sent here — this endpoint only enqueues.
 */
export async function POST(_request: Request, ctx: Ctx) {
  return withAuthMutation(async () => {
    const { id } = await ctx.params;
    const queued = await sendDraftCampaign(id);
    return NextResponse.json({ ok: true, ...queued });
  });
}
