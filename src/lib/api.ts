import { NextResponse } from "next/server";
import { HttpError, requireAdminMutation, requireUser } from "./auth";
import { getApiLocale } from "../i18n/server";
import type { Locale } from "../i18n/locale";
import { hasMessage, translate, type MessageKey, type Params } from "../i18n/translate";

export type Handler = () => Promise<NextResponse | Response>;

/** Uniform error shape; unexpected errors never leak internals to the client. */
export async function handle(fn: Handler): Promise<NextResponse | Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof HttpError) {
      const message = describeError(error, await getApiLocale());
      return NextResponse.json({ ...error.details, error: message }, { status: error.status });
    }
    const locale = await getApiLocale();
    // An id in the address that is not a uuid is a request for something that does not exist, not a fault.
    if (isInvalidUuidError(error)) {
      return NextResponse.json({ error: translate(locale, "err.notFound") }, { status: 404 });
    }
    // What went wrong goes to the log; the caller only learns that something did. A database or library
    // message can name tables, columns, hosts or users.
    console.error("[api]", error);
    return NextResponse.json({ error: translate(locale, "err.unexpected") }, { status: 500 });
  }
}

/** Postgres refused a value as a uuid (error 22P02), directly or wrapped by the query layer. */
function isInvalidUuidError(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current && typeof current === "object" && depth < 4; depth += 1) {
    if ((current as { code?: unknown }).code === "22P02") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Read-only admin endpoint. */
export function withAuth(fn: Handler) {
  return handle(async () => {
    await requireUser();
    return fn();
  });
}

/** Mutating admin endpoint: session + same-origin required. */
export function withAuthMutation(fn: Handler) {
  return handle(async () => {
    await requireAdminMutation();
    return fn();
  });
}

/**
 * The error's text in `locale`. A status or a field name inside the message is written
 * the way the interface writes it («В очереди», «Название рассылки»), so a Russian
 * message never contains an English label.
 */
function describeError(error: HttpError, locale: Locale): string {
  const params: Params | undefined = error.params && { ...error.params };
  if (params) {
    for (const [name, prefix] of [["status", "status"], ["field", "label"]] as const) {
      const value = params[name];
      if (typeof value === "string" && hasMessage(`${prefix}.${value}`)) {
        params[name] = translate(locale, `${prefix}.${value}` as MessageKey);
      }
    }
  }
  return translate(locale, error.key, params);
}

/** Every refusal names its message by key; `details` are merged into the JSON body (`code`, `field`). */
export function badRequest(key: MessageKey, params?: Params, details?: Record<string, unknown>): never {
  throw new HttpError(400, key, { params, details });
}

export function notFound(key: MessageKey = "err.notFound", params?: Params): never {
  throw new HttpError(404, key, { params });
}

export function conflict(key: MessageKey, params?: Params): never {
  throw new HttpError(409, key, { params });
}

/* --------------------------------------------------------- input helpers */

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return badRequest("err.json");
  }
}

export function str(value: unknown, field: string, options: { max?: number; required?: boolean } = {}): string {
  const { max = 500, required = true } = options;
  if (typeof value !== "string") {
    if (!required && (value === null || value === undefined)) return "";
    return badRequest("err.field.string", { field });
  }
  const trimmed = value.trim();
  if (required && trimmed.length === 0) return badRequest("err.field.required", { field });
  if (trimmed.length > max) return badRequest("err.field.tooLong", { field, max });
  return trimmed;
}

export function optionalStr(value: unknown, field: string, max = 500): string | null {
  if (value === null || value === undefined || value === "") return null;
  return str(value, field, { max });
}

export function int(value: unknown, field: string, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return badRequest("err.field.integer", { field });
  }
  if (parsed < min || parsed > max) return badRequest("err.field.range", { field, min, max });
  return parsed;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether `value` can be a uuid at all; asking Postgres about anything else is an error, not "no rows". */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function uuidList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) return badRequest("err.field.array", { field });
  const ids = value.map(String);
  if (ids.some((id) => !isUuid(id))) return badRequest("err.field.badId", { field });
  return [...new Set(ids)];
}

/** Clamped pagination, so a hostile `limit` can't scan the whole table. */
export function pagination(url: URL): { page: number; pageSize: number; offset: number } {
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get("pageSize") ?? 50) || 50));
  return { page, pageSize, offset: (page - 1) * pageSize };
}
