"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Alert, ScheduledTime, Spinner, StatusBadge, api, formatPercent, useDebounced, useLoader,
} from "@/components/ui";
import CancelScheduledDialog from "@/components/CancelScheduledDialog";
import RescheduleDialog from "@/components/RescheduleDialog";
import { useT } from "@/i18n/client";
import { intlTag } from "@/i18n/locale";
import type { MessageKey } from "@/i18n/translate";
import { describeLocalTimeZone, formatScheduledTime } from "@/lib/scheduling";

type Stats = {
  total: number;
  queued: number;
  sending: number;
  sent: number;
  failed: number;
  suppressed: number;
  cancelled: number;
  uniqueOpens: number;
  totalOpens: number;
  openRate: number;
};

type Campaign = {
  id: string;
  name: string;
  subject: string;
  status: string;
  createdAt: string;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  totalRecipients: number;
};

type Recipient = {
  id: string;
  email: string;
  deliveryStatus: string;
  sentAt: string | null;
  firstOpenedAt: string | null;
  openCount: number;
  attempts: number;
  lastError: string | null;
};

const STATUSES = ["QUEUED", "SENDING", "SENT", "FAILED", "SUPPRESSED", "CANCELLED"];

export default function CampaignReport({
  campaignId, initialStatus, onStatusChange,
}: { campaignId: string; initialStatus: string; onStatusChange: (s: string) => void }) {
  const { t, locale, formatDate } = useT();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const pageSize = 50;
  // A SCHEDULED campaign is polled too, so the page follows it when its time comes.
  const isLive = initialStatus === "SCHEDULED" || initialStatus === "QUEUED" || initialStatus === "SENDING";

  const fetchSummary = useCallback(async () => {
    void tick;
    return api<{ campaign: Campaign; stats: Stats }>(`/api/campaigns/${campaignId}`);
  }, [campaignId, tick]);

  const fetchRecipients = useCallback(async () => {
    void tick;
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (status) params.set("status", status);
    return api<{ recipients: Recipient[]; total: number }>(
      `/api/campaigns/${campaignId}/recipients?${params}`,
    );
  }, [campaignId, page, debouncedSearch, status, tick]);

  const summary = useLoader(fetchSummary);
  const recipientPage = useLoader(fetchRecipients);

  const campaign = summary.data?.campaign ?? null;
  const stats = summary.data?.stats ?? null;
  const rows = recipientPage.data?.recipients ?? null;
  const total = recipientPage.data?.total ?? 0;
  const error = summary.error ?? recipientPage.error;

  // While a campaign is in flight the numbers change under the admin's feet, so
  // poll gently rather than making them reload. Bumping `tick` re-runs both
  // loaders through their memoized identity.
  useEffect(() => {
    if (!isLive) return;
    const timer = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(timer);
  }, [isLive]);

  // Keep the parent's status badge in sync with what the server reports.
  const reportedStatus = campaign?.status;
  useEffect(() => {
    if (reportedStatus) onStatusChange(reportedStatus);
  }, [reportedStatus, onStatusChange]);

  const act = async (action: "pause" | "resume" | "cancel") => {
    if (action === "cancel" && !confirm(t("report.confirmCancel"))) return;
    setBusy(true);
    summary.setError(null);
    try {
      await api(`/api/campaigns/${campaignId}/${action}`, { method: "POST" });
      setTick((t) => t + 1);
    } catch (err) {
      const failed: Record<typeof action, MessageKey> = {
        pause: "report.pauseFailed", resume: "report.resumeFailed", cancel: "cancel.failed",
      };
      summary.setError(err instanceof Error ? err.message : t(failed[action]));
    } finally {
      setBusy(false);
    }
  };

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentStatus = campaign?.status ?? initialStatus;

  return (
    <div className="grid gap-5">
      {error ? <Alert kind="error">{error}</Alert> : null}

      {notice ? <Alert kind="success">{notice}</Alert> : null}

      {currentStatus === "SCHEDULED" && campaign?.scheduledAt ? (
        <Alert kind="info">
          {t("report.scheduled.before")} <strong><ScheduledTime value={campaign.scheduledAt} /></strong>.{" "}
          {t("report.scheduled.after", { zone: describeLocalTimeZone(new Date(campaign.scheduledAt)) })}
        </Alert>
      ) : null}

      <section className="card p-4">
        <p className="text-sm"><span className="hint">{t("report.subject")} </span>{campaign?.subject}</p>
        <div
          className={`mt-2 grid gap-1 text-xs ${campaign?.scheduledAt ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}
          style={{ color: "var(--color-muted)" }}
        >
          <span>{t("report.created", { date: formatDate(campaign?.createdAt) })}</span>
          {campaign?.scheduledAt ? (
            <span>{t("table.scheduledFor")} <ScheduledTime value={campaign.scheduledAt} /></span>
          ) : null}
          <span>{t("report.started", { date: formatDate(campaign?.startedAt) })}</span>
          <span>{t("report.completed", { date: formatDate(campaign?.completedAt) })}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {currentStatus === "SCHEDULED" ? (
            <button className="btn" disabled={busy} onClick={() => { setNotice(null); setRescheduling(true); }}>
              {t("report.reschedule")}
            </button>
          ) : null}
          {currentStatus === "SCHEDULED" ? (
            <button className="btn btn-danger" disabled={busy} onClick={() => { setNotice(null); setCancelling(true); }}>
              {t("report.cancelScheduledSend")}
            </button>
          ) : null}
          {(currentStatus === "QUEUED" || currentStatus === "SENDING") ? (
            <button className="btn" disabled={busy} onClick={() => act("pause")}>{t("report.pause")}</button>
          ) : null}
          {currentStatus === "PAUSED" ? (
            <button className="btn btn-primary" disabled={busy} onClick={() => act("resume")}>{t("report.resume")}</button>
          ) : null}
          {["QUEUED", "SENDING", "PAUSED"].includes(currentStatus) ? (
            <button className="btn btn-danger" disabled={busy} onClick={() => act("cancel")}>{t("report.cancel")}</button>
          ) : null}
          {(stats?.failed ?? 0) > 0 ? (
            <a className="btn" href={`/api/campaigns/${campaignId}/failures`}>{t("report.exportFailures")}</a>
          ) : null}
        </div>
      </section>

      {rescheduling && campaign ? (
        <RescheduleDialog
          campaign={{ id: campaign.id, name: campaign.name, scheduledAt: campaign.scheduledAt }}
          onClose={() => setRescheduling(false)}
          onStale={() => setTick((t) => t + 1)}
          onRescheduled={({ name, scheduledAt }) => {
            setRescheduling(false);
            setNotice(t("reschedule.notice", {
              name, when: formatScheduledTime(scheduledAt, { locale: intlTag(locale) }) ?? "",
            }));
            // Show the stored time at once (here and in the banner above); the refetch brings the rest.
            summary.setData((current) => current && { ...current, campaign: { ...current.campaign, scheduledAt } });
            setTick((t) => t + 1);
          }}
        />
      ) : null}

      {cancelling && campaign ? (
        <CancelScheduledDialog
          campaign={{ id: campaign.id, name: campaign.name, scheduledAt: campaign.scheduledAt }}
          onClose={() => setCancelling(false)}
          onStale={() => setTick((t) => t + 1)}
          onCancelled={({ name, alreadyCancelled }) => {
            setCancelling(false);
            setNotice(t(alreadyCancelled ? "campaigns.alreadyCancelledNotice" : "campaigns.cancelledNotice", { name }));
            setTick((t) => t + 1);
          }}
        />
      ) : null}

      {stats === null ? (
        <Spinner />
      ) : (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Card label={t("report.card.recipients")} value={stats.total} />
          <Card label={t("report.card.sent")} value={stats.sent} />
          <Card label={t("report.card.pending")} value={stats.queued + stats.sending} />
          <Card label={t("report.card.failed")} value={stats.failed} />
          <Card label={t("report.card.opened")} value={stats.uniqueOpens}
            hint={t("report.card.totalOpens", { count: stats.totalOpens })} />
          <Card label={t("report.card.uniqueOpenRate")} value={formatPercent(stats.openRate, locale)}
            hint={t("report.card.ofSent")} />
        </section>
      )}

      {stats && (stats.suppressed > 0 || stats.cancelled > 0) ? (
        <p className="hint">
          {stats.suppressed > 0 ? `${t("report.suppressedNote", { count: stats.suppressed })} ` : ""}
          {stats.cancelled > 0 ? t("report.cancelledNote", { count: stats.cancelled }) : ""}
        </p>
      ) : null}

      <section className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <input className="input max-w-xs" placeholder={t("report.searchPlaceholder")} value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            aria-label={t("report.searchLabel")} />
          <select className="input max-w-40" value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            aria-label={t("report.filterLabel")}>
            <option value="">{t("report.allStatuses")}</option>
            {STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}` as MessageKey)}</option>)}
          </select>
          <span className="hint ml-auto tabular-nums">{t("report.rows", { count: total })}</span>
        </div>

        {rows === null ? (
          <Spinner />
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left" style={{ color: "var(--color-muted)" }}>
                  <th className="px-3 py-2 font-medium">{t("report.col.email")}</th>
                  <th className="px-3 py-2 font-medium">{t("report.col.delivery")}</th>
                  <th className="px-3 py-2 font-medium">{t("report.col.sentAt")}</th>
                  <th className="px-3 py-2 font-medium">{t("report.col.opened")}</th>
                  <th className="px-3 py-2 font-medium">{t("report.col.firstOpened")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("report.col.attempts")}</th>
                  <th className="px-3 py-2 font-medium">{t("report.col.lastError")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="px-3 py-2 break-all">{row.email}</td>
                    <td className="px-3 py-2"><StatusBadge status={row.deliveryStatus} /></td>
                    <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--color-muted)" }}>
                      {formatDate(row.sentAt)}
                    </td>
                    <td className="px-3 py-2">{row.firstOpenedAt ? t("report.yes", { count: row.openCount }) : "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--color-muted)" }}>
                      {formatDate(row.firstOpenedAt)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.attempts}</td>
                    <td className="max-w-xs px-3 py-2 text-xs" style={{ color: "var(--color-muted)" }}>
                      {row.lastError ?? "—"}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr><td className="px-3 py-6 text-center hint" colSpan={7}>{t("report.noMatching")}</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}

        {pageCount > 1 ? (
          <div className="flex items-center justify-between">
            <button className="btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{t("report.previous")}</button>
            <span className="hint">{t("report.page", { page, pages: pageCount })}</span>
            <button className="btn" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>{t("report.next")}</button>
          </div>
        ) : null}
      </section>

      <p className="hint">{t("report.opensExplanation")}</p>
    </div>
  );
}

function Card({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="card px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-muted)" }}>{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="hint mt-0.5">{hint}</p> : null}
    </div>
  );
}
