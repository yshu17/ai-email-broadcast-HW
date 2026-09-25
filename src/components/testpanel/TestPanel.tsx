"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CancelScheduledDialog from "@/components/CancelScheduledDialog";
import RescheduleDialog from "@/components/RescheduleDialog";
import { Alert, Modal } from "@/components/ui";
import { useT } from "@/i18n/client";
import { intlTag } from "@/i18n/locale";
import { formatScheduledTime } from "@/lib/scheduling";
import type { JournalEntry } from "@/lib/testing/journal";
import { TEST_LIMITS } from "@/lib/testing/limits";
import type { TestPanelSnapshot } from "@/lib/testing/snapshot";
import { tourReducer, type SectionId, type TourAction } from "@/lib/testing/tour";
import CampaignsSection from "./CampaignsSection";
import ClockSection from "./ClockSection";
import CreateSection from "./CreateSection";
import GuideSection from "./GuideSection";
import HelpIcon from "./HelpIcon";
import JournalSection from "./JournalSection";
import QueueSection from "./QueueSection";
import SchedulerSection from "./SchedulerSection";
import Tour from "./Tour";
import { panelApi } from "./api";
import { HelpProvider, useHelpController } from "./help-context";
import { PanelProvider, type PanelContextValue } from "./panel-context";
import { ActionButton, Notice, Section } from "./panel-ui";
import { openUiSection, updateUiState, useUiState } from "./ui-state";

/** How often the panel asks the server how things stand: quickly while it is open. */
const POLL_OPEN_MS = 2500;
const POLL_CLOSED_MS = 8000;

/**
 * The developer test panel: a floating "Test Panel" button, a banner that says test mode is on,
 * and a drawer on the right with the test clock, the scheduler, the queue and rate limit, a form
 * for test campaigns, the selected campaign, the event journal and the guides.
 *
 * It is mounted only by the admin layout, and only where the server says the test tools exist
 * (a development or test environment with the flag on); every call it makes goes to a test-only
 * API that refuses outside that. It keeps in this browser only preferences about itself.
 */
export default function TestPanel() {
  const { t, locale } = useT();
  const help = useHelpController();
  const ui = useUiState();

  /* ------------------------------------------------------------ what the server says */
  const [snapshot, setSnapshot] = useState<TestPanelSnapshot | null>(null);
  const [events, setEvents] = useState<JournalEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const cursor = useRef(0);

  const refreshWith = useCallback(async (withEvents: boolean) => {
    try {
      // "Nothing newer than this" is how a poll that does not want events says so.
      const fresh = await panelApi.state(withEvents ? cursor.current : Number.MAX_SAFE_INTEGER);
      setSnapshot(fresh);
      setLoadError(null);
      if (withEvents && fresh.events.length > 0) {
        cursor.current = fresh.events[fresh.events.length - 1].id;
        setEvents((previous) => [...previous, ...fresh.events].slice(-TEST_LIMITS.eventLog.show));
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t("tp.error.generic"));
    }
  }, [t]);
  const refresh = useCallback(() => refreshWith(true), [refreshWith]);

  useEffect(() => {
    void refreshWith(ui.open && ui.autoRefresh);
    const timer = setInterval(() => void refreshWith(ui.open && ui.autoRefresh), ui.open ? POLL_OPEN_MS : POLL_CLOSED_MS);
    return () => clearInterval(timer);
  }, [ui.open, ui.autoRefresh, refreshWith]);

  /* ---------------------------------------------------------------- doing things */
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback<PanelContextValue["run"]>(async (key, action, options) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const result = await action();
      const message = options?.notice?.(result);
      if (message) setNotice(message);
      await refreshWith(true);
      return result;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("tp.error.generic"));
      return undefined;
    } finally {
      setBusy(null);
    }
  }, [refreshWith, t]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState<{ id: string; name: string; scheduledAt: string | null } | null>(null);
  const [cancelling, setCancelling] = useState<{ id: string; name: string; scheduledAt: string | null } | null>(null);
  const [resetting, setResetting] = useState<{ id: string; name: string } | null>(null);
  const [resetBusy, setResetBusy] = useState(false);

  const effectiveNow = useCallback(
    () => (snapshot?.clock.mode === "fixed" ? new Date(snapshot.clock.effectiveNow) : new Date()),
    [snapshot],
  );

  /* ------------------------------------------------------------------- the tour */
  // Whether it is showing is local; the step is remembered, so it can be picked up again.
  const [tourOpen, setTourOpen] = useState(false);
  const tourButton = useRef<HTMLElement | null>(null);
  const tourStep = ui.tourStep;
  const stepTour = useCallback((action: TourAction) => {
    const next = tourReducer({ open: true, step: tourStep }, action);
    setTourOpen(next.open);
    updateUiState({ tourStep: next.step });
  }, [tourStep]);
  const closeTour = useCallback(() => {
    setTourOpen(false);
    tourButton.current?.focus();
  }, []);

  /* -------------------------------------------------------- opening and closing */
  const toggleButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const setOpen = useCallback((open: boolean) => {
    updateUiState({ open });
    if (!open) toggleButton.current?.focus();
    // A person who opens the panel lands on its title, so a keyboard user starts inside it.
    else queueMicrotask(() => heading.current?.focus());
  }, []);

  const onDrawerKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "Escape") return;
    // Escape belongs to whatever is on top: a help popover first, then the tour, then the drawer.
    if (help.openKey) {
      event.stopPropagation();
      help.close({ restoreFocus: true });
      return;
    }
    if (tourOpen) return;
    setOpen(false);
  };

  const context = useMemo<PanelContextValue>(() => ({
    snapshot, events, refresh, run, busy, notice, error,
    clearMessages: () => { setNotice(null); setError(null); },
    selectedId, selectCampaign: setSelectedId, effectiveNow,
    requestReschedule: setRescheduling, requestCancel: setCancelling, requestReset: setResetting,
    openSection: openUiSection,
  }), [snapshot, events, refresh, run, busy, notice, error, selectedId, effectiveNow]);

  const toggleSection = (id: SectionId) => updateUiState({ sections: { ...ui.sections, [id]: !ui.sections[id] } });
  const held = snapshot?.clock.mode === "fixed";
  const limited = snapshot?.rate.source === "test";

  return (
    <HelpProvider controller={help}>
      <PanelProvider value={context}>
        {/* The banner: visible whether or not the drawer is open. */}
        <div className="test-banner px-4 py-1.5 text-xs" role="status" data-testid="test-banner">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1">
            <span className="test-chip">{t("tp.banner.chip")}</span>
            <HelpIcon id="testMode" instance="banner" />
            <span>{t("tp.banner.text")}</span>
            {held && snapshot ? (
              <strong>{t("tp.banner.clock", { time: formatScheduledTime(snapshot.clock.effectiveNow, { locale: intlTag(locale) }) ?? "" })}</strong>
            ) : null}
            {limited && snapshot ? (
              <strong>{t("tp.banner.rate", { max: snapshot.rate.maxEmails, seconds: snapshot.rate.windowSeconds })}</strong>
            ) : null}
          </div>
        </div>

        <button
          ref={toggleButton}
          type="button"
          className="btn btn-primary tp-primary fixed bottom-4 right-4 z-40 shadow-lg"
          aria-expanded={ui.open}
          aria-controls="test-panel"
          data-panel-chrome
          onClick={() => setOpen(!ui.open)}
        >
          <span aria-hidden="true">🧪</span> {t("tp.toggle")}
          {held || limited ? <span className="sr-only"> ({t("tp.banner.chip")})</span> : null}
        </button>

        {ui.open ? (
          <aside
            id="test-panel"
            data-testid="test-panel"
            aria-label={t("tp.title")}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-full flex-col border-l shadow-2xl sm:w-[28rem]"
            style={{ backgroundColor: "var(--color-surface)" }}
            onKeyDown={onDrawerKeyDown}
          >
            <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
              <h1 ref={heading} tabIndex={-1} className="m-0 text-base font-semibold outline-none">{t("tp.title")}</h1>
              <span className="test-chip">{t("tp.banner.chip")}</span>
              <HelpIcon id="testMode" instance="drawer" />
              <button type="button" className="btn ml-auto px-2 py-1 text-xs" aria-label={t("tp.close")} data-panel-chrome onClick={() => setOpen(false)}>
                <span aria-hidden="true">✕</span>
              </button>
              <div className="basis-full">
                <span ref={(node) => { tourButton.current = node?.querySelector("button") ?? null; }} className="inline-flex">
                  <ActionButton helpId="tourButton" primary onClick={() => stepTour({ type: "start" })}>
                    {t("tour.title")}
                  </ActionButton>
                </span>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-testid="test-panel-body">
              {loadError ? <div className="p-4"><Alert kind="error">{loadError}</Alert></div> : null}
              {error ? <div className="px-4 pt-3"><Notice kind="error">{error}</Notice></div> : null}
              {notice ? <div className="px-4 pt-3"><Notice kind="success">{notice}</Notice></div> : null}

              <Section id="clock" title={t("tp.section.clock")} open={ui.sections.clock} onToggle={() => toggleSection("clock")}>
                <ClockSection advanceStep={ui.advanceStep} onAdvanceStep={(step) => updateUiState({ advanceStep: step })} />
              </Section>
              <Section id="scheduler" title={t("tp.section.scheduler")} open={ui.sections.scheduler} onToggle={() => toggleSection("scheduler")}>
                <SchedulerSection />
              </Section>
              <Section id="queue" title={t("tp.section.queue")} open={ui.sections.queue} onToggle={() => toggleSection("queue")}>
                <QueueSection />
              </Section>
              <Section id="create" title={t("tp.section.create")} open={ui.sections.create} onToggle={() => toggleSection("create")}>
                <CreateSection />
              </Section>
              <Section id="campaigns" title={t("tp.section.campaigns")} open={ui.sections.campaigns} onToggle={() => toggleSection("campaigns")}>
                <CampaignsSection />
              </Section>
              <Section id="journal" title={t("tp.section.journal")} open={ui.sections.journal} onToggle={() => toggleSection("journal")}>
                <JournalSection autoRefresh={ui.autoRefresh} onAutoRefresh={(on) => updateUiState({ autoRefresh: on })} />
              </Section>
              <Section id="guides" title={t("tp.section.guides")} open={ui.sections.guides} onToggle={() => toggleSection("guides")}>
                <GuideSection />
              </Section>
            </div>
          </aside>
        ) : null}

        {rescheduling ? (
          <RescheduleDialog
            campaign={rescheduling}
            now={effectiveNow()}
            onClose={() => setRescheduling(null)}
            onStale={() => void refresh()}
            onRescheduled={({ name, scheduledAt }) => {
              setRescheduling(null);
              setNotice(t("reschedule.notice", { name, when: formatScheduledTime(scheduledAt, { locale: intlTag(locale) }) ?? "" }));
              void refresh();
            }}
          />
        ) : null}

        {cancelling ? (
          <CancelScheduledDialog
            campaign={cancelling}
            onClose={() => setCancelling(null)}
            onStale={() => void refresh()}
            onCancelled={({ name }) => {
              setCancelling(null);
              setNotice(t("campaigns.cancelledNotice", { name }));
              void refresh();
            }}
          />
        ) : null}

        {resetting ? (
          <Modal open title={t("tp.reset.title")} onClose={() => (resetBusy ? undefined : setResetting(null))}>
            <div className="grid gap-3 text-sm">
              <p>{t("tp.reset.body", { name: resetting.name })}</p>
              <div className="flex flex-wrap gap-2">
                <button className="btn" data-autofocus disabled={resetBusy} onClick={() => setResetting(null)}>{t("common.cancel")}</button>
                <button
                  className="btn btn-danger" disabled={resetBusy} aria-busy={resetBusy}
                  onClick={async () => {
                    const target = resetting;
                    setResetBusy(true);
                    await run("reset", () => panelApi.resetCampaign(target.id), {
                      notice: (result) => t("tp.reset.done", { name: target.name, contacts: result.removedContacts }),
                    });
                    setResetBusy(false);
                    setResetting(null);
                    if (selectedId === target.id) setSelectedId(null);
                  }}
                >
                  {resetBusy ? t("tp.reset.working") : t("tp.reset.confirm")}
                </button>
              </div>
            </div>
          </Modal>
        ) : null}

        <Tour
          open={tourOpen}
          step={tourStep}
          onNext={() => stepTour({ type: "next" })}
          onBack={() => stepTour({ type: "back" })}
          onClose={closeTour}
          onRestart={() => stepTour({ type: "restart" })}
          openSection={openUiSection}
        />
      </PanelProvider>
    </HelpProvider>
  );
}
