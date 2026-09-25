/**
 * The one place that decides whether the developer test tools exist at all.
 *
 * Everything test-only (the panel, its API, the test clock, the built-in SMTP
 * server, the scheduler and rate-limit overrides) asks this function. It is
 * deliberately hard to satisfy by accident:
 *
 *  - the runtime environment must be exactly `development` or `test`. Production
 *    is off, and so is anything else, including an unset or misspelt `NODE_ENV`:
 *    if the environment cannot be told for certain, the tools are off;
 *  - and the flag must be switched on explicitly, with exactly `true`. Off by default.
 *
 * The browser is never the judge: the admin layout reads this on the server and
 * only then sends the panel to the page, and every test-only endpoint calls it
 * again itself. A public (`NEXT_PUBLIC_*`) variable is not consulted anywhere.
 */
export const TEST_PANEL_FLAG = "ENABLE_EMAIL_TEST_PANEL";

export function testPanelEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const environment = env.NODE_ENV;
  if (environment !== "development" && environment !== "test") return false;
  return env[TEST_PANEL_FLAG] === "true";
}

/** Thrown when something that only exists in the test environment is used outside it. */
export class TestToolsDisabledError extends Error {
  constructor(what = "The test tools") {
    super(`${what} are only available in a development or test environment with ${TEST_PANEL_FLAG}=true.`);
    this.name = "TestToolsDisabledError";
  }
}

export function assertTestPanelEnabled(what?: string): void {
  if (!testPanelEnabled()) throw new TestToolsDisabledError(what);
}
