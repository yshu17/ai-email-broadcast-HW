"use client";

import { useId, useMemo, useState } from "react";
import { useT } from "@/i18n/client";
import { describeLocalTimeZone, getUserTimeZone, resolveWallClock, scheduleFieldsFor } from "@/lib/scheduling";
import { CLOCK_STEPS, TEST_LIMITS } from "@/lib/testing/limits";
import type { MessageKey } from "@/i18n/translate";
import { scheduleMessage } from "@/components/ScheduleFields";
import HelpIcon from "./HelpIcon";
import { panelApi } from "./api";
import { usePanel } from "./panel-context";
import { ActionButton, Field, Metric, MetricList, Notice, helpProps, useClockFormat, useNow } from "./panel-ui";
import { isKnownTimeZone, knownTimeZones } from "./validation";

/**
 * "Test Clock": shows the real time and the application's time, and holds, advances or releases
 * the latter. Nothing here touches the computer's clock: the server keeps the held time in memory
 * and only the scheduling rules read it.
 */
export default function ClockSection({
  advanceStep, onAdvanceStep,
}: { advanceStep: string; onAdvanceStep: (step: string) => void }) {
  const { t } = useT();
  const panel = usePanel();
  const { snapshot, run, busy } = panel;
  const format = useClockFormat();
  const now = useNow();
  const id = useId();
  const userZone = useMemo(() => getUserTimeZone(), []);

  const held = snapshot?.clock.mode === "fixed";
  // What the person chose on the radio; a held clock always shows the fixed form.
  const [choice, setChoice] = useState<"real" | "fixed">("real");
  const showFixed = held || choice === "fixed";
  const effective = held ? snapshot?.clock.effectiveNow : now;

  const release = () => {
    setChoice("real");
    if (held) void run("clock.reset", () => panelApi.clock({ action: "reset" }), { notice: () => t("tp.clock.resetDone") });
  };

  return (
    <>
      <MetricList>
        <Metric helpId="clockRealNow" label={t("tp.clock.realNow")}>{format(now)}</Metric>
        <Metric helpId="clockEffectiveNow" label={t("tp.clock.effectiveNow")}>{format(effective)}</Metric>
        <Metric helpId="clockUserZone" label={t("tp.clock.userZone")}>{describeLocalTimeZone(now, userZone)}</Metric>
        <Metric helpId="clockMode" label={t("tp.clock.mode")}>
          <span className={held ? "test-chip" : "badge"}>{t(held ? "tp.clock.modeFixed" : "tp.clock.modeReal")}</span>
        </Metric>
      </MetricList>

      <fieldset className="grid gap-1 border-0 p-0" data-tour="clock-mode">
        <legend className="sr-only">{t("tp.clock.modeLegend")}</legend>
        <div className="flex items-center">
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name={`${id}-mode`} checked={!showFixed} onChange={release} {...helpProps("clockModeReal")} />
            {t("tp.clock.real")}
          </label>
          <HelpIcon id="clockModeReal" />
        </div>
        <div className="flex items-center">
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name={`${id}-mode`} checked={showFixed} onChange={() => setChoice("fixed")} {...helpProps("clockModeFixed")} />
            {t("tp.clock.fixed")}
          </label>
          <HelpIcon id="clockModeFixed" />
        </div>
      </fieldset>

      {showFixed ? <FixedClockForm userZone={userZone} /> : null}

      <div className="flex flex-wrap items-end gap-x-3 gap-y-2" data-tour="clock-controls">
        <Field helpId="clockStep" htmlFor={`${id}-step`} label={t("tp.clock.step")} tour="clock-step">
          <select
            id={`${id}-step`} className="input !py-1 text-xs" value={advanceStep}
            onChange={(e) => onAdvanceStep(e.target.value)} {...helpProps("clockStep")}
          >
            {CLOCK_STEPS.map((step) => <option key={step.id} value={step.id}>{t(`tp.step.${step.id}` as MessageKey)}</option>)}
          </select>
        </Field>
        <ActionButton
          helpId="clockAdvance" tour="clock-advance" disabled={!held || busy !== null} busy={busy === "clock.advance"}
          onClick={() => void run("clock.advance", () => panelApi.clock({ action: "advance", step: advanceStep }), { notice: () => t("tp.clock.advanceDone") })}
        >
          {t("tp.clock.advance")}
        </ActionButton>
        <ActionButton helpId="clockReset" tour="clock-reset" disabled={!held || busy !== null} busy={busy === "clock.reset"} onClick={release}>
          {t("tp.clock.reset")}
        </ActionButton>
      </div>
    </>
  );
}

/**
 * The date, time and zone to hold the clock at. It starts on the moment the app is at now, in the
 * zone shown, so a change is a small one; the values are taken once, when the form appears.
 */
function FixedClockForm({ userZone }: { userZone: string }) {
  const { t } = useT();
  const panel = usePanel();
  const { run, busy } = panel;
  const format = useClockFormat();
  const id = useId();
  const zones = useMemo(() => knownTimeZones(), []);

  const [zone, setZone] = useState(userZone);
  const [fields, setFields] = useState(() => scheduleFieldsFor(panel.effectiveNow(), userZone));
  const [problem, setProblem] = useState<string | null>(null);

  const wall = fields.date && fields.time && isKnownTimeZone(zone) ? resolveWallClock(fields.date, fields.time, zone) : null;
  const preview = wall?.ok ? wall.candidates[0] : null;

  const set = () => {
    setProblem(null);
    if (!isKnownTimeZone(zone)) return setProblem(t("err.test.timeZone"));
    const resolved = resolveWallClock(fields.date, fields.time, zone);
    if (!resolved.ok) return setProblem(scheduleMessage(t, resolved));
    const year = resolved.candidates[0].getUTCFullYear();
    const { min, max } = TEST_LIMITS.clockYear;
    if (year < min || year > max) return setProblem(t("err.test.clockRange", { min, max }));
    void run("clock.set", () => panelApi.clock({ action: "set", date: fields.date, time: fields.time, timeZone: zone }), {
      notice: () => t("tp.clock.setDone"),
    });
  };

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Field helpId="clockDate" htmlFor={`${id}-date`} label={t("tp.clock.date")}>
          <input
            id={`${id}-date`} className="input" type="date" value={fields.date}
            onChange={(e) => setFields({ ...fields, date: e.target.value })}
            min={`${TEST_LIMITS.clockYear.min}-01-01`} max={`${TEST_LIMITS.clockYear.max}-12-31`}
            {...helpProps("clockDate")}
          />
        </Field>
        <Field helpId="clockTime" htmlFor={`${id}-time`} label={t("tp.clock.time")}>
          <input
            id={`${id}-time`} className="input" type="time" value={fields.time}
            onChange={(e) => setFields({ ...fields, time: e.target.value })} {...helpProps("clockTime")}
          />
        </Field>
      </div>
      <Field helpId="clockTimeZone" htmlFor={`${id}-zone`} label={t("tp.clock.zone")}>
        <input
          id={`${id}-zone`} className="input" list={`${id}-zones`} value={zone} spellCheck={false} autoComplete="off"
          onChange={(e) => setZone(e.target.value)} {...helpProps("clockTimeZone")}
        />
        <datalist id={`${id}-zones`}>{zones.map((name) => <option key={name} value={name} />)}</datalist>
      </Field>
      {preview ? (
        <p className="hint" aria-live="polite">{t("tp.clock.preview", { utc: preview.toISOString(), local: format(preview) })}</p>
      ) : null}
      {problem ? <Notice kind="error">{problem}</Notice> : null}
      <div>
        <ActionButton helpId="clockSet" primary tour="clock-set" onClick={set} disabled={busy !== null} busy={busy === "clock.set"}>
          {t("tp.clock.set")}
        </ActionButton>
      </div>
    </div>
  );
}
