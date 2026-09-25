import type { LimitId } from "./limits";

/**
 * The registry of help for the test panel: one entry for every field, switch, figure and
 * button on it. It holds the facts about each element, and the words live in the dictionary
 * (`help.<id>.title`, `.what`, `.impact`, ...), so they are translated like the rest of the
 * interface.
 *
 * What is NOT here is any number. An element that has a range or a recommendation names the
 * limit it takes them from (`limit`), and the help is written with that limit's own `min` and
 * `max` from `TEST_LIMITS`, the object the server and the form check input against. A range
 * in the help therefore cannot differ from the one enforced.
 *
 * `kind`: a short `tooltip` (one line) for a simple figure or button, or a structured
 * `popover` (what it is, what it affects, unit, allowed values, recommended, when it applies,
 * how long it lasts, what to watch out for) for anything that needs it.
 */
export type HelpKind = "tooltip" | "popover";

/** When a change takes effect. Each has one shared sentence, so the same words are not translated twice. */
export type AppliesId =
  | "immediately" | "onPress" | "onSet" | "onApply" | "onCreate" | "nextCycle" | "display";

/** How long a setting lasts. */
export type LifetimeId = "untilReset" | "untilRestart" | "untilStop" | "campaign" | "view" | "browser" | "none";

/** What a value is measured in, or is. Each has one shared word. */
export type UnitId =
  | "seconds" | "minutes" | "emails" | "recipients" | "count" | "characters" | "date" | "time" | "zone" | "years";

export type HelpEntry = {
  id: string;
  kind: HelpKind;
  /** Where the numbers shown as "Allowed values" and "Recommended" come from. */
  limit?: LimitId;
  unit?: UnitId;
  /** How the recommendation is drawn from the limit: one range, or a quick range and a long-run range. */
  recommended?: "range" | "two" | "text";
  applies?: AppliesId;
  lifetime?: LifetimeId;
  /** Has an "Important" part. */
  warning?: boolean;
};

const tip = <Id extends string>(id: Id) => ({ id, kind: "tooltip" }) as const;

export const HELP_ENTRIES = [
  /* ------------------------------------------------------------------- panel */
  { id: "testMode", kind: "popover", applies: "display", lifetime: "view", warning: true },
  tip("tourButton"),

  /* ------------------------------------------------------------- test clock */
  tip("clockRealNow"),
  tip("clockEffectiveNow"),
  tip("clockUserZone"),
  tip("clockMode"),
  { id: "clockModeReal", kind: "popover", applies: "onPress", lifetime: "none" },
  { id: "clockModeFixed", kind: "popover", applies: "onSet", lifetime: "untilReset", warning: true },
  { id: "clockDate", kind: "popover", unit: "date", applies: "onSet", lifetime: "untilReset" },
  { id: "clockTime", kind: "popover", unit: "time", applies: "onSet", lifetime: "untilReset" },
  { id: "clockTimeZone", kind: "popover", unit: "zone", applies: "onSet", lifetime: "untilReset", warning: true },
  { id: "clockStep", kind: "popover", unit: "minutes", applies: "onPress", lifetime: "browser" },
  { id: "clockSet", kind: "popover", applies: "onPress", lifetime: "untilReset", warning: true },
  { id: "clockAdvance", kind: "popover", applies: "onPress", lifetime: "untilReset", warning: true },
  { id: "clockReset", kind: "popover", applies: "onPress", lifetime: "none" },

  /* -------------------------------------------------------------- scheduler */
  tip("schedRunning"),
  { id: "schedInterval", kind: "popover", limit: "schedulerInterval", unit: "seconds", recommended: "two", applies: "immediately", lifetime: "untilRestart", warning: true },
  tip("schedLastCycle"),
  tip("schedNextCycle"),
  tip("schedDue"),
  { id: "schedLastResult", kind: "popover", applies: "display", lifetime: "untilRestart" },
  tip("schedLastError"),
  { id: "schedStart", kind: "popover", applies: "onPress", lifetime: "untilStop" },
  { id: "schedStop", kind: "popover", applies: "onPress", lifetime: "untilStop", warning: true },
  { id: "schedRunNow", kind: "popover", applies: "onPress", lifetime: "none", warning: true },

  /* ------------------------------------------------- queue and rate limiter */
  tip("queueState"),
  tip("queueWaiting"),
  tip("queueActive"),
  tip("queueDone"),
  tip("queueFailed"),
  tip("rateCurrent"),
  tip("rateWindow"),
  tip("rateSent"),
  { id: "rateFormula", kind: "popover", applies: "display", lifetime: "none", warning: true },
  { id: "rateMaxEmails", kind: "popover", limit: "rateMaxEmails", unit: "emails", recommended: "range", applies: "nextCycle", lifetime: "untilReset", warning: true },
  { id: "rateInterval", kind: "popover", limit: "rateWindowSeconds", unit: "seconds", recommended: "range", applies: "nextCycle", lifetime: "untilReset" },
  { id: "rateApply", kind: "popover", applies: "nextCycle", lifetime: "untilReset", warning: true },
  { id: "rateReset", kind: "popover", applies: "nextCycle", lifetime: "none" },
  tip("ratePresetQuick"),
  tip("ratePresetVisible"),
  tip("ratePresetLarge"),
  { id: "smtpServer", kind: "popover", applies: "display", lifetime: "untilRestart", warning: true },

  /* ------------------------------------------------ create a test campaign */
  { id: "newName", kind: "popover", unit: "characters", applies: "onCreate", lifetime: "campaign" },
  { id: "newRecipients", kind: "popover", limit: "recipients", unit: "recipients", recommended: "text", applies: "onCreate", lifetime: "campaign", warning: true },
  { id: "newMode", kind: "popover", applies: "onCreate", lifetime: "campaign", warning: true },
  { id: "newDate", kind: "popover", unit: "date", applies: "onCreate", lifetime: "campaign" },
  { id: "newTime", kind: "popover", unit: "time", applies: "onCreate", lifetime: "campaign" },
  { id: "newTimeZone", kind: "popover", unit: "zone", applies: "onCreate", lifetime: "campaign" },
  { id: "newScenario", kind: "popover", applies: "onCreate", lifetime: "campaign", warning: true },
  { id: "newSlowDelay", kind: "popover", limit: "slowDelaySeconds", unit: "seconds", recommended: "range", applies: "onCreate", lifetime: "campaign" },
  { id: "newTempFailures", kind: "popover", limit: "temporaryFailures", unit: "count", recommended: "range", applies: "onCreate", lifetime: "campaign" },
  { id: "newOverdueMinutes", kind: "popover", limit: "overdueMinutes", unit: "minutes", recommended: "range", applies: "onCreate", lifetime: "campaign" },
  tip("tplIn1min"),
  tip("tplIn5min"),
  tip("tplOverdue5min"),
  tip("tplBigRate"),
  tip("tplTempFail"),
  tip("tplPermFail"),
  tip("tplSlowSmtp"),
  { id: "newCreate", kind: "popover", applies: "onPress", lifetime: "campaign", warning: true },

  /* ------------------------------------------------ the selected campaign */
  tip("campSelect"),
  tip("campStatus"),
  tip("campUtc"),
  tip("campLocal"),
  tip("campCounts"),
  { id: "campOpen", kind: "popover", applies: "onPress", lifetime: "none" },
  { id: "campRunCycle", kind: "popover", applies: "onPress", lifetime: "none" },
  { id: "campReschedule", kind: "popover", applies: "onPress", lifetime: "campaign" },
  { id: "campCancel", kind: "popover", applies: "onPress", lifetime: "campaign", warning: true },
  { id: "campQueue", kind: "popover", applies: "onPress", lifetime: "view" },
  { id: "campHistory", kind: "popover", applies: "onPress", lifetime: "view" },
  tip("campRefresh"),
  { id: "campReset", kind: "popover", applies: "onPress", lifetime: "none", warning: true },

  /* ---------------------------------------------------------------- journal */
  { id: "journalEntry", kind: "popover", applies: "display", lifetime: "untilRestart", warning: true },
  tip("journalRefresh"),
  { id: "journalAuto", kind: "popover", applies: "immediately", lifetime: "browser" },
  tip("journalClear"),
  tip("journalLimit"),

  /* ----------------------------------------------------------------- guides */
  tip("guideScenario"),
] as const satisfies readonly HelpEntry[];

export type HelpId = (typeof HELP_ENTRIES)[number]["id"];

const byId = new Map<string, HelpEntry>(HELP_ENTRIES.map((entry) => [entry.id, entry]));

export function helpEntry(id: HelpId): HelpEntry {
  const entry = byId.get(id);
  if (!entry) throw new Error(`No help entry for "${id}".`);
  return entry;
}

export const HELP_IDS: readonly HelpId[] = HELP_ENTRIES.map((entry) => entry.id);
