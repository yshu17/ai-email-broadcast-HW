"use client";

import { useEffect, useState } from "react";
import { intlTag } from "@/i18n/locale";
import { useT } from "@/i18n/client";
import type { HelpId } from "@/lib/testing/help";
import type { SectionId } from "@/lib/testing/tour";
import HelpIcon, { helpSummaryId } from "./HelpIcon";

/**
 * The building blocks of the panel. Each one puts the `?` beside the thing it explains, and
 * connects the control to its help: the control carries `data-help-id` (which is how it is known
 * to have help) and `aria-describedby` pointing at the hidden sentence the help icon writes.
 */

/** Attributes a control gets so that it is tied to its help. */
export function helpProps(id: HelpId) {
  return { "data-help-id": id, "aria-describedby": helpSummaryId(id) } as const;
}

/** The current time, ticking. For the real clock's display only. */
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** A time with seconds in the viewer's zone: `15 Oct 2026, 10:25:07`. */
export function useClockFormat() {
  const { locale } = useT();
  return (value: Date | string | null | undefined): string => {
    if (value === null || value === undefined) return "—";
    const date = typeof value === "string" ? new Date(value) : value;
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat(intlTag(locale), { dateStyle: "medium", timeStyle: "medium" }).format(date);
  };
}

/** A time of day with seconds: `10:25:07`. */
export function useTimeFormat() {
  const { locale } = useT();
  return (value: Date | string | null | undefined): string => {
    if (value === null || value === undefined) return "—";
    const date = typeof value === "string" ? new Date(value) : value;
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat(intlTag(locale), { timeStyle: "medium" }).format(date);
  };
}

export function Section({
  id, title, open, onToggle, children, tour,
}: {
  id: SectionId;
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  tour?: string;
}) {
  const headingId = `tp-section-${id}`;
  return (
    <section className="border-b" aria-labelledby={headingId} data-section={id} data-tour={tour}>
      <h2 id={headingId} className="m-0 text-sm font-semibold">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-3 text-left"
          aria-expanded={open}
          aria-controls={`${headingId}-body`}
          data-panel-chrome
          onClick={onToggle}
        >
          <span>{title}</span>
          <span aria-hidden="true" style={{ color: "var(--color-muted)" }}>{open ? "▾" : "▸"}</span>
        </button>
      </h2>
      {open ? <div id={`${headingId}-body`} className="grid gap-3 px-4 pb-4">{children}</div> : null}
    </section>
  );
}

/** A labelled input, select or other control, with its `?`. */
export function Field({
  helpId, htmlFor, label, hint, children, tour,
}: {
  helpId: HelpId;
  htmlFor: string;
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  tour?: string;
}) {
  return (
    <div className="grid gap-1" data-field={helpId} data-tour={tour}>
      <div className="flex items-center">
        <label className="label !mb-0" htmlFor={htmlFor}>{label}</label>
        <HelpIcon id={helpId} />
      </div>
      {children}
      {hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

/** A figure the panel reports, with its `?`. */
export function Metric({
  helpId, label, children, tour,
}: {
  helpId: HelpId;
  label: string;
  children: React.ReactNode;
  tour?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm" data-metric={helpId} data-tour={tour}>
      <dt className="flex items-center text-xs" style={{ color: "var(--color-muted)" }}>
        {label}
        <HelpIcon id={helpId} />
      </dt>
      <dd className="m-0 text-right tabular-nums" aria-describedby={helpSummaryId(helpId)}>{children}</dd>
    </div>
  );
}

export function MetricList({ children, tour }: { children: React.ReactNode; tour?: string }) {
  return <dl className="grid gap-1.5 m-0" data-tour={tour}>{children}</dl>;
}

/** A button with its `?` beside it, not inside it: the help stays reachable while the button is disabled. */
export function ActionButton({
  helpId, children, onClick, disabled, busy, primary, danger, tour, type = "button",
}: {
  helpId: HelpId;
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  primary?: boolean;
  danger?: boolean;
  tour?: string;
  type?: "button" | "submit";
}) {
  const kind = primary ? "btn-primary tp-primary" : danger ? "btn-danger" : "";
  return (
    <span className="inline-flex items-center" data-tour={tour}>
      <button
        type={type}
        className={`btn px-2.5 py-1 text-xs ${kind}`}
        disabled={disabled}
        aria-busy={busy || undefined}
        onClick={onClick}
        {...helpProps(helpId)}
      >
        {children}
      </button>
      <HelpIcon id={helpId} />
    </span>
  );
}

/** A link that looks like a button, with its `?`. */
export function ActionLink({ helpId, href, children }: { helpId: HelpId; href: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center">
      <a className="btn px-2.5 py-1 text-xs" href={href} {...helpProps(helpId)}>{children}</a>
      <HelpIcon id={helpId} />
    </span>
  );
}

export function Notice({ kind, children }: { kind: "error" | "success" | "info"; children: React.ReactNode }) {
  const styles = {
    error: "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
    success: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
    info: "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300",
  }[kind];
  return (
    <p className={`rounded-md border px-3 py-2 text-xs ${styles}`} role={kind === "error" ? "alert" : "status"}>{children}</p>
  );
}
