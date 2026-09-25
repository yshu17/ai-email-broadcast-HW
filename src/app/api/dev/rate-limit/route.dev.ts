import { NextResponse } from "next/server";
import { readJson } from "@/lib/api";
import { rateLimitAction, type RateLimitRequest } from "@/lib/testing/actions";
import { withTestPanel } from "@/lib/testing/api";

/**
 * Test-only. The queue's test rate limit: `{ action: "apply", maxEmails, windowSeconds }` or
 * `{ action: "reset" }`. It sets the numbers the existing rate limiter works from; it is not a
 * second limiter, and it never touches SMTP settings.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withTestPanel(async () => {
    const body = await readJson<RateLimitRequest>(request);
    return NextResponse.json(rateLimitAction(body));
  }, { mutation: true });
}
