"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n/translate";
import { TEST_LIMITS } from "@/lib/testing/limits";
import HelpIcon from "./HelpIcon";
import { describeEvent } from "./events";
import { usePanel } from "./panel-context";
import { ActionButton, Metric, MetricList, helpProps, useClockFormat, useTimeFormat } from "./panel-ui";

/**
 * "Journal": what the scheduler, the queue and the rate limiter reported lately, newest at the
 * bottom. "Clear view" hides what is on screen and nothing else: the server keeps its record, and
 * whatever happens next still appears.
 */
export default function JournalSection({
  autoRefresh, onAutoRefresh,
}: { autoRefresh: boolean; onAutoRefresh: (on: boolean) => void }) {
  const { t } = useT();
  const panel = usePanel();
  const time = useTimeFormat();
  const format = useClockFormat();
  const id = useId();

  const [clearedBefore, setClearedBefore] = useState(0);
  const visible = useMemo(() => panel.events.filter((event) => event.id > clearedBefore), [panel.events, clearedBefore]);
  const names = useMemo(
    () => new Map((panel.snapshot?.campaigns ?? []).map((campaign) => [campaign.id, campaign.name])),
    [panel.snapshot?.campaigns],
  );

  // Keep the newest entry in view, unless the person has scrolled up to read.
  const list = useRef<HTMLOListElement>(null);
  const stuck = useRef(true);
  useEffect(() => {
    const element = list.current;
    if (element && stuck.current) element.scrollTop = element.scrollHeight;
  }, [visible.length]);

  return (
    <>
      <MetricList>
        <Metric helpId="journalEntry" label={t("tp.journal.entries")}>
          {t("tp.journal.count", { count: visible.length })}
        </Metric>
        <Metric helpId="journalLimit" label={t("tp.journal.limit")}>
          {t("tp.journal.limitValue", { show: TEST_LIMITS.eventLog.show })}
        </Metric>
      </MetricList>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <ActionButton helpId="journalRefresh" onClick={() => void panel.refresh()} disabled={panel.busy !== null}>
          {t("tp.journal.refresh")}
        </ActionButton>
        <span className="inline-flex items-center">
          <label className="flex items-center gap-2 text-xs" htmlFor={`${id}-auto`}>
            <input id={`${id}-auto`} type="checkbox" checked={autoRefresh} onChange={(e) => onAutoRefresh(e.target.checked)} {...helpProps("journalAuto")} />
            {t("tp.journal.auto")}
          </label>
          <HelpIcon id="journalAuto" />
        </span>
        <ActionButton helpId="journalClear" onClick={() => setClearedBefore(panel.events[panel.events.length - 1]?.id ?? clearedBefore)} disabled={visible.length === 0}>
          {t("tp.journal.clear")}
        </ActionButton>
      </div>

      {visible.length === 0 ? (
        <p className="hint">{t("tp.journal.empty")}</p>
      ) : (
        <ol
          ref={list}
          className="max-h-72 overflow-y-auto rounded-md border text-xs"
          aria-label={t("tp.journal.label")}
          tabIndex={0}
          onScroll={(e) => {
            const el = e.currentTarget;
            stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
          data-testid="journal"
        >
          {visible.map((event) => (
            <li key={event.id} className="grid gap-0.5 border-b px-2 py-1.5 last:border-0">
              <span className="flex flex-wrap items-center gap-x-2">
                <time dateTime={event.at} className="tabular-nums">{time(event.at)}</time>
                <span className="badge !px-1.5 !py-0">{t(`tp.source.${event.source}` as MessageKey)}</span>
                {event.effectiveAt ? (
                  <span className="hint">{t("tp.journal.testTime", { time: format(event.effectiveAt) })}</span>
                ) : null}
              </span>
              <span className="break-words">
                {describeEvent(event, t, { name: event.campaignId ? names.get(event.campaignId) : undefined, when: format })}
              </span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
