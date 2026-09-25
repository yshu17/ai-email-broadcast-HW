"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Editor from "@/components/Editor";
import { Alert, ApiError, Modal, api } from "@/components/ui";
import ScheduleFields from "@/components/ScheduleFields";
import { useT } from "@/i18n/client";
import { describeDuration } from "@/i18n/format";
import { intlTag } from "@/i18n/locale";
import { Rich } from "@/i18n/rich";
import type { MessageKey } from "@/i18n/translate";
import { describeLocalTimeZone, formatScheduledTime, toScheduledAt, type Occurrence } from "@/lib/scheduling";

export type CampaignDraft = {
  id: string;
  name: string;
  subject: string;
  fromName: string | null;
  fromEmail: string | null;
  replyTo: string | null;
  contentHtml: string;
  textBody: string | null;
  textBodyIsCustom: boolean;
  status: string;
  totalRecipients: number;
  createdAt: string;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

type List = { id: string; name: string; contactCount: number };

/**
 * The "When to send?" choice. Kept in the wizard so it survives step changes.
 * `occurrence` is only ever set to settle a wall-clock time that clocks going
 * back make happen twice; it is cleared whenever the date or time changes.
 */
type SendPlan = { mode: "now" | "schedule"; date: string; time: string; occurrence?: Occurrence };

type Audience = {
  totalMemberships: number;
  uniqueContacts: number;
  duplicatesRemoved: number;
  suppressed: number;
  finalRecipients: number;
  maxEmailsPerHour: number;
  /** Numbers, so each language words the duration itself; the string is the English fallback. */
  estimatedSeconds?: number;
  estimatedDuration: string;
};

const STEPS: MessageKey[] = ["wizard.step.compose", "wizard.step.recipients", "wizard.step.preview", "wizard.step.send"];

export default function CampaignWizard({
  initial, initialListIds, onQueued, onScheduled,
}: {
  initial: CampaignDraft;
  initialListIds: string[];
  onQueued: () => void;
  onScheduled: () => void;
}) {
  const { t } = useT();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(initial);
  const [sendPlan, setSendPlan] = useState<SendPlan>({ mode: "now", date: "", time: "" });
  const [listIds, setListIds] = useState<string[]>(initialListIds);
  const [lists, setLists] = useState<List[]>([]);
  const [audience, setAudience] = useState<Audience | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    void api<{ lists: List[] }>("/api/lists").then((d) => setLists(d.lists)).catch(() => undefined);
  }, []);

  const set = <K extends keyof CampaignDraft>(key: K, value: CampaignDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
  };

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await api(`/api/campaigns/${draft.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: draft.name,
          subject: draft.subject,
          fromName: draft.fromName,
          fromEmail: draft.fromEmail,
          replyTo: draft.replyTo,
          contentHtml: draft.contentHtml,
          textBody: draft.textBodyIsCustom ? draft.textBody : undefined,
          textBodyIsCustom: draft.textBodyIsCustom,
          listIds,
        }),
      });
      setDirty(false);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : t("wizard.saveFailed"));
      return false;
    } finally {
      setSaving(false);
    }
  }, [draft, listIds, t]);

  const loadAudience = useCallback(async () => {
    try {
      setAudience(await api<Audience>(`/api/campaigns/${draft.id}/audience`));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("wizard.audienceFailed"));
    }
  }, [draft.id, t]);

  const goTo = async (next: number) => {
    if (next > step && !(await save())) return;
    setStep(next);
    if (next >= 1) void loadAudience();
  };

  const toggleList = (id: string) => {
    setListIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setDirty(true);
    setAudience(null);
  };

  return (
    <div className="grid gap-4">
      <ol className="flex flex-wrap gap-1 text-sm">
        {STEPS.map((label, index) => (
          <li key={label}>
            <button
              className={`btn px-3 py-1.5 text-xs ${index === step ? "btn-active" : ""}`}
              aria-current={index === step ? "step" : undefined}
              onClick={() => void goTo(index)}
            >
              {index + 1}. {t(label)}
            </button>
          </li>
        ))}
      </ol>

      {error ? <Alert kind="error">{error}</Alert> : null}
      {notice ? <Alert kind="success">{notice}</Alert> : null}

      {step === 0 ? (
        <ComposeStep draft={draft} set={set} />
      ) : step === 1 ? (
        <RecipientsStep lists={lists} listIds={listIds} toggleList={toggleList} audience={audience} />
      ) : step === 2 ? (
        <PreviewStep campaignId={draft.id} onNotice={setNotice} onError={setError} />
      ) : (
        <SendStep
          draft={draft}
          audience={audience}
          lists={lists.filter((l) => listIds.includes(l.id))}
          plan={sendPlan}
          onPlanChange={(patch) => setSendPlan((p) => ({ ...p, ...patch }))}
          onQueued={() => { onQueued(); router.refresh(); }}
          onScheduled={() => { onScheduled(); router.refresh(); }}
          onError={setError}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        {step > 0 ? <button className="btn" onClick={() => void goTo(step - 1)}>{t("wizard.back")}</button> : null}
        {step < STEPS.length - 1 ? (
          <button className="btn btn-primary" onClick={() => void goTo(step + 1)} disabled={saving}>
            {saving ? t("wizard.saving") : t("wizard.continue")}
          </button>
        ) : null}
        <button className="btn" onClick={() => void save()} disabled={saving || !dirty}>
          {dirty ? t("wizard.saveDraft") : t("wizard.saved")}
        </button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- step: 1 */

export function ComposeStep({
  draft, set,
}: {
  draft: CampaignDraft;
  set: <K extends keyof CampaignDraft>(key: K, value: CampaignDraft[K]) => void;
}) {
  const { t } = useT();
  const [showText, setShowText] = useState(draft.textBodyIsCustom);

  return (
    <div className="grid gap-4">
      <section className="card grid gap-4 p-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="cname">{t("wizard.compose.name")}</label>
          <input id="cname" className="input" value={draft.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="csubject">{t("wizard.compose.subject")}</label>
          <input id="csubject" className="input" value={draft.subject}
            onChange={(e) => set("subject", e.target.value)} />
          <p className="hint mt-1">{t("wizard.compose.subjectHint", { variable: "{{firstName}}" })}</p>
        </div>
        <div>
          <label className="label" htmlFor="cfromName">{t("wizard.compose.senderName")}</label>
          <input id="cfromName" className="input" value={draft.fromName ?? ""}
            onChange={(e) => set("fromName", e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="cfromEmail">{t("wizard.compose.senderEmail")}</label>
          <input id="cfromEmail" className="input" type="email" value={draft.fromEmail ?? ""}
            onChange={(e) => set("fromEmail", e.target.value)} />
          <p className="hint mt-1">{t("wizard.compose.senderEmailHint")}</p>
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="creplyTo">{t("wizard.compose.replyTo")}</label>
          <input id="creplyTo" className="input" type="email" value={draft.replyTo ?? ""}
            onChange={(e) => set("replyTo", e.target.value)} />
        </div>
      </section>

      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="label mb-0">{t("wizard.compose.content")}</span>
          <span className="hint">
            {t("wizard.compose.variables")} {"{{firstName}}"} · {"{{lastName}}"} · {"{{email}}"} · {"{{unsubscribeUrl}}"}
          </span>
        </div>
        <Editor value={draft.contentHtml} onChange={(html) => set("contentHtml", html)} />
        <p className="hint mt-1">{t("wizard.compose.contentHint", { variable: "{{unsubscribeUrl}}" })}</p>
      </div>

      <section className="card p-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showText}
            onChange={(e) => {
              setShowText(e.target.checked);
              set("textBodyIsCustom", e.target.checked);
            }} />
          {t("wizard.compose.customText")}
        </label>
        <p className="hint mt-1">{t("wizard.compose.customTextHint")}</p>
        {showText ? (
          <textarea className="input mt-3 font-mono text-xs" rows={8} value={draft.textBody ?? ""}
            onChange={(e) => set("textBody", e.target.value)} aria-label={t("wizard.compose.plainTextLabel")} />
        ) : null}
      </section>
    </div>
  );
}

/* --------------------------------------------------------------- step: 2 */

export function RecipientsStep({
  lists, listIds, toggleList, audience,
}: { lists: List[]; listIds: string[]; toggleList: (id: string) => void; audience: Audience | null }) {
  const { t, formatNumber } = useT();
  return (
    <div className="grid gap-4">
      <section className="card p-4">
        <h2 className="font-medium">{t("wizard.recipients.select")}</h2>
        {lists.length === 0 ? (
          <p className="hint mt-2">{t("wizard.recipients.noLists")}</p>
        ) : (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {lists.map((list) => (
              <label key={list.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                <input type="checkbox" checked={listIds.includes(list.id)} onChange={() => toggleList(list.id)} />
                <span className="flex-1">{list.name}</span>
                <span className="hint tabular-nums">{formatNumber(list.contactCount)}</span>
              </label>
            ))}
          </div>
        )}
      </section>

      <section className="card p-4">
        <h2 className="font-medium">{t("wizard.recipients.audience")}</h2>
        {audience === null ? (
          <p className="hint mt-2">{t("wizard.recipients.pending")}</p>
        ) : (
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label={t("wizard.recipients.acrossLists")} value={audience.totalMemberships} />
            <Stat label={t("wizard.recipients.duplicates")} value={audience.duplicatesRemoved} />
            <Stat label={t("wizard.recipients.unsubscribed")} value={audience.suppressed} />
            <Stat label={t("wizard.recipients.willReceive")} value={audience.finalRecipients} strong />
          </dl>
        )}
        <p className="hint mt-3">{t("wizard.recipients.dedupeNote")}</p>
      </section>
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  const { formatNumber } = useT();
  return (
    <div>
      <dt className="hint">{label}</dt>
      <dd className={`tabular-nums ${strong ? "text-2xl font-semibold" : "text-xl"}`}>{formatNumber(value)}</dd>
    </div>
  );
}

/* --------------------------------------------------------------- step: 3 */

function PreviewStep({
  campaignId, onNotice, onError,
}: { campaignId: string; onNotice: (m: string) => void; onError: (m: string | null) => void }) {
  const { t } = useT();
  const [preview, setPreview] = useState<{ subject: string; html: string; text: string } | null>(null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [mode, setMode] = useState<"html" | "text">("html");
  const [testOpen, setTestOpen] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<{ subject: string; html: string; text: string }>(`/api/campaigns/${campaignId}/preview`)
      .then(setPreview)
      .catch((err) => onError(err instanceof Error ? err.message : t("wizard.preview.failed")));
  }, [campaignId, onError, t]);

  const sendTest = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    onError(null);
    try {
      const result = await api<{ message: string }>(`/api/campaigns/${campaignId}/test`, {
        method: "POST",
        body: JSON.stringify({ to: testTo }),
      });
      onNotice(result.message);
      setTestOpen(false);
    } catch (err) {
      onError(err instanceof Error ? err.message : t("wizard.preview.testFailed"));
    } finally {
      setBusy(false);
    }
  };

  const width = useMemo(() => (device === "mobile" ? 390 : 700), [device]);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={`btn px-3 py-1.5 text-xs ${device === "desktop" ? "btn-active" : ""}`}
          onClick={() => setDevice("desktop")}>{t("wizard.preview.desktop")}</button>
        <button className={`btn px-3 py-1.5 text-xs ${device === "mobile" ? "btn-active" : ""}`}
          onClick={() => setDevice("mobile")}>{t("wizard.preview.mobile")}</button>
        <span className="mx-1 h-4 w-px" style={{ backgroundColor: "var(--color-border)" }} />
        <button className={`btn px-3 py-1.5 text-xs ${mode === "html" ? "btn-active" : ""}`}
          onClick={() => setMode("html")}>HTML</button>
        <button className={`btn px-3 py-1.5 text-xs ${mode === "text" ? "btn-active" : ""}`}
          onClick={() => setMode("text")}>{t("wizard.preview.plainText")}</button>
        <button className="btn ml-auto" onClick={() => setTestOpen(true)}>{t("wizard.preview.sendTest")}</button>
      </div>

      {preview === null ? (
        <p className="hint">{t("wizard.preview.rendering")}</p>
      ) : (
        <div className="card p-4">
          <p className="text-sm"><span className="hint">{t("report.subject")} </span><strong>{preview.subject}</strong></p>
          <div className="mt-3 overflow-x-auto">
            {mode === "html" ? (
              // Rendered in a sandboxed iframe: no scripts, no same-origin access.
              <iframe
                title={t("wizard.preview.frameTitle")}
                sandbox=""
                srcDoc={preview.html}
                style={{ width, height: 620, maxWidth: "100%", border: "1px solid var(--color-border)", borderRadius: 8, background: "#fff" }}
              />
            ) : (
              <pre className="whitespace-pre-wrap rounded-lg border p-3 font-mono text-xs">{preview.text}</pre>
            )}
          </div>
          <p className="hint mt-2">{t("wizard.preview.note")}</p>
        </div>
      )}

      <Modal open={testOpen} title={t("wizard.preview.sendTest")} onClose={() => setTestOpen(false)}>
        <form onSubmit={sendTest} className="grid gap-3">
          <div>
            <label className="label" htmlFor="testTo">{t("wizard.preview.recipient")}</label>
            <input id="testTo" className="input" type="email" required autoFocus value={testTo}
              onChange={(e) => setTestTo(e.target.value)} />
          </div>
          <p className="hint">{t("wizard.preview.testHint")}</p>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? t("wizard.preview.sending") : t("wizard.preview.sendTestButton")}
          </button>
        </form>
      </Modal>
    </div>
  );
}

/* --------------------------------------------------------------- step: 4 */

/** The last step. Exported so its markup can be rendered and asserted on in tests. */
export function SendStep({
  draft, audience, lists, plan, onPlanChange, onQueued, onScheduled, onError,
}: {
  draft: CampaignDraft;
  audience: Audience | null;
  lists: List[];
  plan: SendPlan;
  onPlanChange: (patch: Partial<SendPlan>) => void;
  onQueued: () => void;
  onScheduled: () => void;
  onError: (m: string) => void;
}) {
  const { t, locale, formatNumber } = useT();
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Required/format errors appear once the user tries to continue; a time that
  // is already in the past is reported as soon as both fields are filled in.
  const [attempted, setAttempted] = useState(false);
  // A schedule rule the server rejected (it re-checks everything itself).
  const [serverScheduleError, setServerScheduleError] = useState<string | null>(null);

  const scheduling = plan.mode === "schedule";
  const resolve = () => toScheduledAt(plan.date, plan.time, new Date(), { occurrence: plan.occurrence });
  const check = scheduling ? resolve() : null;
  const zone = describeLocalTimeZone(check?.ok ? check.date : new Date());

  const changePlan = (patch: Partial<SendPlan>) => {
    setServerScheduleError(null);
    onPlanChange(patch);
  };

  const requestConfirm = () => {
    if (scheduling && !resolve().ok) {
      setAttempted(true);
      return;
    }
    setConfirmOpen(true);
  };

  const send = async () => {
    setBusy(true);
    try {
      if (scheduling) {
        // Re-checked here: the minute may have passed while the dialog was open.
        const latest = resolve();
        if (!latest.ok) {
          setConfirmOpen(false);
          setAttempted(true);
          setBusy(false);
          return;
        }
        await api(`/api/campaigns/${draft.id}/schedule`, {
          method: "POST",
          body: JSON.stringify({ scheduledAt: latest.date.toISOString() }),
        });
        setConfirmOpen(false);
        onScheduled();
      } else {
        await api(`/api/campaigns/${draft.id}/send`, { method: "POST" });
        setConfirmOpen(false);
        onQueued();
      }
    } catch (err) {
      setConfirmOpen(false);
      setBusy(false);
      if (err instanceof ApiError && err.code?.startsWith("SCHEDULE_")) {
        // The server judged the time by its own clock: show it beside the fields.
        setServerScheduleError(err.message);
        return;
      }
      onError(err instanceof Error ? err.message : t("wizard.send.queueFailed"));
    }
  };

  const whenLabel = check?.ok ? formatScheduledTime(check.date, { locale: intlTag(locale) }) : null;

  return (
    <div className="grid gap-4">
      <section className="card p-4">
        <h2 className="font-medium">{t("wizard.send.confirmTitle")}</h2>
        <dl className="mt-3 grid gap-2 text-sm">
          <Row label={t("wizard.send.subject")} value={draft.subject || <span className="text-red-600">{t("wizard.send.notSet")}</span>} />
          <Row label={t("wizard.send.sender")} value={`${draft.fromName ?? ""} <${draft.fromEmail ?? "—"}>`} />
          <Row label={t("wizard.send.replyTo")} value={draft.replyTo || "—"} />
          <Row label={t("wizard.send.lists")} value={lists.length > 0 ? lists.map((l) => l.name).join(", ") : t("wizard.send.noneSelected")} />
          <Row label={t("wizard.send.uniqueRecipients")} value={audience ? formatNumber(audience.finalRecipients) : "…"} />
          <Row label={t("wizard.send.duplicates")} value={audience ? formatNumber(audience.duplicatesRemoved) : "…"} />
          <Row label={t("wizard.send.unsubscribedSkipped")} value={audience ? formatNumber(audience.suppressed) : "…"} />
          <Row
            label={t("wizard.send.estimatedDuration")}
            value={audience
              ? t("wizard.send.durationAtRate", {
                duration: audience.estimatedSeconds !== undefined
                  ? describeDuration(audience.estimatedSeconds, locale)
                  : audience.estimatedDuration,
                rate: formatNumber(audience.maxEmailsPerHour),
              })
              : "…"}
          />
          <Row label={t("wizard.send.startsRow")} value={scheduling ? (whenLabel ?? t("wizard.send.notChosen")) : t("wizard.send.immediately")} />
        </dl>
      </section>

      <section className="card p-4">
        <fieldset>
          <legend className="font-medium">{t("wizard.send.when")}</legend>
          <div className="mt-3 grid gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="sendMode" checked={!scheduling}
                onChange={() => changePlan({ mode: "now" })} />
              {t("wizard.send.now")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="sendMode" checked={scheduling}
                onChange={() => changePlan({ mode: "schedule" })} />
              {t("wizard.send.schedule")}
            </label>
          </div>
        </fieldset>

        {scheduling ? (
          <div className="mt-4">
            <ScheduleFields plan={plan} onChange={changePlan} attempted={attempted} serverError={serverScheduleError} />
          </div>
        ) : null}
      </section>

      <div>
        <button
          className="btn btn-primary"
          disabled={busy || !audience || audience.finalRecipients === 0 || !draft.subject.trim()}
          onClick={requestConfirm}
        >
          {scheduling ? t("wizard.send.scheduleButton") : t("wizard.send.queueButton")}
        </button>
        {audience?.finalRecipients === 0 ? (
          <p className="hint mt-2">{t("wizard.send.noRecipients")}</p>
        ) : null}
      </div>

      <Modal
        open={confirmOpen}
        title={scheduling ? t("wizard.send.scheduleTitle") : t("wizard.send.queueTitle")}
        onClose={() => setConfirmOpen(false)}
      >
        <div className="grid gap-3 text-sm">
          {scheduling ? (
            <p>
              <Rich text={t("wizard.send.confirmSchedule", {
                count: audience?.finalRecipients ?? 0, when: whenLabel ?? "", zone,
              })} />
            </p>
          ) : (
            <p>
              <Rich text={t("wizard.send.confirmQueue", { count: audience?.finalRecipients ?? 0 })} />
            </p>
          )}
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={busy} onClick={send}>
              {scheduling
                ? (busy ? t("wizard.send.scheduling") : t("wizard.send.yesSchedule"))
                : (busy ? t("wizard.send.queueing") : t("wizard.send.yesQueue"))}
            </button>
            <button className="btn" onClick={() => setConfirmOpen(false)} disabled={busy}>{t("common.cancel")}</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-2 border-b pb-2 last:border-0">
      <dt className="hint w-44 shrink-0">{label}</dt>
      <dd className="flex-1 break-words">{value}</dd>
    </div>
  );
}
