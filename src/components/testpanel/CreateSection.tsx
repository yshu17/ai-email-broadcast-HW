"use client";

import { useId, useMemo, useState } from "react";
import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n/translate";
import { getUserTimeZone, scheduleFieldsFor, toScheduledAt } from "@/lib/scheduling";
import { scheduleMessage } from "@/components/ScheduleFields";
import { SMTP_SCENARIOS, TEST_LIMITS, type SmtpScenario } from "@/lib/testing/limits";
import type { HelpId } from "@/lib/testing/help";
import { TEST_TEMPLATES, type SendMode, type TestTemplate } from "@/lib/testing/templates";
import { panelApi } from "./api";
import { usePanel } from "./panel-context";
import { ActionButton, Field, Notice, helpProps } from "./panel-ui";
import { integerProblem, isKnownTimeZone, knownTimeZones } from "./validation";

const TEMPLATE_HELP: Record<string, HelpId> = {
  in1min: "tplIn1min", in5min: "tplIn5min", overdue5min: "tplOverdue5min", bigRate: "tplBigRate",
  tempFail: "tplTempFail", permFail: "tplPermFail", slowSmtp: "tplSlowSmtp",
};

/**
 * "Create Test Campaign": a small form, and ready-made templates that only fill it in. Pressing
 * Create makes a campaign of made-up recipients (no address is ever typed), which then goes
 * down the ordinary road: scheduler, queue, rate limiter, retry rules.
 */
export default function CreateSection() {
  const { t } = useT();
  const panel = usePanel();
  const { run, busy } = panel;
  const id = useId();
  const zones = useMemo(() => knownTimeZones(), []);
  const userZone = useMemo(() => getUserTimeZone(), []);

  const [name, setName] = useState("");
  const [recipients, setRecipients] = useState(String(TEST_LIMITS.recipients.default));
  const [mode, setMode] = useState<SendMode>("now");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [zone, setZone] = useState(userZone);
  const [scenario, setScenario] = useState<SmtpScenario>("success");
  const [slowDelay, setSlowDelay] = useState(String(TEST_LIMITS.slowDelaySeconds.default));
  const [tempFailures, setTempFailures] = useState(String(TEST_LIMITS.temporaryFailures.default));
  const [overdue, setOverdue] = useState(String(TEST_LIMITS.overdueMinutes.default));
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  // A schedule starts on a sensible default: five minutes after the application's own time.
  const fillSchedule = (minutes: number, timeZone = zone) => {
    const fields = scheduleFieldsFor(new Date(panel.effectiveNow().getTime() + minutes * 60_000), isKnownTimeZone(timeZone) ? timeZone : userZone);
    setDate(fields.date);
    setTime(fields.time);
  };
  const applyTemplate = (template: TestTemplate) => {
    setErrors({});
    setMode(template.mode);
    setScenario(template.scenario);
    setRecipients(String(template.recipients));
    if (template.slowDelaySeconds !== undefined) setSlowDelay(String(template.slowDelaySeconds));
    if (template.temporaryFailures !== undefined) setTempFailures(String(template.temporaryFailures));
    if (template.overdueMinutes !== undefined) setOverdue(String(template.overdueMinutes));
    if (template.mode === "schedule") fillSchedule(template.offsetMinutes ?? 5);
  };

  const create = () => {
    const found: Record<string, string | null> = {
      recipients: integerProblem(t, "recipients", recipients, "label.Recipients"),
      slow: scenario === "slow" ? integerProblem(t, "slowDelaySeconds", slowDelay, "label.Slow response delay") : null,
      temp: scenario === "tempfail" ? integerProblem(t, "temporaryFailures", tempFailures, "label.Temporary failures") : null,
      overdue: mode === "overdue" ? integerProblem(t, "overdueMinutes", overdue, "label.Overdue by") : null,
      when: null,
    };
    if (mode === "schedule") {
      if (!isKnownTimeZone(zone)) found.when = t("err.test.timeZone");
      else {
        // Judged against the application's own time, exactly as the server will judge it.
        const check = toScheduledAt(date, time, panel.effectiveNow(), { timeZone: zone });
        if (!check.ok) found.when = scheduleMessage(t, check);
      }
    }
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;

    void run("create", () => panelApi.createCampaign({
      name: name.trim() || undefined,
      recipients: Number(recipients),
      mode,
      scenario,
      ...(mode === "schedule" ? { date, time, timeZone: zone } : {}),
      ...(scenario === "slow" ? { slowDelaySeconds: Number(slowDelay) } : {}),
      ...(scenario === "tempfail" ? { temporaryFailures: Number(tempFailures) } : {}),
      ...(mode === "overdue" ? { overdueMinutes: Number(overdue) } : {}),
    }), {
      notice: (created) => {
        panel.selectCampaign(created.campaign.id);
        panel.openSection("campaigns");
        return t("tp.create.done", { name: created.campaign.name });
      },
    });
  };

  const zoneListId = `${id}-zones`;

  return (
    <>
      <div className="grid gap-1" data-tour="create-templates">
        <p className="label !mb-1">{t("tp.create.templates")}</p>
        <div className="flex flex-wrap gap-x-3 gap-y-2" role="group" aria-label={t("tp.create.templates")}>
          {TEST_TEMPLATES.map((template) => (
            <ActionButton key={template.id} helpId={TEMPLATE_HELP[template.id]} onClick={() => applyTemplate(template)}>
              {t(`tp.template.${template.id}` as MessageKey, {
                minutes: template.offsetMinutes ?? template.overdueMinutes ?? 0,
              })}
            </ActionButton>
          ))}
        </div>
      </div>

      <Field helpId="newName" htmlFor={`${id}-name`} label={t("tp.create.name")}>
        <input id={`${id}-name`} className="input" value={name} maxLength={TEST_LIMITS.campaignNameLength.max}
          placeholder={t("tp.create.namePlaceholder")} onChange={(e) => setName(e.target.value)} {...helpProps("newName")} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field helpId="newRecipients" htmlFor={`${id}-recipients`} label={t("tp.create.recipients")}>
          <input id={`${id}-recipients`} className="input" inputMode="numeric" value={recipients} aria-invalid={!!errors.recipients}
            onChange={(e) => setRecipients(e.target.value)} {...helpProps("newRecipients")} />
          {errors.recipients ? <Notice kind="error">{errors.recipients}</Notice> : null}
        </Field>
        <Field helpId="newMode" htmlFor={`${id}-mode`} label={t("tp.create.mode")}>
          <select
            id={`${id}-mode`} className="input" value={mode} {...helpProps("newMode")}
            onChange={(e) => {
              const next = e.target.value as SendMode;
              setMode(next);
              // Choosing a schedule starts it on a sensible default, from the application's own time.
              if (next === "schedule" && (!date || !time)) fillSchedule(5);
            }}
          >
            <option value="now">{t("tp.mode.now")}</option>
            <option value="schedule">{t("tp.mode.schedule")}</option>
            <option value="overdue">{t("tp.mode.overdue")}</option>
          </select>
        </Field>
      </div>

      {mode === "schedule" ? (
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field helpId="newDate" htmlFor={`${id}-date`} label={t("tp.create.date")}>
              <input id={`${id}-date`} className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} {...helpProps("newDate")} />
            </Field>
            <Field helpId="newTime" htmlFor={`${id}-time`} label={t("tp.create.time")}>
              <input id={`${id}-time`} className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} {...helpProps("newTime")} />
            </Field>
          </div>
          <Field helpId="newTimeZone" htmlFor={`${id}-zone`} label={t("tp.create.zone")}>
            <input id={`${id}-zone`} className="input" list={zoneListId} value={zone} spellCheck={false} autoComplete="off"
              onChange={(e) => setZone(e.target.value)} {...helpProps("newTimeZone")} />
            <datalist id={zoneListId}>{zones.map((zoneName) => <option key={zoneName} value={zoneName} />)}</datalist>
          </Field>
          {errors.when ? <Notice kind="error">{errors.when}</Notice> : null}
        </div>
      ) : null}

      {mode === "overdue" ? (
        <Field helpId="newOverdueMinutes" htmlFor={`${id}-overdue`} label={t("tp.create.overdue")}>
          <div className="flex items-center gap-2">
            <input id={`${id}-overdue`} className="input max-w-28" inputMode="numeric" value={overdue} aria-invalid={!!errors.overdue}
              onChange={(e) => setOverdue(e.target.value)} {...helpProps("newOverdueMinutes")} />
            <span className="hint">{t("tp.unit.minutes")}</span>
          </div>
          {errors.overdue ? <Notice kind="error">{errors.overdue}</Notice> : null}
        </Field>
      ) : null}

      <Field helpId="newScenario" htmlFor={`${id}-scenario`} label={t("tp.create.scenario")}>
        <select id={`${id}-scenario`} className="input" value={scenario} onChange={(e) => setScenario(e.target.value as SmtpScenario)} {...helpProps("newScenario")}>
          {SMTP_SCENARIOS.map((value) => <option key={value} value={value}>{t(`tp.scenario.${value}` as const)}</option>)}
        </select>
      </Field>

      {scenario === "slow" ? (
        <Field helpId="newSlowDelay" htmlFor={`${id}-slow`} label={t("tp.create.slowDelay")}>
          <div className="flex items-center gap-2">
            <input id={`${id}-slow`} className="input max-w-28" inputMode="numeric" value={slowDelay} aria-invalid={!!errors.slow}
              onChange={(e) => setSlowDelay(e.target.value)} {...helpProps("newSlowDelay")} />
            <span className="hint">{t("tp.unit.seconds")}</span>
          </div>
          {errors.slow ? <Notice kind="error">{errors.slow}</Notice> : null}
        </Field>
      ) : null}

      {scenario === "tempfail" ? (
        <Field helpId="newTempFailures" htmlFor={`${id}-temp`} label={t("tp.create.tempFailures")}>
          <input id={`${id}-temp`} className="input max-w-28" inputMode="numeric" value={tempFailures} aria-invalid={!!errors.temp}
            onChange={(e) => setTempFailures(e.target.value)} {...helpProps("newTempFailures")} />
          {errors.temp ? <Notice kind="error">{errors.temp}</Notice> : null}
        </Field>
      ) : null}

      <div>
        <ActionButton helpId="newCreate" primary tour="create-button" disabled={busy !== null} busy={busy === "create"} onClick={create}>
          {t("tp.create.submit")}
        </ActionButton>
      </div>
    </>
  );
}
