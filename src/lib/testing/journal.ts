import { clock } from "../clock";
import { onEvent, type AppEvent } from "../events";
import { processState } from "../process-state";
import { testPanelEnabled } from "./access";
import { TEST_LIMITS } from "./limits";

/**
 * The recent events the test panel's journal shows.
 *
 * It does not record anything by itself. The scheduler, the queue and the rate limiter
 * already announce what they do (`emitEvent`); this only listens, and keeps the last few
 * in memory. Nothing is written to disk or to the database, and each entry holds an event's
 * identifiers, statuses and counts and nothing else: never an address, a message body or a
 * credential. It is gone when the process restarts.
 */
export type JournalEntry = AppEvent & {
  /** Rises by one per entry; a reader asks for "everything after id N". */
  id: number;
  /** Real time the event happened. */
  at: string;
  /** What the scheduling rules saw as "now" then, when the test clock was held. */
  effectiveAt: string | null;
};

type Journal = { entries: JournalEntry[]; next: number; stop: (() => void) | null };

const journal = processState<Journal>("test.journal", () => ({ entries: [], next: 1, stop: null }));

/** Starts listening for events. Safe to call again; does nothing outside a test environment. */
export function attachJournal(): void {
  if (!testPanelEnabled() || journal.stop) return;
  journal.stop = onEvent((event) => {
    journal.entries.push({
      ...event,
      id: journal.next++,
      at: new Date().toISOString(),
      effectiveAt: clock.isSimulated() ? clock.now().toISOString() : null,
    });
    const excess = journal.entries.length - TEST_LIMITS.eventLog.keep;
    if (excess > 0) journal.entries.splice(0, excess);
  });
}

/** Entries after `sinceId` (all, when omitted), oldest first, at most `limit`. */
export function readJournal(sinceId = 0, limit: number = TEST_LIMITS.eventLog.show): JournalEntry[] {
  if (!testPanelEnabled()) return [];
  const newer = journal.entries.filter((entry) => entry.id > sinceId);
  return newer.slice(-limit);
}

/** The events that concern one campaign, oldest first. */
export function readCampaignJournal(campaignId: string): JournalEntry[] {
  if (!testPanelEnabled()) return [];
  return journal.entries.filter((entry) => entry.campaignId === campaignId);
}

/** For tests: forget everything and stop listening. */
export function resetJournal(): void {
  journal.stop?.();
  journal.stop = null;
  journal.entries = [];
  journal.next = 1;
}
