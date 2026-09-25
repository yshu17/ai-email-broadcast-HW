import { NextResponse } from "next/server";
import { readJson } from "@/lib/api";
import { schedulerAction, type SchedulerRequest } from "@/lib/testing/actions";
import { withTestPanel } from "@/lib/testing/api";

/**
 * Test-only. The local test scheduler: `{ action: "start" | "stop" | "run" }` or
 * `{ action: "interval", seconds }`. "run" is exactly one scheduler cycle, by the same service
 * the loop and the worker endpoint use; it does not send anything by itself.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withTestPanel(async () => {
    const body = await readJson<SchedulerRequest>(request);
    return NextResponse.json(await schedulerAction(body));
  }, { mutation: true });
}
