"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef } from "react";
import { useT } from "@/i18n/client";
import type { HelpId } from "@/lib/testing/help";
import { helpModel, type HelpModel } from "@/lib/testing/help-model";
import { useHelp } from "./help-context";
import { placePopover } from "./placement";

/** The id of the hidden sentence a control points its `aria-describedby` at. */
export function helpSummaryId(id: string, instance?: string): string {
  return `help-summary-${id}${instance ? `-${instance}` : ""}`;
}

const HOVER_OPEN_MS = 120;
const HOVER_CLOSE_MS = 180;

/**
 * The `?` button beside a field, figure or action, and the help it opens.
 *
 *  - A short thing gets a tooltip; anything more gets a popover with labelled parts (what it is,
 *    what it affects, unit, allowed values, recommended, when it applies, how long it lasts,
 *    what to watch for). The words come from `helpModel`, so they are the registry's, in the
 *    language on screen.
 *  - It opens on click or Enter/Space, and on hover with a mouse. Escape closes it and puts the
 *    focus back on the button; so does a click anywhere else (which leaves the focus where it went).
 *  - It never moves the form: the popover is placed by `position: fixed` next to the button,
 *    kept inside the window (see `placePopover`), and scrolls inside itself if it cannot fit.
 *  - Its text is also written, hidden, next to the button (`helpSummaryId`), so the control
 *    it belongs to can point at it and a screen reader reads it without anyone hovering.
 *
 * `instance` tells apart several icons for one id on a page (each of the nine scenario cards).
 */
export default function HelpIcon({ id, instance }: { id: HelpId; instance?: string }) {
  const { t, locale } = useT();
  const help = useHelp();
  const model = useMemo(() => helpModel(id, locale), [id, locale]);

  const key = instance ? `${id}:${instance}` : id;
  const isOpen = help.openKey === key;
  const uid = useId();
  const popoverId = `${uid}-popover`;

  const wrapperRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clearTimer, []);

  /* --- closing: Escape anywhere, a press outside --- */
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Give focus back only when it was on this icon or nowhere in particular; otherwise leave it be.
      const active = document.activeElement;
      const restoreFocus = active === document.body || !!wrapperRef.current?.contains(active);
      help.close({ restoreFocus });
    };
    const onPointerDown = (event: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) help.close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [isOpen, help]);

  const onClick = () => {
    clearTimer();
    if (isOpen && help.pinned) help.close();
    else help.open(key, buttonRef.current, true);
  };

  // Hover is for mice only: on a touch screen "hover" would open help by accident while scrolling.
  const onPointerEnter = (event: React.PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    clearTimer();
    if (isOpen) return;
    timer.current = setTimeout(() => help.open(key, buttonRef.current, false), HOVER_OPEN_MS);
  };
  const onPointerLeave = (event: React.PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    clearTimer();
    if (isOpen && !help.pinned) timer.current = setTimeout(() => help.close(), HOVER_CLOSE_MS);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      // The drawer must not also close: this Escape was for the help.
      event.stopPropagation();
      help.close({ restoreFocus: true });
    }
  };

  const tooltip = model.kind === "tooltip";

  return (
    <span
      ref={wrapperRef}
      className="help-anchor"
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onKeyDown={onKeyDown}
    >
      <button
        ref={buttonRef}
        type="button"
        className="help-icon"
        data-help-button={id}
        aria-label={t("help.ariaLabel", { topic: model.title })}
        aria-expanded={isOpen}
        aria-controls={isOpen ? popoverId : undefined}
        aria-haspopup={tooltip ? undefined : "dialog"}
        onClick={onClick}
      >
        <span aria-hidden="true">?</span>
      </button>
      <span id={helpSummaryId(id, instance)} className="sr-only">{model.summary}</span>
      {isOpen ? (
        <HelpPopover
          model={model} uid={uid} popoverId={popoverId} buttonRef={buttonRef}
          closeLabel={t("help.close")} onClose={() => help.close({ restoreFocus: true })}
        />
      ) : null}
    </span>
  );
}

/**
 * The open help. It exists only while it is open, so it starts hidden and unplaced each time, is
 * measured once it is in the page, and is then placed by writing its position straight to the
 * element (nothing to re-render, and no flash in the wrong place).
 */
function HelpPopover({
  model, uid, popoverId, buttonRef, closeLabel, onClose,
}: {
  model: HelpModel;
  uid: string;
  popoverId: string;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  closeLabel: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = `${uid}-title`;
  const tooltip = model.kind === "tooltip";

  useLayoutEffect(() => {
    const place = () => {
      const button = buttonRef.current;
      const popover = ref.current;
      if (!button || !popover) return;
      // Measured at its natural size: an earlier cap would make it look shorter than it is.
      popover.style.maxHeight = "";
      const placement = placePopover(
        button.getBoundingClientRect(),
        { width: popover.offsetWidth, height: popover.scrollHeight },
        { width: window.innerWidth, height: window.innerHeight },
      );
      popover.style.top = `${placement.top}px`;
      popover.style.left = `${placement.left}px`;
      popover.style.maxHeight = placement.maxHeight === null ? "" : `${placement.maxHeight}px`;
      popover.style.visibility = "visible";
      popover.dataset.placement = placement.placement;
    };
    place();
    window.addEventListener("resize", place);
    // Capture: the drawer's own scrolling does not reach `window`.
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [buttonRef, model]);

  return (
    <div
      ref={ref}
      id={popoverId}
      role={tooltip ? "tooltip" : "dialog"}
      aria-labelledby={tooltip ? undefined : titleId}
      className="help-popover"
      style={{ position: "fixed", top: 0, left: 0, visibility: "hidden" }}
    >
      {tooltip ? (
        <p className="help-tip"><strong>{model.title}.</strong> {model.summary}</p>
      ) : (
        <>
          <p id={titleId} className="help-title">{model.title}</p>
          <dl className="help-sections">
            {model.sections.map((section) => (
              <div key={section.key} className={section.key === "warning" ? "help-warning" : undefined}>
                <dt>{section.label}</dt>
                <dd>{section.text}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
      <button type="button" className="help-close" data-help-close aria-label={closeLabel} onClick={onClose}>
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  );
}
