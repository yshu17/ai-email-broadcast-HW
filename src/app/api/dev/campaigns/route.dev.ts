import { NextResponse } from "next/server";
import { readJson } from "@/lib/api";
import { withTestPanel } from "@/lib/testing/api";
import { createTestCampaign, type CreateTestCampaignInput } from "@/lib/testing/test-campaigns";

/**
 * Test-only. Creates a test campaign for made-up `@test.invalid` recipients and sends or
 * schedules it by the ordinary services. The request never carries an email address: only how
 * many recipients, and which SMTP scenario they should meet.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withTestPanel(async () => {
    const body = await readJson<CreateTestCampaignInput>(request);
    return NextResponse.json(await createTestCampaign(body), { status: 201 });
  }, { mutation: true });
}
