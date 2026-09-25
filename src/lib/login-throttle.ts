import { processState } from "./process-state";

/**
 * A brake on guessing passwords. Every failed sign-in is counted against the account name and
 * against the caller's address; once either has failed too often in a short time, further
 * attempts are refused (even with the right password) until the window has passed. A successful
 * sign-in clears the account's count.
 *
 * The counts live in this process's memory. That is enough for one self-hosted server, where it
 * stops a script from trying thousands of passwords a minute; several replicas each keep their own
 * count, so put a rate limit on the proxy as well if the sign-in page is on the open internet.
 * A restart forgets the counts, which only ever lets a person try again.
 */
export const LOGIN_WINDOW_MS = 10 * 60 * 1000;
export const MAX_FAILURES_PER_ACCOUNT = 8;
export const MAX_FAILURES_PER_ADDRESS = 30;
/** How many distinct keys are remembered; the oldest go first, so the map cannot grow without bound. */
const MAX_KEYS = 5_000;

type Entry = { failures: number; windowStartedAt: number };

const attempts = processState("login-throttle", () => new Map<string, Entry>());

const accountKey = (email: string) => `account:${email.trim().toLowerCase().slice(0, 254)}`;
const addressKey = (address: string) => `address:${address.trim().slice(0, 64) || "unknown"}`;

function live(key: string, now: number): Entry | undefined {
  const entry = attempts.get(key);
  if (!entry) return undefined;
  if (now - entry.windowStartedAt >= LOGIN_WINDOW_MS) {
    attempts.delete(key);
    return undefined;
  }
  return entry;
}

/** Whether a sign-in for this account from this address may be tried now. */
export function loginAllowed(email: string, address: string, now = Date.now()): boolean {
  return (
    (live(accountKey(email), now)?.failures ?? 0) < MAX_FAILURES_PER_ACCOUNT &&
    (live(addressKey(address), now)?.failures ?? 0) < MAX_FAILURES_PER_ADDRESS
  );
}

function count(key: string, now: number): void {
  const entry = live(key, now);
  if (entry) {
    entry.failures += 1;
    return;
  }
  if (attempts.size >= MAX_KEYS) {
    // Maps iterate in insertion order, so the first key is the oldest.
    const oldest = attempts.keys().next().value;
    if (oldest !== undefined) attempts.delete(oldest);
  }
  attempts.set(key, { failures: 1, windowStartedAt: now });
}

export function recordLoginFailure(email: string, address: string, now = Date.now()): void {
  count(accountKey(email), now);
  count(addressKey(address), now);
}

export function recordLoginSuccess(email: string): void {
  attempts.delete(accountKey(email));
}

/** The caller's address as the proxy in front reports it; only a counting key, never trusted for anything else. */
export function callerAddress(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip")?.trim() || "unknown";
}

/** For tests: forget everything. */
export function resetLoginThrottle(): void {
  attempts.clear();
}
