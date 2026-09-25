"use client";

import { useState } from "react";
import { useT } from "@/i18n/client";
import { Rich } from "@/i18n/rich";

export default function UnsubscribeForm({ token, email }: { token: string; email: string }) {
  const { t } = useT();
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const unsubscribe = async () => {
    setBusy(true);
    setError(false);
    try {
      const response = await fetch(`/api/unsubscribe/${encodeURIComponent(token)}`, { method: "POST" });
      if (!response.ok) throw new Error("failed");
      setDone(true);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <>
        <h1 className="text-lg font-semibold">{t("unsubscribe.done.title")}</h1>
        <p className="hint mt-2"><Rich text={t("unsubscribe.done.body", { email })} /></p>
      </>
    );
  }

  return (
    <>
      <h1 className="text-lg font-semibold">{t("unsubscribe.title")}</h1>
      <p className="mt-2 text-sm"><Rich text={t("unsubscribe.question", { email })} /></p>
      {error ? (
        <p className="mt-2 text-sm text-red-600">{t("unsubscribe.error")}</p>
      ) : null}
      <button className="btn btn-primary mt-4" onClick={unsubscribe} disabled={busy}>
        {busy ? t("unsubscribe.busy") : t("unsubscribe.button")}
      </button>
    </>
  );
}
