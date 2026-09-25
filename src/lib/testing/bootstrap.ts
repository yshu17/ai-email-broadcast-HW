import { testPanelEnabled } from "./access";
import { attachJournal } from "./journal";
import { testScheduler } from "./test-scheduler";
import { ensureTestSmtp } from "./test-smtp";

/**
 * What runs once when the server process starts (see `src/instrumentation.ts`), and only
 * where the test tools are on: the journal starts listening, the built-in test SMTP server
 * comes up, and the test scheduler starts, so a campaign scheduled for a moment that
 * arrives is started without anyone running `npm run worker`.
 *
 * Anywhere else this does nothing at all.
 */
export async function startTestTools(): Promise<void> {
  if (!testPanelEnabled()) return;
  attachJournal();
  await ensureTestSmtp();
  testScheduler.start();
  console.log("[test-panel] enabled: test clock, test SMTP server and test scheduler are available (development only)");
}
