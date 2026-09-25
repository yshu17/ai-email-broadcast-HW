import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

/**
 * Health check for load balancers and container orchestrators: 200 when the server is up and can
 * reach the database, 503 when it cannot. It needs no sign-in and says nothing else: no version,
 * no host, no reason. What went wrong is in the server's log.
 */
export const dynamic = "force-dynamic";

const DATABASE_TIMEOUT_MS = 3_000;

const headers = { "cache-control": "no-store" };

export async function GET() {
  try {
    await Promise.race([
      sql`select 1`,
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error("database did not answer")), DATABASE_TIMEOUT_MS).unref()),
    ]);
    return NextResponse.json({ status: "ok" }, { headers });
  } catch (error) {
    console.error("[health] database check failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ status: "unavailable" }, { status: 503, headers });
  }
}
