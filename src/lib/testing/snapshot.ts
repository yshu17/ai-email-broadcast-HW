import { sql } from "../db";
import { clockSnapshot, type ClockSnapshot } from "../clock";
import { countSentInWindow } from "../queue";
import { HOUR_SECONDS, effectiveHourlyLimit } from "../rate-limit";
import { getSmtpConfig } from "../settings";
import { getRateOverride } from "./controls";
import { readJournal, type JournalEntry } from "./journal";
import { testScheduler, type TestSchedulerSnapshot } from "./test-scheduler";
import { ensureTestSmtp } from "./test-smtp";
import { listTestCampaigns, type TestCampaignSummary } from "./test-campaigns";

/**
 * Everything the test panel shows, in one read, so the panel polls one endpoint.
 *
 * It is read-only, and it carries counts, statuses and times: no addresses, no message
 * content, no credentials (the SMTP part is the built-in test server's own port and folder).
 */
export type QueueState = "idle" | "waiting" | "sending" | "limited";

export type TestPanelSnapshot = {
  /** The server's real time when this was read. */
  serverTime: string;
  clock: ClockSnapshot;
  scheduler: TestSchedulerSnapshot;
  queue: {
    state: QueueState;
    /** Recipients waiting to be sent (QUEUED). */
    waiting: number;
    /** Recipients being sent right now (SENDING). */
    active: number;
    /** Recipients sent (SENT). */
    done: number;
    /** Recipients that could not be sent (FAILED). */
    failed: number;
    /** Emails the limiter has counted in the current window. */
    sentInWindow: number;
  };
  rate: {
    /** `test`: the panel's setting is in force; `configured`: the app's own hourly ceiling. */
    source: "test" | "configured";
    maxEmails: number;
    windowSeconds: number;
    /** The panel's setting, if one is applied; `null` when the configured ceiling is in force. */
    override: { maxEmails: number; windowSeconds: number } | null;
  };
  smtp: {
    port: number;
    outputDir: string;
    accepted: number;
    refusedTemporarily: number;
    refusedPermanently: number;
    refusedForeign: number;
  };
  campaigns: TestCampaignSummary[];
  events: JournalEntry[];
  /** The id of the newest event the server holds; a reader asks for those after it. */
  latestEventId: number;
};

export async function buildSnapshot(sinceEventId = 0): Promise<TestPanelSnapshot> {
  const [counts] = await sql<{ waiting: string; active: string; done: string; failed: string }[]>`
    SELECT
      count(*) FILTER (WHERE delivery_status = 'QUEUED')::text  AS waiting,
      count(*) FILTER (WHERE delivery_status = 'SENDING')::text AS active,
      count(*) FILTER (WHERE delivery_status = 'SENT')::text    AS done,
      count(*) FILTER (WHERE delivery_status = 'FAILED')::text  AS failed
    FROM campaign_recipients
  `;
  const waiting = Number(counts?.waiting ?? 0);
  const active = Number(counts?.active ?? 0);

  const override = getRateOverride();
  const config = await getSmtpConfig();
  const windowSeconds = override?.windowSeconds ?? HOUR_SECONDS;
  const maxEmails = override?.maxEmails ?? effectiveHourlyLimit(config?.maxEmailsPerHour ?? 0);

  const sentInWindow = await countSentInWindow(windowSeconds);
  const smtp = await ensureTestSmtp();
  const smtpCounts = smtp.counts();
  const events = readJournal(sinceEventId);
  const newest = readJournal(0, 1)[0];

  return {
    serverTime: new Date().toISOString(),
    clock: clockSnapshot(),
    scheduler: testScheduler.snapshot(),
    queue: {
      // "Limited": there is work, and the window is full, so nothing more may start until it passes.
      state: active > 0 ? "sending" : waiting > 0 ? (sentInWindow >= maxEmails ? "limited" : "waiting") : "idle",
      waiting,
      active,
      done: Number(counts?.done ?? 0),
      failed: Number(counts?.failed ?? 0),
      sentInWindow,
    },
    rate: {
      source: override ? "test" : "configured",
      maxEmails,
      windowSeconds,
      override: override ? { maxEmails: override.maxEmails, windowSeconds: override.windowSeconds } : null,
    },
    smtp: { port: smtp.port, outputDir: smtp.outputDir, ...smtpCounts },
    campaigns: await listTestCampaigns(),
    events,
    latestEventId: newest?.id ?? 0,
  };
}
