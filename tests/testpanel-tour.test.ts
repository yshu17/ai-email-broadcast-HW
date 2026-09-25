import { describe, expect, it } from "vitest";
import { messages } from "@/i18n/messages";
import { translate, type MessageKey } from "@/i18n/translate";
import { LOCALES } from "@/i18n/locale";
import { SCENARIO_IDS, SCENARIO_PARTS, scenarioParams } from "@/lib/testing/scenarios";
import { TEST_LIMITS } from "@/lib/testing/limits";
import { RATE_PRESETS, TEST_TEMPLATES } from "@/lib/testing/templates";
import { TOUR_STEPS, tourParams, tourReducer, type TourState } from "@/lib/testing/tour";
import { DEFAULT_UI_STATE, UI_STATE_KEY, readUiState, writeUiState } from "@/components/testpanel/ui-state";

/**
 * The tour's steps and its state machine, the scenarios' content, and what the panel is allowed to
 * write to the browser. Pure: nothing here needs a page.
 */
const closed: TourState = { open: false, step: 0 };

describe("the tour's steps", () => {
  it("are the ten of the requirements, in order", () => {
    expect(TOUR_STEPS.map((step) => step.id)).toEqual([
      "setClock", "rateLimit", "createCampaign", "checkScheduled", "advance",
      "runCycle", "seeQueued", "watchRate", "finalStatus", "cleanup",
    ]);
  });

  it("each name the element to light and the section it lives in", () => {
    for (const step of TOUR_STEPS) {
      expect(step.target.length, step.id).toBeGreaterThan(0);
      expect(["clock", "scheduler", "queue", "create", "campaigns", "journal", "guides"]).toContain(step.section);
    }
  });

  it.each(LOCALES)("each have a title, an instruction and an expected result in %s, with every placeholder filled", (locale) => {
    const params = tourParams();
    for (const step of TOUR_STEPS) {
      for (const part of ["title", "body", "expected"]) {
        const key = `tour.step.${step.id}.${part}` as MessageKey;
        expect(messages[key as keyof typeof messages], key).toBeDefined();
        const text = translate(locale, key, params);
        expect(text.trim().length, key).toBeGreaterThan(0);
        expect(text, key).not.toMatch(/\{\w+\}/);
      }
    }
  });

  it("use the numbers of the template and the preset they tell the person to press", () => {
    const params = tourParams();
    const template = TEST_TEMPLATES.find((t) => t.id === "in5min");
    const preset = RATE_PRESETS.find((p) => p.id === "visible");
    expect(params.minutes).toBe(template?.offsetMinutes);
    expect(params.recipients).toBe(template?.recipients);
    expect(params.rateMax).toBe(preset?.maxEmails);
    expect(params.rateWindow).toBe(preset?.windowSeconds);
    expect(params.total).toBe(10);
  });

  it("do not ask the person to do anything the panel cannot (each refers to buttons that exist)", () => {
    const text = TOUR_STEPS.map((step) => translate("en", `tour.step.${step.id}.body` as MessageKey, tourParams())).join(" ");
    for (const button of ["Set", "Apply", "Create test campaign", "Advance", "Run now", "Reset to real time", "Reset to defaults"]) {
      expect(text, button).toContain(button);
    }
  });
});

describe("the tour's state machine", () => {
  it("starts open at the step it was left at, or the first", () => {
    expect(tourReducer(closed, { type: "start" })).toEqual({ open: true, step: 0 });
    expect(tourReducer({ open: false, step: 4 }, { type: "start" })).toEqual({ open: true, step: 4 });
    expect(tourReducer(closed, { type: "start", step: 6 })).toEqual({ open: true, step: 6 });
  });

  it("never starts past the last step, or before the first, whatever was saved", () => {
    expect(tourReducer(closed, { type: "start", step: 99 }).step).toBe(TOUR_STEPS.length - 1);
    expect(tourReducer(closed, { type: "start", step: -5 }).step).toBe(0);
  });

  it("goes through every step with Next", () => {
    let state = tourReducer(closed, { type: "start" });
    const seen = [state.step];
    for (let i = 0; i < TOUR_STEPS.length - 1; i += 1) {
      state = tourReducer(state, { type: "next" });
      seen.push(state.step);
    }
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(state.open).toBe(true);
  });

  it("finishes on Next at the last step: it closes and rewinds", () => {
    expect(tourReducer({ open: true, step: 9 }, { type: "next" })).toEqual({ open: false, step: 0 });
  });

  it("goes back one step, and stops at the first", () => {
    expect(tourReducer({ open: true, step: 5 }, { type: "back" })).toEqual({ open: true, step: 4 });
    expect(tourReducer({ open: true, step: 0 }, { type: "back" })).toEqual({ open: true, step: 0 });
  });

  it("closes keeping the step, so it can be picked up again", () => {
    expect(tourReducer({ open: true, step: 6 }, { type: "close" })).toEqual({ open: false, step: 6 });
  });

  it("starts over from the first step", () => {
    expect(tourReducer({ open: true, step: 6 }, { type: "restart" })).toEqual({ open: true, step: 0 });
    expect(tourReducer({ open: false, step: 6 }, { type: "restart" })).toEqual({ open: true, step: 0 });
  });

  it("ignores Next and Back while it is closed", () => {
    expect(tourReducer({ open: false, step: 3 }, { type: "next" })).toEqual({ open: false, step: 3 });
    expect(tourReducer({ open: false, step: 3 }, { type: "back" })).toEqual({ open: false, step: 3 });
  });

  it("can be run again and again", () => {
    let state = closed;
    for (let round = 0; round < 3; round += 1) {
      state = tourReducer(state, { type: "start" });
      for (let i = 0; i < TOUR_STEPS.length; i += 1) state = tourReducer(state, { type: "next" });
      expect(state).toEqual({ open: false, step: 0 });
    }
  });
});

describe("the scenarios", () => {
  it("are the nine of the requirements", () => {
    expect(SCENARIO_IDS).toEqual(["regular", "immediate", "cancel", "reschedule", "missed", "restart", "rate", "tempfail", "permfail"]);
  });

  it.each(LOCALES)("each have a title and all five parts in %s, with every placeholder filled", (locale) => {
    const params = scenarioParams();
    for (const id of SCENARIO_IDS) {
      expect(messages[`scenario.${id}.title` as keyof typeof messages], id).toBeDefined();
      for (const part of SCENARIO_PARTS) {
        const key = `scenario.${id}.${part}` as MessageKey;
        expect(messages[key as keyof typeof messages], key).toBeDefined();
        const text = translate(locale, key, params);
        expect(text.split("\n").filter(Boolean).length, key).toBeGreaterThan(0);
        expect(text, key).not.toMatch(/\{\w+\}/);
      }
    }
  });

  it("give steps that can be followed: at least three each", () => {
    for (const id of SCENARIO_IDS) {
      const steps = translate("en", `scenario.${id}.steps` as MessageKey, scenarioParams()).split("\n").filter(Boolean);
      expect(steps.length, id).toBeGreaterThanOrEqual(3);
    }
  });

  it("say how to put things back, in every scenario", () => {
    for (const id of SCENARIO_IDS) {
      const reset = translate("en", `scenario.${id}.reset` as MessageKey, scenarioParams());
      expect(reset, id).toMatch(/Reset|Nothing|Press/);
    }
  });

  it("take their numbers from the templates and presets, and stay inside the limits", () => {
    const params = scenarioParams();
    expect(params.bigRecipients).toBe(TEST_TEMPLATES.find((t) => t.id === "bigRate")?.recipients);
    expect(params.tempFailures).toBe(TEST_TEMPLATES.find((t) => t.id === "tempFail")?.temporaryFailures);
    expect(params.rateMax).toBeLessThanOrEqual(TEST_LIMITS.rateMaxEmails.max);
    expect(params.bigRecipients).toBeLessThanOrEqual(TEST_LIMITS.recipients.max);
  });
});

describe("what the panel writes to the browser", () => {
  const fakeStorage = (initial: string | null = null) => {
    const data = new Map<string, string>(initial === null ? [] : [[UI_STATE_KEY, initial]]);
    return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  };

  it("starts from the defaults when nothing is saved", () => {
    expect(readUiState(fakeStorage())).toEqual(DEFAULT_UI_STATE);
  });

  it("reads back what it wrote", () => {
    const store = fakeStorage();
    const state = { ...DEFAULT_UI_STATE, open: true, tourStep: 4, advanceStep: "hour", autoRefresh: false, sections: { ...DEFAULT_UI_STATE.sections, journal: false } };
    writeUiState(state, store);
    expect(readUiState(store)).toEqual(state);
  });

  it("writes exactly one key, holding only preferences about the panel", () => {
    const store = fakeStorage();
    writeUiState({ ...DEFAULT_UI_STATE, open: true }, store);

    expect([...store.data.keys()]).toEqual([UI_STATE_KEY]);
    const saved = JSON.parse(store.data.get(UI_STATE_KEY) ?? "{}");
    expect(Object.keys(saved).sort()).toEqual(["advanceStep", "autoRefresh", "open", "sections", "tourStep"]);
    expect(JSON.stringify(saved)).not.toMatch(/token|secret|password|@|scheduledAt|campaignId/i);
  });

  it.each([["not json", "{{{"], ["a number", "42"], ["null", "null"], ["an array", "[1,2]"], ["a string", "\"x\""]])(
    "falls back to the defaults when what is saved is %s", (_label, saved) => {
      expect(readUiState(fakeStorage(saved))).toEqual(DEFAULT_UI_STATE);
    },
  );

  it("keeps what is valid and mends what is not", () => {
    const state = readUiState(fakeStorage(JSON.stringify({ open: "yes", tourStep: -3, advanceStep: 7, autoRefresh: false, sections: { clock: false, bogus: true } })));

    expect(state.open).toBe(false);
    expect(state.tourStep).toBe(0);
    expect(state.advanceStep).toBe(DEFAULT_UI_STATE.advanceStep);
    expect(state.autoRefresh).toBe(false);
    expect(state.sections.clock).toBe(false);
    expect(state.sections.scheduler).toBe(true);
  });

  it("works with no storage at all, and with storage that throws", () => {
    expect(readUiState(null)).toEqual(DEFAULT_UI_STATE);
    expect(() => writeUiState(DEFAULT_UI_STATE, null)).not.toThrow();
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readUiState(blocked)).toEqual(DEFAULT_UI_STATE);
    expect(() => writeUiState(DEFAULT_UI_STATE, blocked)).not.toThrow();
  });
});
