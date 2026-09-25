import "dotenv/config";
import { writeFileSync } from "node:fs";
import { createWorkerLoop } from "../src/lib/worker-loop";

/**
 * Standalone ticker for non-serverless deployments (Docker/VPS): `npm run worker`.
 *
 * It does nothing clever: it calls the same HTTP worker endpoint a cron job
 * would call, on an interval (see `src/lib/worker-loop.ts`). The queue and every
 * campaign's schedule live in Postgres either way, so this process holds no
 * state and can be restarted, or killed, at any moment.
 */
/**
 * Target the server on its own loopback address, not APP_URL: APP_URL is the
 * *public* base for tracking and unsubscribe links, and may well be a domain
 * that does not resolve from inside the container.
 */
const target =
  process.env.WORKER_TARGET_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`;
const url = `${target.replace(/\/+$/, "")}/api/worker/tick`;
const secret = process.env.WORKER_SECRET;
const intervalMs = Number(process.env.WORKER_TICK_INTERVAL_SECONDS ?? 60) * 1000;
const requestTimeoutMs = Number(process.env.WORKER_REQUEST_TIMEOUT_SECONDS ?? 90) * 1000;

if (!secret) {
  console.error("WORKER_SECRET is not set; refusing to start the worker loop.");
  process.exit(1);
}

// Touched after every tick the server answered, so a container health check can tell a live ticker from a stuck one.
const heartbeatFile = process.env.WORKER_HEARTBEAT_FILE;
const loop = createWorkerLoop({
  url,
  secret,
  intervalMs,
  requestTimeoutMs,
  onTick: (ok) => {
    if (!ok || !heartbeatFile) return;
    try {
      writeFileSync(heartbeatFile, String(Date.now()));
    } catch (error) {
      console.error("[worker] could not write the heartbeat file:", error instanceof Error ? error.message : error);
    }
  },
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`\n${signal} received, finishing current tick then exiting.`);
    // Cuts the wait between ticks short: without it the process would sit out
    // the rest of the interval and get hard-killed by the container runtime.
    loop.stop();
  });
}

console.log(`[worker] ticking ${url} every ${intervalMs / 1000}s`);
loop.run().then(
  () => process.exit(0),
  (error) => {
    console.error("[worker] loop crashed:", error);
    process.exit(1);
  },
);
