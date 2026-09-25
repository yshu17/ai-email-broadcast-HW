"use client";

import { useCallback, useId, useState } from "react";
import { ScheduledTime, StatusBadge, useLoader } from "@/components/ui";
import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n/translate";
import { panelApi, type CampaignDetails } from "./api";
import HelpIcon from "./HelpIcon";
import { usePanel } from "./panel-context";
import { ActionButton, ActionLink, Field, Metric, MetricList, Notice, helpProps, useClockFormat } from "./panel-ui";
import { cycleNotice, describeEvent } from "./events";

/**
 * "Test campaigns": the campaigns this panel created, and what can be done to the selected one.
 * Every action is an ordinary one (the same cycle, the same change-time form, the same cancel);
 * the panel adds no way to change a status directly.
 */
export default function CampaignsSection() {
  const { t } = useT();
  const panel = usePanel();
  const { snapshot, run, busy, selectedId } = panel;
  const id = useId();
  const format = useClockFormat();

  const campaigns = snapshot?.campaigns ?? [];
  // With no (or a vanished) selection, the newest campaign is the one in front of the person.
  const selected = campaigns.find((campaign) => campaign.id === selectedId) ?? campaigns[0] ?? null;

  const [showQueue, setShowQueue] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // The details are read only while they are on show, and again whenever the panel refreshes.
  const shownId = selected?.id ?? null;
  const onShow = showQueue || showHistory;
  const fetchDetails = useCallback(async (): Promise<CampaignDetails | null> => {
    if (!onShow || !shownId) return null;
    return panelApi.campaign(shownId);
  }, [onShow, shownId, snapshot?.serverTime]); // eslint-disable-line react-hooks/exhaustive-deps -- a new snapshot means "read again"
  const detailsLoader = useLoader(fetchDetails);
  // What is on screen is only ever the selected campaign's, and only while it is on show.
  const shownDetails = onShow && detailsLoader.data?.campaign.id === shownId ? detailsLoader.data : null;
  const detailsError = onShow ? detailsLoader.error : null;

  const refresh = async () => {
    await panel.refresh();
    detailsLoader.reload();
  };

  return (
    <>
      {campaigns.length === 0 ? (
        <p className="hint">{t("tp.campaigns.none")}</p>
      ) : (
        <Field helpId="campSelect" htmlFor={`${id}-select`} label={t("tp.campaigns.select")}>
          <select id={`${id}-select`} className="input" value={selected?.id ?? ""} onChange={(e) => panel.selectCampaign(e.target.value)} {...helpProps("campSelect")}>
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>{campaign.name} · {t(`status.${campaign.status}` as MessageKey)}</option>
            ))}
          </select>
        </Field>
      )}

      {selected ? (
        <>
          <MetricList>
            <Metric helpId="campStatus" label={t("tp.campaigns.status")} tour="campaign-status">
              <StatusBadge status={selected.status} />
            </Metric>
            <Metric helpId="campUtc" label={t("tp.campaigns.utc")}>
              <span className="break-all">{selected.scheduledAt ?? "—"}</span>
            </Metric>
            <Metric helpId="campLocal" label={t("tp.campaigns.local")}>
              {selected.scheduledAt ? <ScheduledTime value={selected.scheduledAt} /> : "—"}
            </Metric>
            <Metric helpId="campCounts" label={t("tp.campaigns.counts")}>
              {t("tp.campaigns.countsValue", { queued: selected.queued, sending: selected.sending, sent: selected.sent, failed: selected.failed })}
            </Metric>
          </MetricList>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <ActionLink helpId="campOpen" href={`/campaigns/${selected.id}`}>{t("tp.campaigns.open")}</ActionLink>
            <ActionButton helpId="campRunCycle" disabled={busy !== null} busy={busy === "sched.run"}
              onClick={() => void run("sched.run", () => panelApi.scheduler({ action: "run" }), { notice: (answer) => cycleNotice(t, answer) })}>
              {t("tp.campaigns.runCycle")}
            </ActionButton>
            <ActionButton helpId="campReschedule" disabled={selected.status !== "SCHEDULED" || busy !== null}
              onClick={() => panel.requestReschedule({ id: selected.id, name: selected.name, scheduledAt: selected.scheduledAt })}>
              {t("tp.campaigns.reschedule")}
            </ActionButton>
            <ActionButton helpId="campCancel" danger disabled={selected.status !== "SCHEDULED" || busy !== null}
              onClick={() => panel.requestCancel({ id: selected.id, name: selected.name, scheduledAt: selected.scheduledAt })}>
              {t("tp.campaigns.cancel")}
            </ActionButton>
            <ActionButton helpId="campQueue" onClick={() => setShowQueue((open) => !open)}>
              {t(showQueue ? "tp.campaigns.hideQueue" : "tp.campaigns.showQueue")}
            </ActionButton>
            <ActionButton helpId="campHistory" onClick={() => setShowHistory((open) => !open)}>
              {t(showHistory ? "tp.campaigns.hideHistory" : "tp.campaigns.showHistory")}
            </ActionButton>
            <span className="inline-flex items-center">
              <button type="button" className="btn px-2.5 py-1 text-xs" disabled={busy !== null} onClick={() => void refresh()} {...helpProps("campRefresh")}>
                {t("tp.campaigns.refresh")}
              </button>
              <HelpIcon id="campRefresh" />
            </span>
            <ActionButton helpId="campReset" danger disabled={busy !== null} onClick={() => panel.requestReset({ id: selected.id, name: selected.name })}>
              {t("tp.campaigns.reset")}
            </ActionButton>
          </div>

          {detailsError ? <Notice kind="error">{detailsError}</Notice> : null}

          {showQueue && shownDetails ? (
            <div className="overflow-x-auto rounded-md border" data-testid="queue-rows">
              <table className="w-full text-xs">
                <caption className="sr-only">{t("tp.campaigns.queueCaption")}</caption>
                <thead>
                  <tr className="border-b text-left" style={{ color: "var(--color-muted)" }}>
                    <th scope="col" className="px-2 py-1 font-medium">{t("tp.queueRows.address")}</th>
                    <th scope="col" className="px-2 py-1 font-medium">{t("tp.queueRows.status")}</th>
                    <th scope="col" className="px-2 py-1 text-right font-medium">{t("tp.queueRows.attempts")}</th>
                    <th scope="col" className="px-2 py-1 font-medium">{t("tp.queueRows.next")}</th>
                    <th scope="col" className="px-2 py-1 font-medium">{t("tp.queueRows.error")}</th>
                  </tr>
                </thead>
                <tbody>
                  {shownDetails.queue.length === 0 ? (
                    <tr><td className="px-2 py-2" colSpan={5}>{t("tp.queueRows.empty")}</td></tr>
                  ) : shownDetails.queue.map((row) => (
                    <tr key={row.email} className="border-b last:border-0">
                      <td className="break-all px-2 py-1">{row.email}</td>
                      <td className="px-2 py-1"><StatusBadge status={row.status} /></td>
                      <td className="px-2 py-1 text-right tabular-nums">{row.attempts}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{row.status === "QUEUED" && row.attempts > 0 ? format(row.nextAttemptAt) : "—"}</td>
                      <td className="px-2 py-1 break-words">{row.lastError ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {showHistory && shownDetails ? (
            <ol className="grid gap-1 text-xs" data-testid="status-history" aria-label={t("tp.campaigns.historyCaption")}>
              {shownDetails.history.map((item, index) => (
                <li key={`${item.at}-${index}`} className="flex flex-wrap gap-x-2">
                  <span className="tabular-nums" style={{ color: "var(--color-muted)" }}>{format(item.at)}</span>
                  <span>{describeEvent(item, t, { name: selected.name, when: format })}</span>
                </li>
              ))}
            </ol>
          ) : null}
        </>
      ) : null}
    </>
  );
}
