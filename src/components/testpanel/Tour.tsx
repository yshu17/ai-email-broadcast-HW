"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n/translate";
import { TOUR_STEPS, tourParams, type SectionId } from "@/lib/testing/tour";

type Rect = { top: number; left: number; width: number; height: number };

const subscribeNever = () => () => undefined;

/**
 * "How to test scheduling": a walk through the panel, ten steps. It does not press anything: it
 * lights the element to use, says what to do and what to expect, and waits for the person to do
 * it and press Next. Leaving it (Close, or Escape) keeps the step, so it can be picked up again;
 * Restart goes back to the first.
 *
 * It opens the section a step needs and scrolls the element into view, so nothing is hidden.
 * The card is a region with a live step counter for screen readers, and every part of it is
 * reachable by keyboard.
 */
export default function Tour({
  open, step, onNext, onBack, onClose, onRestart, openSection,
}: {
  open: boolean;
  step: number;
  onNext: () => void;
  onBack: () => void;
  onClose: () => void;
  onRestart: () => void;
  openSection: (id: SectionId) => void;
}) {
  const { t } = useT();
  const uid = useId();
  const titleId = `${uid}-title`;
  const cardRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  // False while rendering on the server and hydrating, true after: a portal needs the page to exist.
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);

  const current = TOUR_STEPS[Math.min(step, TOUR_STEPS.length - 1)];
  const params = tourParams();

  // Bring the step's element into being and into view, and follow it as the layout settles.
  useEffect(() => {
    if (!open) return;
    openSection(current.section);
    let cancelled = false;

    const find = () => document.querySelector<HTMLElement>(`[data-tour="${current.target}"]`);
    const measure = () => {
      const element = find();
      if (!element || cancelled) return setRect(null);
      const box = element.getBoundingClientRect();
      setRect({ top: box.top, left: box.left, width: box.width, height: box.height });
    };

    const frame = requestAnimationFrame(() => {
      find()?.scrollIntoView?.({ block: "center", behavior: "smooth" });
      measure();
    });
    const timer = setInterval(measure, 300);
    window.addEventListener("resize", measure);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      clearInterval(timer);
      window.removeEventListener("resize", measure);
    };
  }, [open, current.section, current.target, openSection]);

  // A person who opens the tour lands on it; Escape leaves it.
  useEffect(() => {
    if (!open) return;
    cardRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !mounted) return null;
  // The measured box belongs to the step being shown; when the tour is shut it is not used.
  const shownRect = rect;

  const last = step >= TOUR_STEPS.length - 1;
  const key = (part: string) => `tour.step.${current.id}.${part}` as MessageKey;

  return createPortal(
    <>
      {shownRect ? (
        <div
          className="test-highlight"
          aria-hidden="true"
          data-testid="tour-highlight"
          style={{ top: shownRect.top - 4, left: shownRect.left - 4, width: shownRect.width + 8, height: shownRect.height + 8 }}
        />
      ) : null}
      <div
        ref={cardRef}
        role="region"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid="tour-card"
        className="card fixed inset-x-2 bottom-2 z-[71] grid gap-2 p-4 text-sm shadow-xl outline-none sm:inset-x-auto sm:bottom-4 sm:left-4 sm:w-96"
      >
        <p className="hint" role="status" aria-live="polite">
          {t("tour.stepOf", { n: step + 1, total: TOUR_STEPS.length })}
        </p>
        <h2 id={titleId} className="m-0 text-base font-semibold">{t(key("title"), params)}</h2>
        <p className="m-0">{t(key("body"), params)}</p>
        <p className="m-0 rounded-md border px-2 py-1.5">
          <strong>{t("tour.expected")}</strong> {t(key("expected"), params)}
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button type="button" className="btn px-2.5 py-1 text-xs" onClick={onBack} disabled={step === 0} data-panel-chrome>
            {t("tour.back")}
          </button>
          <button type="button" className="btn btn-primary tp-primary px-2.5 py-1 text-xs" onClick={onNext} data-panel-chrome>
            {t(last ? "tour.finish" : "tour.next")}
          </button>
          <button type="button" className="btn px-2.5 py-1 text-xs" onClick={onClose} data-panel-chrome>
            {t("tour.close")}
          </button>
          <button type="button" className="btn ml-auto px-2.5 py-1 text-xs" onClick={onRestart} data-panel-chrome>
            {t("tour.restart")}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
