"use client";

import { useRef, useState } from "react";
import { Alert, ApiError, Modal, ScheduledTime, api } from "@/components/ui";
import ScheduleFields, { type SchedulePlan } from "@/components/ScheduleFields";
import { getActiveLocale } from "@/i18n/active";
import { useT } from "@/i18n/client";
import { translate } from "@/i18n/translate";
import { describeLocalTimeZone, scheduleFieldsFor, toScheduledAt, type ScheduleResult } from "@/lib/scheduling";

export type RescheduleTarget = { id: string; name: string; scheduledAt: string | null };

export type RescheduleOutcome =
  /** `scheduledAt`: the time the server stored, as a UTC instant; it is the one to show. */
  | { ok: true; scheduledAt: string }
  /**
   * `stale`: the campaign is no longer in the state the page believed (it started, or is gone), so
   * the page should refresh. `scheduleRule`: the server refused the time itself, so the message
   * belongs next to the fields.
   */
  | { ok: false; stale: boolean; scheduleRule: boolean; message: string };

/**
 * Asks the server to move a scheduled campaign to `scheduledAt`. Never throws: every
 * failure comes back as a message for the person to read, exactly as the server worded it.
 */
export async function requestReschedule(campaignId: string, scheduledAt: Date): Promise<RescheduleOutcome> {
  try {
    const result = await api<{ scheduledAt?: string }>(`/api/campaigns/${campaignId}/schedule`, {
      method: "PATCH",
      body: JSON.stringify({ scheduledAt: scheduledAt.toISOString() }),
    });
    return { ok: true, scheduledAt: result.scheduledAt ?? scheduledAt.toISOString() };
  } catch (error) {
    if (error instanceof ApiError) {
      return {
        ok: false,
        // 409: it started (or is about to) while the page was open. 404: it is gone.
        stale: error.status === 409 || error.status === 404,
        scheduleRule: error.code?.startsWith("SCHEDULE_") === true,
        message: error.message,
      };
    }
    return {
      ok: false,
      stale: false,
      scheduleRule: false,
      message: error instanceof Error ? error.message : translate(getActiveLocale(), "reschedule.failed"),
    };
  }
}

export type RescheduleAttempt =
  /** The typed time is not one that can be saved (missing, not real, skipped or repeated by the clocks, or not in the future). Nothing was sent. */
  | { status: "invalid"; failure: Extract<ScheduleResult, { ok: false }> }
  /** A save is already running; this press changed nothing. */
  | { status: "busy" }
  | { status: "saved"; scheduledAt: string }
  | { status: "failed"; stale: boolean; scheduleRule: boolean; message: string };

/**
 * What pressing "Save" does, apart from drawing anything.
 *
 *  1. If a save is already running (`inFlight`), do nothing: two presses, however close
 *     together, make one request. The flag is a ref, not state, because state changes
 *     are not visible until the next render and a fast second press would slip through.
 *  2. Read the fields as the person's wall-clock time in their zone and check it against
 *     the clock *now*, not the one from when the form was opened: a minute that was ahead
 *     then may be behind by the time they press. A time that is not in the future never
 *     leaves the browser (the server checks again with its own clock).
 *  3. Send the one unambiguous instant. The zone is applied here, once, and never again:
 *     the server gets a UTC instant and hands one back.
 *
 * It never changes `plan`: what the person typed stays theirs to correct and send again.
 */
export async function attemptReschedule({
  campaignId, plan, timeZone, now, inFlight,
}: {
  campaignId: string;
  plan: SchedulePlan;
  timeZone?: string;
  now?: Date;
  inFlight: { current: boolean };
}): Promise<RescheduleAttempt> {
  if (inFlight.current) return { status: "busy" };

  const check = toScheduledAt(plan.date, plan.time, now ?? new Date(), { timeZone, occurrence: plan.occurrence });
  if (!check.ok) return { status: "invalid", failure: check };

  inFlight.current = true;
  try {
    const outcome = await requestReschedule(campaignId, check.date);
    if (outcome.ok) return { status: "saved", scheduledAt: outcome.scheduledAt };
    return { status: "failed", stale: outcome.stale, scheduleRule: outcome.scheduleRule, message: outcome.message };
  } finally {
    inFlight.current = false;
  }
}

/**
 * The "Change time" form for a scheduled campaign, used by the campaign list and by the
 * campaign's own page so both behave identically.
 *
 * It opens on the time the campaign has now, in the person's zone, and shows that zone.
 * While a save runs, both buttons are disabled and the dialog cannot be dismissed; if it
 * fails, the message is shown, what was typed stays as it was, and Save works again. On
 * success the caller is told the stored time, so whatever shows it can update at once.
 *
 * Mount it only while there is something to change: each mount starts with a clean slate.
 * `timeZone` and `now` default to the browser's zone and clock; they exist so tests can pin them.
 */
export default function RescheduleDialog({
  campaign, onClose, onRescheduled, onStale, locale, timeZone, now,
}: {
  campaign: RescheduleTarget;
  onClose: () => void;
  onRescheduled: (result: { id: string; name: string; scheduledAt: string }) => void;
  /** The campaign turned out not to be scheduled any more: refresh whatever shows it. */
  onStale: () => void;
  /** Pin the date display (a BCP 47 tag) for tests; the browser's is used otherwise. */
  locale?: string;
  timeZone?: string;
  now?: Date;
}) {
  const { t } = useT();
  const current = campaign.scheduledAt ? new Date(campaign.scheduledAt) : null;
  const currentTime = current && !Number.isNaN(current.getTime()) ? current : null;

  const [plan, setPlan] = useState<SchedulePlan>(() =>
    currentTime ? scheduleFieldsFor(currentTime, timeZone) : { date: "", time: "" });
  // Errors about the typed time appear once the person has tried to save.
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ruleError, setRuleError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const change = (patch: Partial<SchedulePlan>) => {
    setRuleError(null);
    setPlan((previous) => ({ ...previous, ...patch }));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setRuleError(null);
    setBusy(true);

    const result = await attemptReschedule({ campaignId: campaign.id, plan, timeZone, now, inFlight });

    // Another press while the first save runs: the first one will report.
    if (result.status === "busy") return;
    setBusy(false);
    switch (result.status) {
      case "invalid":
        setAttempted(true);
        return;
      case "saved":
        onRescheduled({ id: campaign.id, name: campaign.name, scheduledAt: result.scheduledAt });
        return;
      case "failed":
        if (result.scheduleRule) setRuleError(result.message);
        else setError(result.message);
        if (result.stale) onStale();
        return;
    }
  };

  const close = () => {
    if (!inFlight.current) onClose();
  };

  return (
    <Modal open title={t("reschedule.title")} onClose={close}>
      <form onSubmit={submit} noValidate className="grid gap-3 text-sm">
        <p><strong>{campaign.name}</strong></p>
        {currentTime ? (
          <>
            <p>
              {t("reschedule.current")}{" "}
              <strong><ScheduledTime value={campaign.scheduledAt} locale={locale} timeZone={timeZone} /></strong>
            </p>
            <p className="hint">{t("reschedule.timeZone", { zone: describeLocalTimeZone(currentTime, timeZone) })}</p>
          </>
        ) : null}
        <ScheduleFields
          plan={plan} onChange={change} attempted={attempted} serverError={ruleError}
          idPrefix="reschedule" timeZone={timeZone} now={now} autoFocusDate
        />
        {error ? <Alert kind="error">{error}</Alert> : null}
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" type="submit" disabled={busy} aria-busy={busy}>
            {busy ? t("reschedule.saving") : t("common.save")}
          </button>
          <button className="btn" type="button" onClick={close} disabled={busy}>{t("common.cancel")}</button>
        </div>
      </form>
    </Modal>
  );
}
