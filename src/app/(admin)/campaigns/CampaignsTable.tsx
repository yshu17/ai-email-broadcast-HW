"use client";

import Link from "next/link";
import { ScheduledTime, StatusBadge } from "@/components/ui";
import { useT } from "@/i18n/client";
import { formatScheduledTime } from "@/lib/scheduling";

export type CampaignRow = {
  id: string;
  name: string;
  subject: string;
  status: string;
  createdAt: string;
  /** UTC instant (ISO 8601 with `Z`); null unless the campaign was ever scheduled. */
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  totalRecipients: number;
  /** Set only for SCHEDULED campaigns, whose queue does not exist yet. */
  estimatedRecipients: number | null;
  queued: number;
  sending: number;
  sent: number;
  failed: number;
  uniqueOpens: number;
};

/**
 * The campaigns table. Presentational: what happens on "Duplicate", "Change time"
 * and "Cancel" is decided by the page. The last two are offered on SCHEDULED
 * campaigns only. `locale` (a BCP 47 tag) and `timeZone` default to the browser's
 * and exist so the dates can be pinned in tests; the words come from the language
 * on screen.
 */
export default function CampaignsTable({
  rows, onDuplicate, onCancelScheduled, onReschedule, locale, timeZone,
}: {
  rows: CampaignRow[];
  onDuplicate: (id: string) => void;
  onCancelScheduled: (row: CampaignRow) => void;
  onReschedule: (row: CampaignRow) => void;
  locale?: string;
  timeZone?: string;
}) {
  const { t, formatDate } = useT();
  // `relative`: the visually hidden "Actions" header below is absolutely positioned; without a positioned
  // ancestor it escapes the scroll area and gives the whole page a sideways scrollbar.
  return (
    <div className="card relative overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left" style={{ color: "var(--color-muted)" }}>
            <th className="px-3 py-2 font-medium">{t("table.campaign")}</th>
            <th className="px-3 py-2 font-medium">{t("table.status")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("table.recipients")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("table.queued")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("table.sent")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("table.failed")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("table.opens")}</th>
            <th className="hidden px-3 py-2 font-medium xl:table-cell">{t("table.created")}</th>
            <th className="hidden px-3 py-2 font-medium xl:table-cell">{t("table.completed")}</th>
            <th className="px-3 py-2"><span className="sr-only">{t("table.actions")}</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const openRate = row.sent > 0 ? (row.uniqueOpens / row.sent) * 100 : 0;
            const isScheduled = row.status === "SCHEDULED";
            // No time to show means no label either, never "Scheduled for —".
            const showSchedule = isScheduled && formatScheduledTime(row.scheduledAt, { locale, timeZone }) !== null;
            return (
              <tr key={row.id} className="border-b last:border-0">
                <td className="px-3 py-2">
                  <Link href={`/campaigns/${row.id}`} className="font-medium hover:underline">{row.name}</Link>
                  <p className="hint line-clamp-1">{row.subject || t("table.noSubject")}</p>
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={row.status} />
                  {showSchedule ? (
                    <p className="hint mt-1">
                      {t("table.scheduledFor")}{" "}
                      <span className="whitespace-nowrap">
                        <ScheduledTime value={row.scheduledAt} locale={locale} timeZone={timeZone} />
                      </span>
                    </p>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {isScheduled && row.estimatedRecipients !== null ? (
                    <span title={t("table.estimateHint")}>≈ {row.estimatedRecipients.toLocaleString(locale)}</span>
                  ) : (
                    row.totalRecipients
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{row.queued + row.sending}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.sent}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.failed}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.uniqueOpens}
                  <span className="hint"> ({openRate.toFixed(0)}%)</span>
                </td>
                <td className="hidden px-3 py-2 xl:table-cell" style={{ color: "var(--color-muted)" }}>
                  {formatDate(row.createdAt)}
                </td>
                <td className="hidden px-3 py-2 xl:table-cell" style={{ color: "var(--color-muted)" }}>
                  {formatDate(row.completedAt)}
                </td>
                <td className="px-3 py-2 align-top">
                  {/* One under another: three buttons side by side are wider than the column in Russian. */}
                  <div className="flex flex-col items-stretch gap-1.5 whitespace-nowrap">
                    {isScheduled ? (
                      <button
                        className="btn px-2 py-1 text-xs"
                        aria-label={t("table.rescheduleAria", { name: row.name })}
                        onClick={() => onReschedule(row)}
                      >
                        {t("table.reschedule")}
                      </button>
                    ) : null}
                    {isScheduled ? (
                      <button
                        className="btn btn-danger px-2 py-1 text-xs"
                        aria-label={t("table.cancelAria", { name: row.name })}
                        onClick={() => onCancelScheduled(row)}
                      >
                        {t("table.cancel")}
                      </button>
                    ) : null}
                    <button
                      className="btn px-2 py-1 text-xs"
                      aria-label={t("table.duplicateAria", { name: row.name })}
                      onClick={() => onDuplicate(row.id)}
                    >
                      {t("table.duplicate")}
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
