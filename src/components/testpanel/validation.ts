import type { Translator } from "@/i18n/client";
import type { MessageKey } from "@/i18n/translate";
import { checkInteger, limitBounds, type LimitId } from "@/lib/testing/limits";

/**
 * The browser's check of a numeric field, worded the way the server words the same refusal
 * (`err.test.range`, `err.test.required`), from the same limits. A number the form lets through is
 * a number the server accepts, and the other way round.
 */
export function integerProblem(
  t: Translator["t"],
  limit: LimitId,
  raw: unknown,
  labelKey: MessageKey,
): string | null {
  const check = checkInteger(limit, raw);
  if (check.ok) return null;
  const field = t(labelKey);
  if (check.code === "TEST_REQUIRED") return t("err.test.required", { field });
  const { min, max } = limitBounds(limit);
  return t("err.test.range", { field, min, max });
}

/** Whether `zone` is a time zone this browser knows. */
export function isKnownTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone.trim().length > 0;
  } catch {
    return false;
  }
}

/** Every IANA zone the browser knows, for the zone field's suggestions. Empty where it cannot say. */
export function knownTimeZones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
}
