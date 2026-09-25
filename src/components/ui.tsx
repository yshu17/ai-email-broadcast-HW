"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { formatScheduledTime, getUserTimeZone } from "@/lib/scheduling";
import { getActiveLocale } from "@/i18n/active";
import { useLocale, useT } from "@/i18n/client";
import { formatDateTime } from "@/i18n/format";
import { LOCALE_HEADER, intlTag, type Locale } from "@/i18n/locale";
import { hasMessage, translate } from "@/i18n/translate";

/* ------------------------------------------------------------------ fetch */

export class ApiError extends Error {
  /** `code` and `field` are present on structured validation errors. */
  constructor(readonly status: number, message: string, readonly code?: string, readonly field?: string) {
    super(message);
  }
}

/** JSON fetch wrapper that surfaces the API's error message verbatim. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof FormData) ? { "content-type": "application/json" } : {}),
      // So the server words its error messages in the language on screen.
      [LOCALE_HEADER]: getActiveLocale(),
      ...init?.headers,
    },
  });

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    // Not on the sign-in page itself: there a 401 only means "wrong password", and
    // reloading it would throw the error message away before it could be read.
    if (response.status === 401 && typeof window !== "undefined" && window.location.pathname !== "/login") {
      // A full navigation, not a router push: the session is gone, so every
      // piece of cached client state should go with it.
      window.location.assign(new URL("/login", window.location.origin).href);
    }
    throw new ApiError(
      response.status,
      payload?.error ?? translate(getActiveLocale(), "error.requestStatus", { status: response.status }),
      payload?.code,
      payload?.field,
    );
  }
  return payload as T;
}

/* --------------------------------------------------------------- feedback */

export function Alert({ kind, children }: { kind: "error" | "success" | "info"; children: React.ReactNode }) {
  const styles = {
    error: "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
    success:
      "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
    info: "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300",
  }[kind];
  return <div className={`rounded-lg border px-3 py-2 text-sm ${styles}`} role="status">{children}</div>;
}

export function Spinner({ label }: { label?: string }) {
  const { t } = useT();
  return <p className="text-sm" style={{ color: "var(--color-muted)" }}>{label ?? t("common.loading")}</p>;
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="card px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children ? <div className="mt-2 text-sm" style={{ color: "var(--color-muted)" }}>{children}</div> : null}
    </div>
  );
}

/* ----------------------------------------------------------------- badges */

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "text-zinc-600 dark:text-zinc-300",
  SCHEDULED: "text-indigo-700 dark:text-indigo-400",
  QUEUED: "text-amber-700 dark:text-amber-400",
  SENDING: "text-blue-700 dark:text-blue-400",
  COMPLETED: "text-emerald-700 dark:text-emerald-400",
  PAUSED: "text-orange-700 dark:text-orange-400",
  CANCELLED: "text-zinc-500 dark:text-zinc-400",
  SENT: "text-emerald-700 dark:text-emerald-400",
  FAILED: "text-red-700 dark:text-red-400",
  SUPPRESSED: "text-purple-700 dark:text-purple-400",
};

export function StatusBadge({ status }: { status: string }) {
  const { t } = useT();
  const key = `status.${status}`;
  return <span className={`badge ${STATUS_COLORS[status] ?? ""}`}>{hasMessage(key) ? t(key) : status}</span>;
}

/* ------------------------------------------------------------------ modal */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal dialog. Focus moves into it when it opens (to the element marked
 * `data-autofocus` if there is one — put it on the safe choice of a destructive
 * dialog), Tab stays inside it, and focus returns to whatever opened it on close.
 */
export function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { t } = useT();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    // Respect an input that already grabbed focus with `autoFocus`.
    if (panel && !panel.contains(document.activeElement)) {
      (panel.querySelector<HTMLElement>("[data-autofocus]") ?? panel).focus();
    }
    return () => opener?.focus();
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="card w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-b-none outline-none sm:rounded-xl"
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 id={titleId} className="font-semibold">{title}</h2>
          <button className="btn px-2 py-1" onClick={onClose} aria-label={t("common.close")}>✕</button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- formatting */

/**
 * A date and time, in `locale`'s wording when one is given (components pass the one on
 * screen), else the browser's.
 */
export function formatDate(value: string | Date | null | undefined, locale?: Locale): string {
  if (locale) return formatDateTime(value, locale);
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/**
 * A scheduled moment, in the viewer's locale and time zone with the zone's short
 * name beside it. The machine-readable UTC instant is in `dateTime`, and the full
 * zone name and the UTC instant are in the tooltip. Renders nothing when there is
 * no usable value, so no label is ever left pointing at an empty time.
 *
 * `locale` and `timeZone` default to the browser's; they exist so the output can
 * be pinned in tests.
 */
export function ScheduledTime({
  value, locale, timeZone,
}: { value: string | Date | null | undefined; locale?: string; timeZone?: string }) {
  const screen = useLocale();
  const tag = locale ?? intlTag(screen);
  const text = formatScheduledTime(value, { locale: tag, timeZone });
  if (text === null || value === null || value === undefined) return null;
  const utc = (typeof value === "string" ? new Date(value) : value).toISOString();
  return (
    <time dateTime={utc} title={`${timeZone ?? getUserTimeZone()} · ${utc} (UTC)`} suppressHydrationWarning>
      {text}
    </time>
  );
}

export function formatPercent(ratio: number, locale: Locale = "en"): string {
  return new Intl.NumberFormat(intlTag(locale), {
    style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1,
  }).format(ratio);
}

export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/* ----------------------------------------------------------------- data */

export type Loader<T> = {
  data: T | null;
  error: string | null;
  /** Refetch, e.g. after a mutation. */
  reload: () => void;
  setError: (message: string | null) => void;
  /** Show a known change at once, without waiting for `reload` to bring the server's view. */
  setData: (update: (current: T | null) => T | null) => void;
};

/**
 * Fetch-on-mount with stale-while-revalidating and unmount cancellation.
 *
 * The async work lives in a closure inside the effect so no state is set
 * synchronously during the effect body, and a late response from a superseded
 * request can never overwrite fresher data.
 *
 * `load` must be memoized by the caller (useCallback); its identity is the
 * dependency that drives refetching.
 */
export function useLoader<T>(load: () => Promise<T>): Loader<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await load();
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : translate(getActiveLocale(), "error.request"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, reload, setError, setData };
}

