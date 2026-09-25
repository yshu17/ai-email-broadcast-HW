"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Alert, EmptyState, Spinner, api, useLoader } from "@/components/ui";
import CancelScheduledDialog from "@/components/CancelScheduledDialog";
import RescheduleDialog from "@/components/RescheduleDialog";
import { useT } from "@/i18n/client";
import { intlTag } from "@/i18n/locale";
import { formatScheduledTime } from "@/lib/scheduling";
import CampaignsTable, { type CampaignRow } from "./CampaignsTable";

export default function CampaignsClient() {
  const { t, locale } = useT();
  const router = useRouter();
  const fetchCampaigns = useCallback(async () => {
    const data = await api<{ campaigns: CampaignRow[] }>("/api/campaigns");
    return data.campaigns;
  }, []);

  const { data: rows, error, setError, setData, reload } = useLoader(fetchCampaigns);
  const [cancelTarget, setCancelTarget] = useState<CampaignRow | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<CampaignRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const duplicate = async (id: string) => {
    try {
      const result = await api<{ campaign: { id: string } }>(`/api/campaigns/${id}/duplicate`, { method: "POST" });
      router.push(`/campaigns/${result.campaign.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("campaigns.duplicateFailed"));
    }
  };

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t("campaigns.title")}</h1>
        <Link className="btn btn-primary" href="/campaigns/new">{t("campaigns.new")}</Link>
      </div>

      {error ? <Alert kind="error">{error}</Alert> : null}
      {notice ? <Alert kind="success">{notice}</Alert> : null}

      {rows === null ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState title={t("campaigns.empty.title")}>{t("campaigns.empty.hint")}</EmptyState>
      ) : (
        <CampaignsTable
          rows={rows}
          onDuplicate={duplicate}
          onCancelScheduled={(row) => { setNotice(null); setCancelTarget(row); }}
          onReschedule={(row) => { setNotice(null); setRescheduleTarget(row); }}
        />
      )}

      {rescheduleTarget ? (
        <RescheduleDialog
          campaign={rescheduleTarget}
          onClose={() => setRescheduleTarget(null)}
          onStale={reload}
          onRescheduled={({ id, name, scheduledAt }) => {
            setRescheduleTarget(null);
            setNotice(t("reschedule.notice", {
              name, when: formatScheduledTime(scheduledAt, { locale: intlTag(locale) }) ?? "",
            }));
            // Show the new time at once; the reload brings whatever else changed meanwhile.
            setData((current) => current && current.map((row) => (row.id === id ? { ...row, scheduledAt } : row)));
            reload();
          }}
        />
      ) : null}

      {cancelTarget ? (
        <CancelScheduledDialog
          campaign={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onStale={reload}
          onCancelled={({ name, alreadyCancelled }) => {
            setCancelTarget(null);
            setNotice(t(alreadyCancelled ? "campaigns.alreadyCancelledNotice" : "campaigns.cancelledNotice", { name }));
            reload();
          }}
        />
      ) : null}

      <p className="hint">{t("campaigns.opensNote")}</p>
    </div>
  );
}
