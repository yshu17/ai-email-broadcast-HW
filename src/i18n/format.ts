import { intlTag, type Locale } from "./locale";
import { translate } from "./translate";

/** A moment as `24 сент. 2026 г., 22:25` / `Sep 24, 2026, 10:25 PM`, in the browser's time zone. */
export function formatDateTime(value: string | Date | null | undefined, locale: Locale): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(intlTag(locale), {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(intlTag(locale)).format(value);
}

/**
 * How long a send will take, in words: "about 2 hours" / "около 2 часов". The same
 * rounding the server's `formatDuration` uses, so English reads as it always did.
 */
export function describeDuration(seconds: number, locale: Locale): string {
  if (seconds <= 0) return translate(locale, "duration.lessThanMinute");
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours === 0) {
    return minutes <= 1 ? translate(locale, "duration.aboutMinute") : translate(locale, "duration.minutes", { count: minutes });
  }
  if (minutes === 0) return translate(locale, "duration.hours", { count: hours });
  return translate(locale, "duration.hoursMinutes", { hours, minutes });
}
