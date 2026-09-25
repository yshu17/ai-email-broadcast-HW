"use client";

import { useId, useState } from "react";
import { useT } from "@/i18n/client";
import { intlTag } from "@/i18n/locale";
import { RATE_PRESETS } from "@/lib/testing/templates";
import { TEST_LIMITS } from "@/lib/testing/limits";
import type { HelpId } from "@/lib/testing/help";
import HelpIcon from "./HelpIcon";
import { panelApi } from "./api";
import { usePanel } from "./panel-context";
import { ActionButton, Field, Metric, MetricList, Notice, helpProps } from "./panel-ui";
import { integerProblem } from "./validation";

const PRESET_HELP: Record<string, HelpId> = {
  quick: "ratePresetQuick", visible: "ratePresetVisible", large: "ratePresetLarge",
};

/**
 * "Queue and Rate Limit": what the queue holds, the limit it is held to, and the two numbers
 * (how many emails, per how many seconds) that replace the configured ceiling while testing.
 * The limiter itself is the app's own; this only feeds it different numbers.
 */
export default function QueueSection() {
  const { t, locale } = useT();
  const panel = usePanel();
  const { snapshot, run, busy } = panel;
  const id = useId();

  const queue = snapshot?.queue ?? null;
  const rate = snapshot?.rate ?? null;

  // What is typed, or null while nothing has been: then the fields show the limit in force, or the defaults.
  const [typedMax, setTypedMax] = useState<string | null>(null);
  const [typedWindow, setTypedWindow] = useState<string | null>(null);
  const maxEmails = typedMax ?? String(rate?.override?.maxEmails ?? TEST_LIMITS.rateMaxEmails.default);
  const windowSeconds = typedWindow ?? String(rate?.override?.windowSeconds ?? TEST_LIMITS.rateWindowSeconds.default);
  const setMaxEmails = setTypedMax;
  const setWindowSeconds = setTypedWindow;
  const [problems, setProblems] = useState<{ max: string | null; window: string | null }>({ max: null, window: null });

  const apply = () => {
    const max = integerProblem(t, "rateMaxEmails", maxEmails, "label.Max emails");
    const window = integerProblem(t, "rateWindowSeconds", windowSeconds, "label.Interval");
    setProblems({ max, window });
    if (max || window) return;
    void run("rate.apply", () => panelApi.rateLimit({ action: "apply", maxEmails: Number(maxEmails), windowSeconds: Number(windowSeconds) }), {
      notice: () => {
        // The limit is now the server's: the fields go back to showing it.
        setTypedMax(null);
        setTypedWindow(null);
        return t("tp.rate.applyDone");
      },
    });
  };

  const reset = () => {
    setProblems({ max: null, window: null });
    setTypedMax(null);
    setTypedWindow(null);
    void run("rate.reset", () => panelApi.rateLimit({ action: "reset" }), { notice: () => t("tp.rate.resetDone") });
  };

  const number = (value: number) => new Intl.NumberFormat(intlTag(locale), { maximumFractionDigits: 2 }).format(value);
  const draftRate = Number(maxEmails) / Number(windowSeconds);

  return (
    <>
      <MetricList>
        <Metric helpId="queueState" label={t("tp.queue.state")} tour="queue-state">
          <span className="badge">{queue ? t(`tp.queue.state.${queue.state}` as const) : "—"}</span>
        </Metric>
      </MetricList>
      <MetricList tour="queue-counts">
          <Metric helpId="queueWaiting" label={t("tp.queue.waiting")}>{queue?.waiting ?? "—"}</Metric>
          <Metric helpId="queueActive" label={t("tp.queue.active")}>{queue?.active ?? "—"}</Metric>
          <Metric helpId="queueDone" label={t("tp.queue.done")}>{queue?.done ?? "—"}</Metric>
          <Metric helpId="queueFailed" label={t("tp.queue.failed")}>{queue?.failed ?? "—"}</Metric>
      </MetricList>
      <MetricList>
        <Metric helpId="rateCurrent" label={t("tp.rate.current")}>
          {rate ? t("tp.rate.currentValue", { count: rate.maxEmails, seconds: rate.windowSeconds }) : "—"}
          {rate?.source === "test" ? <span className="test-chip ml-2">{t("tp.rate.testTag")}</span> : null}
        </Metric>
        <Metric helpId="rateWindow" label={t("tp.rate.window")}>{rate ? t("tp.seconds", { seconds: rate.windowSeconds }) : "—"}</Metric>
        <Metric helpId="rateSent" label={t("tp.rate.sent")}>{queue?.sentInWindow ?? "—"}</Metric>
        <Metric helpId="smtpServer" label={t("tp.smtp.label")}>
          {snapshot ? t("tp.smtp.value", { port: snapshot.smtp.port, accepted: snapshot.smtp.accepted }) : "—"}
        </Metric>
      </MetricList>
      {snapshot ? <p className="hint break-all">{t("tp.smtp.folder", { folder: snapshot.smtp.outputDir })}</p> : null}

      <div className="rounded-md border p-3" data-tour="rate-fields">
        <div className="flex items-center text-sm font-medium">
          {t("tp.rate.formulaTitle")}
          <HelpIcon id="rateFormula" />
        </div>
        <p className="mt-1 text-sm" data-metric="rateFormula-value" aria-live="polite">
          {Number.isFinite(draftRate) && Number(windowSeconds) > 0
            ? t("tp.rate.formula", { max: maxEmails, seconds: windowSeconds, rate: number(draftRate) })
            : t("tp.rate.formulaEmpty")}
        </p>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field helpId="rateMaxEmails" htmlFor={`${id}-max`} label={t("tp.rate.maxEmails")}>
            <input id={`${id}-max`} className="input" inputMode="numeric" value={maxEmails} aria-invalid={problems.max !== null}
              onChange={(e) => setMaxEmails(e.target.value)} {...helpProps("rateMaxEmails")} />
            {problems.max ? <Notice kind="error">{problems.max}</Notice> : null}
          </Field>
          <Field helpId="rateInterval" htmlFor={`${id}-window`} label={t("tp.rate.interval")}>
            <div className="flex items-center gap-2">
              <input id={`${id}-window`} className="input" inputMode="numeric" value={windowSeconds} aria-invalid={problems.window !== null}
                onChange={(e) => setWindowSeconds(e.target.value)} {...helpProps("rateInterval")} />
              <span className="hint">{t("tp.unit.seconds")}</span>
            </div>
            {problems.window ? <Notice kind="error">{problems.window}</Notice> : null}
          </Field>
        </div>

        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-2" role="group" aria-label={t("tp.rate.presets")}>
          {RATE_PRESETS.map((preset) => (
            <ActionButton
              key={preset.id} helpId={PRESET_HELP[preset.id]}
              onClick={() => {
                setMaxEmails(String(preset.maxEmails));
                setWindowSeconds(String(preset.windowSeconds));
                setProblems({ max: null, window: null });
              }}
            >
              {t("tp.rate.preset", { maxEmails: preset.maxEmails, seconds: preset.windowSeconds })}
            </ActionButton>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-2">
          <ActionButton helpId="rateApply" primary tour="rate-apply" disabled={busy !== null} busy={busy === "rate.apply"} onClick={apply}>
            {t("tp.rate.apply")}
          </ActionButton>
          <ActionButton helpId="rateReset" tour="rate-reset" disabled={busy !== null || !rate?.override} busy={busy === "rate.reset"} onClick={reset}>
            {t("tp.rate.reset")}
          </ActionButton>
        </div>
      </div>
    </>
  );
}
