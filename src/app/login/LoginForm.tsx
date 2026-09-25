"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, api } from "@/components/ui";
import { useT } from "@/i18n/client";

export default function LoginForm() {
  const { t } = useT();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("login.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-3">
      {error ? <Alert kind="error">{error}</Alert> : null}
      <div>
        <label className="label" htmlFor="email">{t("login.email")}</label>
        <input id="email" className="input" type="email" autoComplete="username" required
          value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="password">{t("login.password")}</label>
        <input id="password" className="input" type="password" autoComplete="current-password" required
          value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <button className="btn btn-primary mt-1" type="submit" disabled={busy}>
        {busy ? t("login.submitting") : t("login.submit")}
      </button>
    </form>
  );
}
