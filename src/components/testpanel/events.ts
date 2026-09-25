import type { Translator } from "@/i18n/client";
import { hasMessage, type MessageKey, type Params } from "@/i18n/translate";
import type { SchedulerAnswer } from "./api";

/**
 * Words for what the journal and a campaign's history report. The events carry a machine name
 * (`campaign.activated`) with identifiers and counts, never text: what they say is the
 * dictionary's (`tp.event.<name>`), in the language on screen.
 */
export type EventLike = {
  type: string;
  from?: string;
  to?: string;
  campaignId?: string;
  data?: Record<string, string | number | boolean | null>;
};

export type DescribeContext = {
  /** The campaign's name, when the panel knows it; otherwise the start of its id is used. */
  name?: string;
  /** A stored instant in the viewer's zone. */
  when: (iso: string) => string;
};

const status = (t: Translator["t"], value?: string) => (value && hasMessage(`status.${value}`) ? t(`status.${value}` as MessageKey) : (value ?? ""));

export function describeEvent(event: EventLike, t: Translator["t"], context: DescribeContext): string {
  const data = event.data ?? {};
  let type = event.type;
  // A cancellation is worded by why it happened.
  if (type === "campaign.cancelled" && typeof data.reason === "string") type = `${type}.${data.reason}`;

  const key = `tp.event.${type}`;
  if (!hasMessage(key)) return t("tp.event.unknown", { type: event.type });

  const params: Record<string, string | number> = {
    name: context.name ?? (event.campaignId ? event.campaignId.slice(0, 8) : ""),
    from: status(t, event.from),
    to: status(t, event.to),
  };
  for (const [name, value] of Object.entries(data)) {
    if (typeof value === "number" || typeof value === "string") params[name] = value;
  }
  // Instants are shown as the viewer's own time.
  for (const name of ["scheduledAt", "effectiveNow"]) {
    const value = data[name];
    if (typeof value === "string") params.when = context.when(value);
  }
  if (typeof data.scenario === "string" && hasMessage(`tp.scenario.${data.scenario}`)) {
    params.scenario = t(`tp.scenario.${data.scenario}` as MessageKey);
  }
  if (typeof data.trigger === "string" && hasMessage(`tp.trigger.${data.trigger}`)) {
    params.trigger = t(`tp.trigger.${data.trigger}` as MessageKey);
  }
  return t(key as MessageKey, params as Params);
}

/** What pressing Run now (or a cycle button) reported, as a sentence. */
export function cycleNotice(t: Translator["t"], answer: SchedulerAnswer): string {
  if (!("ran" in answer)) return "";
  if (!answer.ran) return t("tp.sched.runBusy");
  if (answer.report?.error) return t("tp.sched.runFailed");
  return t("tp.sched.runDone", {
    due: answer.report?.result?.dueCampaigns ?? 0,
    started: answer.report?.result?.activatedCampaigns ?? 0,
  });
}
