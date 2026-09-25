"use client";

import { useId, useState } from "react";
import { useT } from "@/i18n/client";
import { TEST_LIMITS } from "@/lib/testing/limits";
import { panelApi } from "./api";
import { usePanel } from "./panel-context";
import { ActionButton, Field, Metric, MetricList, Notice, helpProps, useTimeFormat } from "./panel-ui";
import { cycleNotice } from "./events";
import { integerProblem } from "./validation";

/**
 * "Scheduler": the local test scheduler's state, and Start, Stop and Run now. Stop stops only the
 * automatic cycles; Run now is exactly one cycle by the same service the automatic ones use.
 */
export default function SchedulerSection() {
  const { t } = useT();
  const panel = usePanel();
  const { snapshot, run, busy } = panel;
  const time = useTimeFormat();
  const id = useId();

  const scheduler = snapshot?.scheduler ?? null;
  const running = scheduler?.running ?? false;
  const last = scheduler?.last ?? null;
  const result = last?.result ?? null;

  // The interval field shows the server's value until it is typed into; the draft lives only while typing.
  const [typed, setTyped] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const draft = typed ?? String(scheduler?.intervalSeconds ?? TEST_LIMITS.schedulerInterval.default);

  const applyInterval = () => {
    if (typed === null || (scheduler && typed.trim() === String(scheduler.intervalSeconds))) {
      setTyped(null);
      return setProblem(null);
    }
    const message = integerProblem(t, "schedulerInterval", typed, "label.Scheduler interval");
    setProblem(message);
    if (message) return;
    void run("sched.interval", () => panelApi.scheduler({ action: "interval", seconds: Number(typed) }), {
      notice: () => {
        setTyped(null);
        return t("tp.sched.intervalDone");
      },
    });
  };

  const runNow = () => run("sched.run", () => panelApi.scheduler({ action: "run" }), { notice: (answer) => cycleNotice(t, answer) });

  return (
    <>
      <MetricList>
        <Metric helpId="schedRunning" label={t("tp.sched.state")}>
          <span className={running ? "badge text-emerald-700 dark:text-emerald-400" : "badge"}>
            {t(running ? "tp.sched.running" : "tp.sched.stopped")}
          </span>
        </Metric>
        <Metric helpId="schedLastCycle" label={t("tp.sched.lastCycle")}>
          {last ? t("tp.sched.lastCycleValue", { time: time(last.finishedAt), ms: last.durationMs }) : "—"}
        </Metric>
        <Metric helpId="schedNextCycle" label={t("tp.sched.nextCycle")}>{time(scheduler?.nextCycleAt)}</Metric>
        <Metric helpId="schedDue" label={t("tp.sched.due")}>{result ? result.dueCampaigns : "—"}</Metric>
        <Metric helpId="schedLastResult" label={t("tp.sched.result")}>
          {result
            ? t("tp.sched.resultValue", {
              started: result.activatedCampaigns, claimed: result.claimed, sent: result.sent,
              failed: result.failed, retried: result.retried,
            })
            : "—"}
        </Metric>
        <Metric helpId="schedLastError" label={t("tp.sched.error")}>
          <span className="break-words">{last?.error ?? "—"}</span>
        </Metric>
      </MetricList>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          applyInterval();
        }}
        noValidate
      >
        <Field
          helpId="schedInterval" htmlFor={`${id}-interval`} label={t("tp.sched.interval")}
          hint={t("tp.sched.intervalHint", { min: TEST_LIMITS.schedulerInterval.min, max: TEST_LIMITS.schedulerInterval.max })}
        >
          <div className="flex items-center gap-2">
            <input
              id={`${id}-interval`} className="input max-w-24" inputMode="numeric" value={draft}
              onChange={(e) => setTyped(e.target.value)} onBlur={applyInterval}
              aria-invalid={problem !== null} {...helpProps("schedInterval")}
            />
            <span className="hint">{t("tp.unit.seconds")}</span>
          </div>
        </Field>
        {problem ? <div className="mt-1"><Notice kind="error">{problem}</Notice></div> : null}
      </form>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <ActionButton helpId="schedStart" tour="sched-start" disabled={running || busy !== null} busy={busy === "sched.start"}
          onClick={() => void run("sched.start", () => panelApi.scheduler({ action: "start" }), { notice: () => t("tp.sched.startDone") })}>
          {t("tp.sched.start")}
        </ActionButton>
        <ActionButton helpId="schedStop" tour="sched-stop" disabled={!running || busy !== null} busy={busy === "sched.stop"}
          onClick={() => void run("sched.stop", () => panelApi.scheduler({ action: "stop" }), { notice: () => t("tp.sched.stopDone") })}>
          {t("tp.sched.stop")}
        </ActionButton>
        <ActionButton helpId="schedRunNow" primary tour="sched-run" disabled={busy !== null || (scheduler?.cycleInFlight ?? false)} busy={busy === "sched.run"} onClick={() => void runNow()}>
          {t("tp.sched.runNow")}
        </ActionButton>
      </div>
    </>
  );
}
