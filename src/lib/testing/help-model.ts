import { hasMessage, translate, type MessageKey, type Params } from "../../i18n/translate";
import type { Locale } from "../../i18n/locale";
import { helpEntry, type HelpEntry, type HelpId } from "./help";
import { TEST_LIMITS } from "./limits";
import { RATE_PRESETS, TEST_TEMPLATES } from "./templates";

/**
 * Turns a registry entry into the text a person reads: the title, a one-line summary, and (for a
 * popover) its labelled sections. It is pure, so the panel, the tests and the documentation all
 * get exactly the same words and numbers from it.
 *
 * Every number comes from `TEST_LIMITS`, `TEST_TEMPLATES` or `RATE_PRESETS`: the objects the
 * server and the forms validate and fill from. The dictionary only has placeholders for them.
 */
type Range = { readonly min: number; readonly max: number };

/** The numbers an entry's texts may use, by placeholder name. */
export function helpParams(id: HelpId): Params {
  const entry = helpEntry(id);
  const params: Record<string, string | number> = {
    yearMin: TEST_LIMITS.clockYear.min,
    yearMax: TEST_LIMITS.clockYear.max,
    nameMax: TEST_LIMITS.campaignNameLength.max,
    show: TEST_LIMITS.eventLog.show,
    keep: TEST_LIMITS.eventLog.keep,
  };

  if (entry.limit) {
    const limit = TEST_LIMITS[entry.limit] as Range & { recommended?: Range; longRun?: Range; rateCheck?: Range };
    params.min = limit.min;
    params.max = limit.max;
    if (limit.recommended) { params.recMin = limit.recommended.min; params.recMax = limit.recommended.max; }
    if (limit.longRun) { params.longMin = limit.longRun.min; params.longMax = limit.longRun.max; }
    if (limit.rateCheck) { params.rateMin = limit.rateCheck.min; params.rateMax = limit.rateCheck.max; }
  }

  // A template's own numbers: `tplIn1min` -> the template `in1min`.
  const template = TEST_TEMPLATES.find((t) => `tpl${t.id[0].toUpperCase()}${t.id.slice(1)}` === id);
  if (template) {
    params.recipients = template.recipients;
    params.minutes = template.offsetMinutes ?? template.overdueMinutes ?? 0;
    params.failures = template.temporaryFailures ?? 0;
    params.delay = template.slowDelaySeconds ?? 0;
  }

  const preset = RATE_PRESETS.find((p) => `ratePreset${p.id[0].toUpperCase()}${p.id.slice(1)}` === id);
  if (preset) {
    params.maxEmails = preset.maxEmails;
    params.windowSeconds = preset.windowSeconds;
  }
  return params;
}

export type HelpSection = { key: "what" | "impact" | "unit" | "range" | "recommended" | "applies" | "lifetime" | "warning"; label: string; text: string };

export type HelpModel = {
  id: HelpId;
  kind: HelpEntry["kind"];
  title: string;
  /** One line for a screen reader (`aria-describedby`): the tip, or what the element is. */
  summary: string;
  /** Empty for a tooltip. */
  sections: HelpSection[];
};

export function helpModel(id: HelpId, locale: Locale): HelpModel {
  const entry = helpEntry(id);
  const params = helpParams(id);
  const t = (key: string, extra?: Params) => translate(locale, key as MessageKey, { ...params, ...extra });

  const title = t(`help.${id}.title`);
  if (entry.kind === "tooltip") {
    const tipText = t(`help.${id}.tip`);
    return { id, kind: "tooltip", title, summary: tipText, sections: [] };
  }

  const sections: HelpSection[] = [];
  const add = (key: HelpSection["key"], text: string) => sections.push({ key, label: t(`help.section.${key}`), text });

  add("what", t(`help.${id}.what`));
  add("impact", t(`help.${id}.impact`));
  if (entry.unit) add("unit", t(`help.unit.${entry.unit}`));

  const unit = entry.unit ? t(`help.unit.${entry.unit}`) : "";
  if (entry.limit) add("range", t("help.range", { unit }));

  if (hasMessage(`help.${id}.recommended`)) add("recommended", t(`help.${id}.recommended`));
  else if (entry.recommended === "range") add("recommended", t("help.recommended.range", { unit }));
  else if (entry.recommended === "two") add("recommended", t("help.recommended.two", { unit }));

  if (entry.applies) add("applies", t(`help.applies.${entry.applies}`));
  if (entry.lifetime) add("lifetime", t(`help.lifetime.${entry.lifetime}`));
  if (entry.warning) add("warning", t(`help.${id}.warning`));

  return { id, kind: "popover", title, summary: sections[0].text, sections };
}
