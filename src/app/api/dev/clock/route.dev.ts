import { NextResponse } from "next/server";
import { readJson } from "@/lib/api";
import { clockAction, type ClockRequest } from "@/lib/testing/actions";
import { withTestPanel } from "@/lib/testing/api";

/**
 * Test-only. The test clock: `{ action: "set", date, time, timeZone }`, `{ action: "advance", step }`
 * or `{ action: "reset" }`. It changes what the scheduling rules take as "now" inside this
 * server process and nothing else: not the computer's clock.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withTestPanel(async () => {
    const body = await readJson<ClockRequest>(request);
    return NextResponse.json({ clock: clockAction(body) });
  }, { mutation: true });
}
