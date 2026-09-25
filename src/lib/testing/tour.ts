import { RATE_PRESETS, TEST_TEMPLATES } from "./templates";

/** The folding sections of the panel. */
export type SectionId = "clock" | "scheduler" | "queue" | "create" | "campaigns" | "journal" | "guides";

/**
 * The tour "How to test scheduling", as data and as a small state machine.
 *
 * A step names the element it points at (`target`: a `data-tour` value in the panel) and the
 * section that must be open for that element to be there. Its words live in the dictionary
 * (`tour.step.<id>.title`, `.body`, `.expected`). The tour never presses a button for the person:
 * it shows where to look and what to expect, and every change is one they make themselves.
 */
export type TourStep = { id: string; target: string; section: SectionId };

export const TOUR_STEPS: readonly TourStep[] = [
  { id: "setClock", target: "clock-mode", section: "clock" },
  { id: "rateLimit", target: "rate-fields", section: "queue" },
  { id: "createCampaign", target: "create-templates", section: "create" },
  { id: "checkScheduled", target: "campaign-status", section: "campaigns" },
  { id: "advance", target: "clock-advance", section: "clock" },
  { id: "runCycle", target: "sched-run", section: "scheduler" },
  { id: "seeQueued", target: "campaign-status", section: "campaigns" },
  { id: "watchRate", target: "queue-counts", section: "queue" },
  { id: "finalStatus", target: "campaign-status", section: "campaigns" },
  { id: "cleanup", target: "clock-reset", section: "clock" },
];

/** The numbers the tour's words use: the "in 5 minutes" template and the "visible" rate preset. */
export function tourParams(): Record<string, number> {
  const template = TEST_TEMPLATES.find((t) => t.id === "in5min");
  const preset = RATE_PRESETS.find((p) => p.id === "visible");
  return {
    minutes: template?.offsetMinutes ?? 5,
    recipients: template?.recipients ?? 5,
    rateMax: preset?.maxEmails ?? 2,
    rateWindow: preset?.windowSeconds ?? 10,
    total: TOUR_STEPS.length,
  };
}

export type TourState = { open: boolean; step: number };

export type TourAction =
  | { type: "start"; step?: number }
  | { type: "next" }
  | { type: "back" }
  | { type: "close" }
  | { type: "restart" };

/**
 * Next on the last step finishes the tour, which closes it and rewinds it to the first step, so
 * the next visit starts fresh. Closing anywhere else keeps the step, so it can be picked up again.
 */
export function tourReducer(state: TourState, action: TourAction, total: number = TOUR_STEPS.length): TourState {
  const last = total - 1;
  switch (action.type) {
    case "start":
      return { open: true, step: Math.min(Math.max(0, action.step ?? state.step), last) };
    case "restart":
      return { open: true, step: 0 };
    case "next":
      if (!state.open) return state;
      return state.step >= last ? { open: false, step: 0 } : { open: true, step: state.step + 1 };
    case "back":
      if (!state.open) return state;
      return { open: true, step: Math.max(0, state.step - 1) };
    case "close":
      return { ...state, open: false };
  }
}
