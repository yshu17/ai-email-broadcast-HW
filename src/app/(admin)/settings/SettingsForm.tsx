"use client";

import { useState } from "react";
import { Alert, api } from "@/components/ui";
import { useT, type Translator } from "@/i18n/client";
import { Rich } from "@/i18n/rich";
import type { PublicSettings } from "@/lib/settings";

const PRESETS: Record<string, { host: string; port: number; security: "starttls" | "tls" }> = {
  "SendPulse (STARTTLS)": { host: "smtp-pulse.com", port: 587, security: "starttls" },
  "SendPulse (TLS)": { host: "smtp-pulse.com", port: 465, security: "tls" },
};

/** Warns that an environment variable makes the field below inert. */
function overrideNote(t: Translator["t"], overridden: Set<string>, field: string) {
  if (!overridden.has(field)) return null;
  return <p className="hint mt-1 text-amber-700 dark:text-amber-400">{t("settings.overrideNote")}</p>;
}

export default function SettingsForm({ initial }: { initial: PublicSettings }) {
  const { t } = useT();
  const [form, setForm] = useState({
    smtpHost: initial.smtpHost ?? "",
    smtpPort: initial.smtpPort ?? 587,
    smtpSecurity: initial.smtpSecurity,
    smtpUser: initial.smtpUser ?? "",
    smtpPassword: "",
    fromEmail: initial.fromEmail ?? "",
    fromName: initial.fromName ?? "",
    replyTo: initial.replyTo ?? "",
    maxEmailsPerHour: initial.maxEmailsPerHour,
  });
  const [passwordSet, setPasswordSet] = useState(initial.smtpPasswordSet);
  const [testTo, setTestTo] = useState("");
  const [status, setStatus] = useState<{ kind: "error" | "success" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState<"save" | "verify" | "send" | null>(null);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const overridden = new Set(initial.envOverrides);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy("save");
    setStatus(null);
    try {
      const saved = await api<PublicSettings>("/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          ...form,
          smtpPort: Number(form.smtpPort),
          maxEmailsPerHour: Number(form.maxEmailsPerHour),
          // An empty field means "keep the stored password".
          smtpPassword: form.smtpPassword || undefined,
        }),
      });
      setPasswordSet(saved.smtpPasswordSet);
      setForm((f) => ({ ...f, smtpPassword: "" }));
      setStatus({ kind: "success", text: t("settings.saved") });
    } catch (error) {
      setStatus({ kind: "error", text: error instanceof Error ? error.message : t("common.saveFailed") });
    } finally {
      setBusy(null);
    }
  };

  const test = async (mode: "verify" | "send") => {
    setBusy(mode);
    setStatus(null);
    try {
      const result = await api<{ message: string }>("/api/settings/test", {
        method: "POST",
        body: JSON.stringify({ mode, to: testTo }),
      });
      setStatus({ kind: "success", text: result.message });
    } catch (error) {
      setStatus({ kind: "error", text: error instanceof Error ? error.message : t("settings.testFailed") });
    } finally {
      setBusy(null);
    }
  };

  return (
    <form onSubmit={save} className="grid gap-6">
      {status ? <Alert kind={status.kind}>{status.text}</Alert> : null}

      {initial.envOverrides.length > 0 ? (
        <Alert kind="info">
          <Rich text={t("settings.envOverride", { names: initial.envOverrides.join(", ") })} />
        </Alert>
      ) : null}

      <section className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">{t("settings.smtp.title")}</h2>
          <div className="flex flex-wrap gap-1">
            {Object.entries(PRESETS).map(([label, preset]) => (
              <button key={label} type="button" className="btn px-2 py-1 text-xs"
                onClick={() => setForm((f) => ({
                  ...f, smtpHost: preset.host, smtpPort: preset.port, smtpSecurity: preset.security,
                }))}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="host">{t("settings.smtp.host")}</label>
            <input id="host" className="input" value={form.smtpHost} placeholder="smtp-pulse.com"
              onChange={(e) => set("smtpHost", e.target.value)} />
            {overrideNote(t, overridden, "smtpHost")}
          </div>
          <div>
            <label className="label" htmlFor="port">{t("settings.smtp.port")}</label>
            <input id="port" className="input" type="number" min={1} max={65535} value={form.smtpPort}
              onChange={(e) => set("smtpPort", Number(e.target.value))} />
            {overrideNote(t, overridden, "smtpPort")}
          </div>
          <div>
            <label className="label" htmlFor="security">{t("settings.smtp.encryption")}</label>
            <select id="security" className="input" value={form.smtpSecurity}
              onChange={(e) => set("smtpSecurity", e.target.value as typeof form.smtpSecurity)}>
              <option value="starttls">{t("settings.smtp.starttls")}</option>
              <option value="tls">{t("settings.smtp.tls")}</option>
              <option value="none">{t("settings.smtp.none")}</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="user">{t("settings.smtp.username")}</label>
            <input id="user" className="input" autoComplete="off" value={form.smtpUser}
              onChange={(e) => set("smtpUser", e.target.value)} />
            {overrideNote(t, overridden, "smtpUser")}
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="password">{t("login.password")}</label>
            <input id="password" className="input" type="password" autoComplete="new-password"
              placeholder={passwordSet ? t("settings.smtp.passwordStored") : t("settings.smtp.passwordPlaceholder")}
              value={form.smtpPassword} onChange={(e) => set("smtpPassword", e.target.value)} />
            <p className="hint mt-1">
              {t("settings.smtp.passwordHint")}
              {passwordSet ? t("settings.smtp.passwordCurrent") : ""}
            </p>
            {overrideNote(t, overridden, "smtpPassword")}
          </div>
        </div>
      </section>

      <section className="card p-4">
        <h2 className="font-medium">{t("settings.sender.title")}</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="fromEmail">{t("settings.sender.email")}</label>
            <input id="fromEmail" className="input" type="email" value={form.fromEmail}
              onChange={(e) => set("fromEmail", e.target.value)} />
            <p className="hint mt-1">{t("settings.sender.emailHint")}</p>
            {overrideNote(t, overridden, "fromEmail")}
          </div>
          <div>
            <label className="label" htmlFor="fromName">{t("settings.sender.name")}</label>
            <input id="fromName" className="input" value={form.fromName}
              onChange={(e) => set("fromName", e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="replyTo">{t("settings.sender.replyTo")}</label>
            <input id="replyTo" className="input" type="email" value={form.replyTo}
              onChange={(e) => set("replyTo", e.target.value)} />
          </div>
        </div>
      </section>

      <section className="card p-4">
        <h2 className="font-medium">{t("settings.rate.title")}</h2>
        <div className="mt-4 max-w-xs">
          <label className="label" htmlFor="rate">{t("settings.rate.max")}</label>
          <input id="rate" className="input" type="number" min={1} max={1000000}
            value={form.maxEmailsPerHour}
            onChange={(e) => set("maxEmailsPerHour", Number(e.target.value))} />
          <p className="hint mt-1">{t("settings.rate.hint")}</p>
          {overrideNote(t, overridden, "maxEmailsPerHour")}
        </div>
      </section>

      <section className="card p-4">
        <h2 className="font-medium">{t("settings.test.title")}</h2>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="label" htmlFor="testTo">{t("settings.test.sendTo")}</label>
            <input id="testTo" className="input" type="email" placeholder="you@example.com"
              value={testTo} onChange={(e) => setTestTo(e.target.value)} />
          </div>
          <button type="button" className="btn" disabled={busy !== null} onClick={() => test("verify")}>
            {busy === "verify" ? t("settings.test.checking") : t("settings.test.connection")}
          </button>
          <button type="button" className="btn" disabled={busy !== null || !testTo} onClick={() => test("send")}>
            {busy === "send" ? t("settings.test.sending") : t("settings.test.send")}
          </button>
        </div>
        <p className="hint mt-2">{t("settings.test.saveFirst")}</p>
      </section>

      <div>
        <button className="btn btn-primary" type="submit" disabled={busy !== null}>
          {busy === "save" ? t("common.saving") : t("settings.save")}
        </button>
      </div>
    </form>
  );
}
