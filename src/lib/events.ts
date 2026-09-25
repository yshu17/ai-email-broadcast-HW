import { processState } from "./process-state";

/**
 * A tiny "something happened" signal for the parts of the app that already log
 * (`[scheduler] activated campaign`, a batch handed to the rate limiter, ...).
 *
 * It exists so a development tool can watch what the scheduler and the queue do
 * without those parts knowing about it. With nobody listening (which is always the
 * case in production) an `emitEvent` call does nothing, so it costs nothing to leave
 * in the code. Events carry identifiers, statuses and counts only: never a message
 * body, an address or a credential.
 */
export type EventSource = "api" | "scheduler" | "queue" | "rate-limiter" | "smtp" | "panel";

export type AppEvent = {
  /** What happened, as a dotted machine name, e.g. `campaign.activated`. The reader words it. */
  type: string;
  source: EventSource;
  campaignId?: string;
  /** For a status change. */
  from?: string;
  to?: string;
  data?: Record<string, string | number | boolean | null>;
};

type Listener = (event: AppEvent) => void;

const listeners = processState("events.listeners", () => new Set<Listener>());

export function emitEvent(event: AppEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // A broken observer must never break the code it observes.
    }
  }
}

/** Returns a function that stops listening. */
export function onEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
