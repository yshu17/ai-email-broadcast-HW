"use client";

import { useRef, useState } from "react";
import { Alert, ApiError, Modal, ScheduledTime, api } from "@/components/ui";
import { getActiveLocale } from "@/i18n/active";
import { useT } from "@/i18n/client";
import { translate } from "@/i18n/translate";
import { describeLocalTimeZone } from "@/lib/scheduling";

export type CancelTarget = { id: string; name: string; scheduledAt: string | null };

export type CancelOutcome =
  | { ok: true; alreadyCancelled: boolean }
  /** `stale`: the campaign is no longer in the state the page believed, so the page should refresh. */
  | { ok: false; stale: boolean; message: string };

/**
 * Asks the server to cancel a scheduled campaign. Never throws: every failure
 * comes back as a message for the person to read, exactly as the server worded it.
 */
export async function requestCancelScheduled(campaignId: string): Promise<CancelOutcome> {
  try {
    const result = await api<{ alreadyCancelled?: boolean }>(
      `/api/campaigns/${campaignId}/cancel-scheduled`,
      { method: "POST" },
    );
    return { ok: true, alreadyCancelled: result.alreadyCancelled === true };
  } catch (error) {
    if (error instanceof ApiError) {
      // 409: it started (or was never scheduled) while the page was open. 404: it is gone.
      return { ok: false, stale: error.status === 409 || error.status === 404, message: error.message };
    }
    return {
      ok: false,
      stale: false,
      message: error instanceof Error ? error.message : translate(getActiveLocale(), "cancel.failed"),
    };
  }
}

/**
 * Confirms, then cancels, a scheduled campaign. Used by the campaign list and by
 * the campaign's own page, so both behave identically.
 *
 * Mount it only while there is something to cancel: each mount starts with a clean
 * slate (no stale error, no leftover "busy"). While the request runs the buttons
 * are disabled and the dialog cannot be dismissed, so it cannot be sent twice;
 * if it fails, the server's message is shown and the button works again.
 */
export default function CancelScheduledDialog({
  campaign, onClose, onCancelled, onStale, locale, timeZone,
}: {
  campaign: CancelTarget;
  onClose: () => void;
  onCancelled: (result: { id: string; name: string; alreadyCancelled: boolean }) => void;
  /** The campaign turned out not to be scheduled any more: refresh whatever shows it. */
  onStale: () => void;
  /** Pin the date display (a BCP 47 tag) for tests; the browser's is used otherwise. */
  locale?: string;
  timeZone?: string;
}) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // State updates are asynchronous; a second click in the same instant would
  // otherwise slip through before `busy` has been re-rendered.
  const inFlight = useRef(false);

  const confirm = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);

    const outcome = await requestCancelScheduled(campaign.id);

    inFlight.current = false;
    setBusy(false);
    if (outcome.ok) {
      onCancelled({ id: campaign.id, name: campaign.name, alreadyCancelled: outcome.alreadyCancelled });
      return;
    }
    setError(outcome.message);
    if (outcome.stale) onStale();
  };

  const close = () => {
    if (!inFlight.current) onClose();
  };

  const due = campaign.scheduledAt ? new Date(campaign.scheduledAt) : null;

  return (
    <Modal open title={t("cancel.title")} onClose={close}>
      <div className="grid gap-3 text-sm">
        <p>
          <strong>{campaign.name}</strong> {t(due ? "cancel.intro.withTime" : "cancel.intro.noTime")}
          {due ? <> <strong><ScheduledTime value={campaign.scheduledAt} locale={locale} timeZone={timeZone} /></strong></> : null}.
        </p>
        {due && !Number.isNaN(due.getTime()) ? (
          <p className="hint">{t("cancel.timeZone", { zone: describeLocalTimeZone(due, timeZone) })}</p>
        ) : null}
        <p>{t("cancel.consequence")}</p>
        {error ? <Alert kind="error">{error}</Alert> : null}
        <div className="flex flex-wrap gap-2">
          <button className="btn" data-autofocus onClick={close} disabled={busy}>{t("cancel.keep")}</button>
          <button className="btn btn-danger" onClick={confirm} disabled={busy} aria-busy={busy}>
            {busy ? t("cancel.confirming") : t("cancel.confirm")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
