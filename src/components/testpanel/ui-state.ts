import { useSyncExternalStore } from "react";
import type { SectionId } from "@/lib/testing/tour";

/**
 * What the panel remembers between visits, and only that: whether the drawer is open, which
 * sections are folded, the step of the tour, the advance step, the journal's auto-refresh. All of
 * it is a preference about the panel itself; none of it is a setting of the app, and it lives in
 * this browser's local storage, never on the server.
 *
 * Every read and write is guarded: private windows and blocked storage throw, and the panel must
 * work without any of this.
 */
export type { SectionId };

export const UI_STATE_KEY = "testpanel.ui.v1";

export type UiState = {
  open: boolean;
  sections: Record<SectionId, boolean>;
  /** The step the tour was left at, so it can be picked up again. */
  tourStep: number;
  advanceStep: string;
  autoRefresh: boolean;
};

export const DEFAULT_UI_STATE: UiState = {
  open: false,
  sections: { clock: true, scheduler: true, queue: true, create: true, campaigns: true, journal: true, guides: false },
  tourStep: 0,
  advanceStep: "fiveMinutes",
  autoRefresh: true,
};

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readUiState(store: Storage | null = storage()): UiState {
  if (!store) return DEFAULT_UI_STATE;
  try {
    const saved = JSON.parse(store.getItem(UI_STATE_KEY) ?? "null") as Partial<UiState> | null;
    if (!saved || typeof saved !== "object") return DEFAULT_UI_STATE;
    return {
      open: saved.open === true,
      sections: { ...DEFAULT_UI_STATE.sections, ...(typeof saved.sections === "object" ? saved.sections : {}) },
      tourStep: Number.isInteger(saved.tourStep) && (saved.tourStep as number) >= 0 ? (saved.tourStep as number) : 0,
      advanceStep: typeof saved.advanceStep === "string" ? saved.advanceStep : DEFAULT_UI_STATE.advanceStep,
      autoRefresh: saved.autoRefresh !== false,
    };
  } catch {
    return DEFAULT_UI_STATE;
  }
}

export function writeUiState(state: UiState, store: Storage | null = storage()): void {
  if (!store) return;
  try {
    store.setItem(UI_STATE_KEY, JSON.stringify(state));
  } catch {
    // The preference just will not be remembered.
  }
}

/* --------------------------------------------------- as a store React can read */

/**
 * The saved state as an external store, so a component reads it with `useUiState` and is given
 * the defaults while rendering on the server and during hydration, and the saved values right after,
 * without an effect that copies them in.
 */
let current: UiState | null = null;
const listeners = new Set<() => void>();

function snapshot(): UiState {
  current ??= readUiState();
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Changes some of the remembered state, and tells every reader. */
export function updateUiState(patch: Partial<UiState>): void {
  current = { ...snapshot(), ...patch };
  writeUiState(current);
  listeners.forEach((listener) => listener());
}

/** Opens a section without a second write when it is already open. */
export function openUiSection(id: SectionId): void {
  const state = snapshot();
  if (state.sections[id]) return;
  updateUiState({ sections: { ...state.sections, [id]: true } });
}

/** For tests: forget what this page has cached, so the next read comes from storage again. */
export function resetUiStateCache(): void {
  current = null;
  listeners.forEach((listener) => listener());
}

export function useUiState(): UiState {
  return useSyncExternalStore(subscribe, snapshot, () => DEFAULT_UI_STATE);
}
