import { NextResponse } from "next/server";
import { isUuid, notFound } from "@/lib/api";
import { withTestPanel } from "@/lib/testing/api";
import { resetTestCampaign, testCampaignDetails } from "@/lib/testing/test-campaigns";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Test-only. One test campaign: `GET` its queue rows and status history; `DELETE` resets it
 * (removes the campaign, its list and its made-up contacts). Both refuse a campaign that is
 * not marked as a test one, so a real campaign can be neither read nor removed through here.
 */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: Ctx) {
  return withTestPanel(async () => {
    const { id } = await ctx.params;
    if (!isUuid(id)) notFound("err.campaign.notFound");
    return NextResponse.json(await testCampaignDetails(id));
  });
}

export async function DELETE(_request: Request, ctx: Ctx) {
  return withTestPanel(async () => {
    const { id } = await ctx.params;
    if (!isUuid(id)) notFound("err.campaign.notFound");
    return NextResponse.json({ ok: true, ...(await resetTestCampaign(id)) });
  }, { mutation: true });
}
