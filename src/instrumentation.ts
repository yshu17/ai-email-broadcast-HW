/**
 * Runs once when the Next.js server starts.
 *
 * It exists for one thing: to bring up the developer test tools (test SMTP server,
 * test scheduler, event journal) when they are switched on. In production, and whenever
 * `ENABLE_EMAIL_TEST_PANEL` is not `true` in a development or test environment,
 * `startTestTools` returns at once and nothing is started.
 */
export async function register(): Promise<void> {
  // A production build drops everything below (`NODE_ENV` is a build-time constant), so none of the test
  // tools is part of what runs there.
  if (process.env.NODE_ENV === "production") return;
  // Node only: the tools use sockets and timers the Edge runtime does not have.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startTestTools } = await import("./lib/testing/bootstrap");
  await startTestTools();
}
