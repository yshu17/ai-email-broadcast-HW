import { NextResponse } from "next/server";
import { attachJournal } from "@/lib/testing/journal";
import { withTestPanel } from "@/lib/testing/api";
import { buildSnapshot } from "@/lib/testing/snapshot";

/**
 * Test-only. Everything the test panel shows, in one read: the clock, the scheduler, the
 * queue and rate limit, the built-in SMTP server, the test campaigns and the newest events
 * (`?since=<id>` asks only for those after an id).
 *
 * This file is named `route.dev.ts` so that a production build leaves it out entirely
 * (see `pageExtensions` in `next.config.ts`); `withTestPanel` refuses in any other
 * environment that is not a development or test one with the flag on.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withTestPanel(async () => {
    attachJournal();
    const since = Number(new URL(request.url).searchParams.get("since") ?? 0);
    return NextResponse.json(await buildSnapshot(Number.isFinite(since) && since > 0 ? since : 0));
  });
}
