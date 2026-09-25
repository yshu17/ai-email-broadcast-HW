"use client";

import { useT, type Translator } from "@/i18n/client";
import { intlTag } from "@/i18n/locale";
import type { MessageKey } from "@/i18n/translate";
import {
  describeLocalTimeZone, formatLocalDate, formatScheduledTime, minimumTimeFor, toScheduledAt,
  type Occurrence, type ScheduleResult,
} from "@/lib/scheduling";

/** What the person has typed: a wall-clock date and time, and which repeated time is meant, if it was asked. */
export type SchedulePlan = { date: string; time: string; occurrence?: Occurrence };

/** The wording for a client-side schedule check, by its code and the field it belongs to. */
export function scheduleMessage(t: Translator["t"], result: Extract<ScheduleResult, { ok: false }>): string {
  switch (result.code) {
    case "SCHEDULE_REQUIRED":
      return t(`schedule.required.${result.field === "date" || result.field === "time" ? result.field : "both"}` as MessageKey);
    case "SCHEDULE_INVALID":
      return t(result.field === "time" ? "schedule.invalid.time" : "schedule.invalid.date");
    case "SCHEDULE_NONEXISTENT":
      return t("schedule.nonexistent");
    case "SCHEDULE_AMBIGUOUS":
      return t("schedule.ambiguous");
    default:
      return t("schedule.past");
  }
}

/**
 * The date and time inputs for choosing when a campaign starts, with the rules
 * that steer the person (nothing earlier than today or than the next minute), the
 * way a wrong entry is explained next to the field it belongs to, and the question
 * "which of the two?" for a time that clocks going back repeat.
 *
 * It is the one place these fields are drawn: the wizard uses it to schedule a
 * campaign for the first time and the "change time" form uses it to move a schedule,
 * so both read, check and explain the time in exactly the same way. It only draws:
 * turning the fields into an instant is `toScheduledAt`, and what to do with it
 * is the caller's.
 *
 *  - `attempted`: the person has tried to go on, so "required" and "invalid" are shown
 *    even for a field they have not touched. A time that is already in the past is
 *    shown as soon as both fields are filled in.
 *  - `serverError`: a schedule rule the server refused (it judges by its own clock).
 *  - `idPrefix` keeps ids unique when two of these are on one page.
 */
export default function ScheduleFields({
  plan, onChange, attempted, serverError = null, idPrefix = "schedule", timeZone, now, autoFocusDate = false,
}: {
  plan: SchedulePlan;
  onChange: (patch: Partial<SchedulePlan>) => void;
  attempted: boolean;
  serverError?: string | null;
  idPrefix?: string;
  /** The zone the person's times are read in; the browser's unless a test pins it. */
  timeZone?: string;
  /** The clock; the real one unless a test pins it. */
  now?: Date;
  autoFocusDate?: boolean;
}) {
  const { t, locale } = useT();
  const clock = now ?? new Date();

  const check = toScheduledAt(plan.date, plan.time, clock, { timeZone, occurrence: plan.occurrence });
  const failure = !check.ok ? check : null;
  const revealed = attempted || (plan.date !== "" && plan.time !== "");
  const shown = revealed ? failure : null;
  const dateError = shown?.field === "date" ? scheduleMessage(t, shown) : null;
  const timeError = shown?.field === "time" ? scheduleMessage(t, shown) : null;
  const groupError = (shown?.field === "both" ? scheduleMessage(t, shown) : null) ?? serverError;
  const dateInvalid = shown?.field === "date" || shown?.field === "both" || serverError !== null;
  const timeInvalid = shown?.field === "time" || shown?.field === "both" || serverError !== null;
  const zone = describeLocalTimeZone(check.ok ? check.date : clock, timeZone);

  // Only when the time is repeated by clocks going back: which of the two is meant.
  // Read without the person's pick, so both stay on offer (and changeable) after choosing.
  const unpicked = revealed ? toScheduledAt(plan.date, plan.time, clock, { timeZone }) : null;
  const choices = unpicked && !unpicked.ok && unpicked.code === "SCHEDULE_AMBIGUOUS" ? (unpicked.choices ?? []) : [];

  const dateId = `${idPrefix}Date`;
  const timeId = `${idPrefix}Time`;
  const helpId = `${idPrefix}Help`;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <label className="label" htmlFor={dateId}>{t("wizard.send.date")}</label>
        <input id={dateId} className="input" type="date" required
          min={formatLocalDate(clock, timeZone)} value={plan.date}
          aria-invalid={dateInvalid}
          aria-describedby={dateError ? `${dateId}Error` : helpId}
          {...(autoFocusDate ? { "data-autofocus": true } : {})}
          onChange={(e) => onChange({ date: e.target.value, occurrence: undefined })} />
        {dateError ? (
          <p id={`${dateId}Error`} className="mt-1 text-sm text-red-700 dark:text-red-400" role="alert">
            {dateError}
          </p>
        ) : null}
      </div>
      <div>
        <label className="label" htmlFor={timeId}>{t("wizard.send.time")}</label>
        <input id={timeId} className="input" type="time" required
          min={minimumTimeFor(plan.date, clock, timeZone)} value={plan.time}
          aria-invalid={timeInvalid}
          aria-describedby={timeError ? `${timeId}Error` : helpId}
          onChange={(e) => onChange({ time: e.target.value, occurrence: undefined })} />
        {timeError ? (
          <p id={`${timeId}Error`} className="mt-1 text-sm text-red-700 dark:text-red-400" role="alert">
            {timeError}
          </p>
        ) : null}
      </div>
      {choices.length > 0 ? (
        <fieldset className="sm:col-span-2">
          <legend className="label">{t("wizard.send.whichTime", { time: plan.time })}</legend>
          <div className="grid gap-2">
            {choices.map((choice) => (
              <label key={choice.occurrence} className="flex items-center gap-2 text-sm">
                <input type="radio" name="scheduleOccurrence" value={choice.occurrence}
                  checked={plan.occurrence === choice.occurrence}
                  onChange={() => onChange({ occurrence: choice.occurrence })} />
                {formatScheduledTime(choice.date, { locale: intlTag(locale), timeZone })}
                <span className="hint">
                  ({t(choice.occurrence === "first" ? "wizard.send.first" : "wizard.send.second")})
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      {groupError ? (
        <p className="text-sm text-red-700 sm:col-span-2 dark:text-red-400" role="alert">{groupError}</p>
      ) : null}
      <p id={helpId} className="hint sm:col-span-2">{t("wizard.send.timeZoneHelp", { zone })}</p>
    </div>
  );
}
