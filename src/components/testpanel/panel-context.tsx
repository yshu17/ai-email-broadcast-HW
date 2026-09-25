"use client";

import { createContext, useContext } from "react";
import type { TestPanelSnapshot } from "@/lib/testing/snapshot";
import type { JournalEntry } from "@/lib/testing/journal";

/**
 * What every section of the panel shares: the latest snapshot from the server, the events seen so
 * far, and the one way of running an action.
 *
 * `run` marks the action busy (so its button is disabled and cannot be pressed twice), turns a
 * failure into an alert in the server's own words, and refreshes the snapshot afterwards, so what
 * the panel shows is what the server now says, never what the panel hopes it did.
 */
export type PanelContextValue = {
  snapshot: TestPanelSnapshot | null;
  /** Every event fetched so far, oldest first, at most the amount the journal shows. */
  events: JournalEntry[];
  refresh: () => Promise<void>;
  run: <T>(key: string, action: () => Promise<T>, options?: { notice?: (result: T) => string }) => Promise<T | undefined>;
  /** The key of the action in flight, if any. */
  busy: string | null;
  notice: string | null;
  error: string | null;
  clearMessages: () => void;
  selectedId: string | null;
  selectCampaign: (id: string | null) => void;
  /** The application's time as a Date: the held test time, or the real one. */
  effectiveNow: () => Date;
  requestReschedule: (campaign: { id: string; name: string; scheduledAt: string | null }) => void;
  requestCancel: (campaign: { id: string; name: string; scheduledAt: string | null }) => void;
  requestReset: (campaign: { id: string; name: string }) => void;
  /** Opens a section (the tour needs the element it points at to exist). */
  openSection: (id: import("@/lib/testing/tour").SectionId) => void;
};

const PanelContext = createContext<PanelContextValue | null>(null);

export const PanelProvider = PanelContext.Provider;

export function usePanel(): PanelContextValue {
  const value = useContext(PanelContext);
  if (!value) throw new Error("usePanel must be used inside the test panel.");
  return value;
}
