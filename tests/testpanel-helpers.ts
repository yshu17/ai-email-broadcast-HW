import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { resetClock } from "@/lib/clock";
import { resetSchedulerRuntime } from "@/lib/scheduler";
import { resetRateLimiterState } from "@/lib/worker";
import { resetRateOverride } from "@/lib/testing/controls";
import { attachJournal, resetJournal } from "@/lib/testing/journal";
import { testScheduler } from "@/lib/testing/test-scheduler";
import { stopSharedTestSmtp } from "@/lib/testing/test-smtp";
import { sql } from "@/lib/db";
import { importContacts } from "@/lib/import";
import { testAddress, type TestAddressPlan } from "@/lib/testing/test-addresses";

/**
 * Shared setup for the test-panel tests: turns the tools on for one test, gives the built-in
 * SMTP server a scratch folder for its `.eml` files, and puts everything back after.
 *
 * Only the session check is stubbed (in each file, with `vi.mock("@/lib/auth")`, as elsewhere);
 * the database, the scheduler, the queue and the test SMTP server are all real.
 */
export const HOUR = 60 * 60 * 1000;

let mailDir = "";

export function mailFolder(): string {
  return mailDir;
}

export function receivedFiles(): string[] {
  return readdirSync(mailDir).filter((file) => file.endsWith(".eml")).sort();
}

export async function enableTestTools(): Promise<void> {
  vi.stubEnv("ENABLE_EMAIL_TEST_PANEL", "true");
  mailDir = mkdtempSync(join(tmpdir(), "test-panel-mail-"));
  vi.stubEnv("TEST_SMTP_OUTPUT_DIR", mailDir);
  vi.stubEnv("SMTP_MAX_EMAILS_PER_HOUR", "5000");
  vi.stubEnv("WORKER_TICK_INTERVAL_SECONDS", "3600");
  await stopSharedTestSmtp();
  resetJournal();
  attachJournal();
}

export async function disableTestTools(): Promise<void> {
  testScheduler.reset();
  resetClock();
  resetRateOverride();
  resetSchedulerRuntime();
  resetRateLimiterState();
  resetJournal();
  await stopSharedTestSmtp();
  vi.unstubAllEnvs();
  if (mailDir) rmSync(mailDir, { recursive: true, force: true });
  mailDir = "";
}

/** Makes the rate limiter's log look as if it had been written `seconds` ago. */
export async function ageSendLog(seconds: number): Promise<void> {
  await sql`UPDATE smtp_send_log SET occurred_at = occurred_at - (${seconds} * interval '1 second')`;
}

/** Makes every retry wait over, as if the back-off had passed. */
export async function makeRetriesDue(): Promise<void> {
  await sql`UPDATE campaign_recipients SET next_attempt_at = now() - interval '1 second' WHERE delivery_status = 'QUEUED'`;
}

export const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

export const jsonRequest = (method: string, body?: unknown, url = "https://mail.example.test/api") =>
  new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** Puts `count` made-up test recipients in a list, all meeting the same SMTP scenario. */
export async function addTestContacts(listId: string, count: number, plan: TestAddressPlan = { scenario: "success" }): Promise<string[]> {
  const batch = Math.random().toString(36).slice(2, 8);
  const addresses = Array.from({ length: count }, (_, index) => testAddress(plan, batch, index + 1));
  await importContacts(listId, addresses.map((email) => ({ email })));
  return addresses;
}
