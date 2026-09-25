"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, api } from "@/components/ui";
import { useT } from "@/i18n/client";

export default function NewCampaignForm() {
  const { t } = useT();
  const router = useRouter();
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ campaign: { id: string } }>("/api/campaigns", {
        method: "POST",
        body: JSON.stringify({ name, subject }),
      });
      router.push(`/campaigns/${result.campaign.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("campaignNew.failed"));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="card grid gap-3 p-4">
      {error ? <Alert kind="error">{error}</Alert> : null}
      <div>
        <label className="label" htmlFor="name">{t("campaignNew.name")}</label>
        <input id="name" className="input" required autoFocus value={name}
          onChange={(e) => setName(e.target.value)} placeholder={t("campaignNew.namePlaceholder")} />
        <p className="hint mt-1">{t("campaignNew.nameHint")}</p>
      </div>
      <div>
        <label className="label" htmlFor="subject">{t("campaignNew.subject")}</label>
        <input id="subject" className="input" value={subject}
          onChange={(e) => setSubject(e.target.value)} placeholder={t("campaignNew.subjectPlaceholder")} />
        <p className="hint mt-1">{t("campaignNew.subjectHint")}</p>
      </div>
      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? t("campaignNew.creating") : t("campaignNew.create")}
      </button>
    </form>
  );
}
