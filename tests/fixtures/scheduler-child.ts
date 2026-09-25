/**
 * The scheduler as a real OS process, for the tests that need one to kill, restart
 * or race against another: `node --import tsx tests/fixtures/scheduler-child.ts <mode>`.
 *
 *   activate   one `activateDueCampaigns()` cycle
 *   tick       one whole worker tick (`runTick`): activate, then send
 *
 * It uses whatever DATABASE_URL and SMTP_* it inherits, which the test setup points
 * at the throwaway database and an in-process fake SMTP server. CHILD_START_AT (epoch
 * milliseconds) is a starting gun, so several processes can be released together.
 * The result is printed as a single `RESULT {json}` line.
 */
import { activateDueCampaigns } from "../../src/lib/campaign-activation";
import { runTick } from "../../src/lib/worker";
import { sql } from "../../src/lib/db";

const mode = process.argv[2] ?? "activate";

async function main() {
  const wait = Number(process.env.CHILD_START_AT ?? 0) - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));

  const result = mode === "tick"
    ? await runTick({ timeBudgetMs: Number(process.env.CHILD_TIME_BUDGET_MS ?? 20_000) })
    : await activateDueCampaigns();

  process.stdout.write(`RESULT ${JSON.stringify(result)}\n`);
  await sql.end({ timeout: 5 });
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
  },
);
