import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "@/lib/db";
import { hashPassword } from "@/lib/crypto";
import {
  LOGIN_WINDOW_MS, MAX_FAILURES_PER_ACCOUNT, MAX_FAILURES_PER_ADDRESS,
  callerAddress, loginAllowed, recordLoginFailure, recordLoginSuccess, resetLoginThrottle,
} from "@/lib/login-throttle";
import { resetDatabase, withDatabaseDown } from "./helpers";

/**
 * What a caller must not be able to do or learn: guess passwords without limit, read an internal
 * error message, or find out anything from the health check.
 */
const cookieJar = vi.hoisted(() => ({ set: (() => undefined) as (...args: unknown[]) => void }));
const requestHeaders = vi.hoisted(() => ({ current: new Headers() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: (...args: unknown[]) => cookieJar.set(...args), delete: () => undefined }),
  headers: async () => requestHeaders.current,
}));

afterAll(() => sql.end({ timeout: 2 }));

beforeEach(async () => {
  resetLoginThrottle();
  requestHeaders.current = new Headers({ "x-forwarded-for": "203.0.113.7" });
  await resetDatabase();
});
afterEach(() => vi.restoreAllMocks());

describe("the sign-in throttle", () => {
  const T0 = 1_000_000;

  it("lets an account fail a few times, then refuses further tries", () => {
    for (let i = 0; i < MAX_FAILURES_PER_ACCOUNT - 1; i += 1) recordLoginFailure("admin@example.test", "198.51.100.1", T0);
    expect(loginAllowed("admin@example.test", "198.51.100.1", T0)).toBe(true);
    recordLoginFailure("admin@example.test", "198.51.100.1", T0);
    expect(loginAllowed("admin@example.test", "198.51.100.1", T0)).toBe(false);
  });

  it("counts an account whatever the case or spacing of its name, and from whichever address", () => {
    for (let i = 0; i < MAX_FAILURES_PER_ACCOUNT; i += 1) recordLoginFailure(` Admin@Example.test `, `10.0.0.${i}`, T0);
    expect(loginAllowed("admin@example.test", "192.0.2.99", T0)).toBe(false);
  });

  it("does not hold one account's failures against another", () => {
    for (let i = 0; i < MAX_FAILURES_PER_ACCOUNT; i += 1) recordLoginFailure("a@example.test", `10.0.0.${i}`, T0);
    expect(loginAllowed("b@example.test", "192.0.2.99", T0)).toBe(true);
  });

  it("stops one address from trying many accounts", () => {
    for (let i = 0; i < MAX_FAILURES_PER_ADDRESS; i += 1) recordLoginFailure(`user${i}@example.test`, "198.51.100.1", T0);
    expect(loginAllowed("fresh@example.test", "198.51.100.1", T0)).toBe(false);
    expect(loginAllowed("fresh@example.test", "198.51.100.2", T0)).toBe(true);
  });

  it("forgets after the window", () => {
    for (let i = 0; i < MAX_FAILURES_PER_ACCOUNT; i += 1) recordLoginFailure("admin@example.test", "198.51.100.1", T0);
    expect(loginAllowed("admin@example.test", "198.51.100.1", T0 + LOGIN_WINDOW_MS - 1)).toBe(false);
    expect(loginAllowed("admin@example.test", "198.51.100.1", T0 + LOGIN_WINDOW_MS)).toBe(true);
  });

  it("clears an account's count on a successful sign-in", () => {
    for (let i = 0; i < MAX_FAILURES_PER_ACCOUNT - 1; i += 1) recordLoginFailure("admin@example.test", "198.51.100.1", T0);
    recordLoginSuccess("admin@example.test");
    recordLoginFailure("admin@example.test", "198.51.100.1", T0);
    expect(loginAllowed("admin@example.test", "198.51.100.1", T0)).toBe(true);
  });

  it("takes the caller's address from the proxy header, or says unknown", () => {
    expect(callerAddress(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(callerAddress(new Headers({ "x-real-ip": "203.0.113.8" }))).toBe("203.0.113.8");
    expect(callerAddress(new Headers())).toBe("unknown");
  });
});

describe("POST /api/auth/login", () => {
  const attempt = async (email: string, password: string) => {
    const { POST } = await import("@/app/api/auth/login/route");
    return POST(new Request("https://mail.example.test/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    }));
  };

  beforeEach(async () => {
    await sql`INSERT INTO users (email, email_normalized, password_hash)
              VALUES ('admin@example.test', 'admin@example.test', ${hashPassword("correct horse battery")})`;
  });

  it("signs in with the right password", async () => {
    expect((await attempt("admin@example.test", "correct horse battery")).status).toBe(200);
  });

  it("refuses a wrong password with the same vague 401 for a known and an unknown account", async () => {
    const known = await attempt("admin@example.test", "wrong");
    const unknown = await attempt("nobody@example.test", "wrong");
    expect(known.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await known.json()).toEqual(await unknown.json());
  });

  it("answers 429 once an account has failed too often, even for the right password", async () => {
    for (let i = 0; i < MAX_FAILURES_PER_ACCOUNT; i += 1) {
      expect((await attempt("admin@example.test", `wrong ${i}`)).status).toBe(401);
    }

    const blocked = await attempt("admin@example.test", "correct horse battery");
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error).toBe("Too many failed sign-in attempts. Try again in a few minutes.");
  });

  it("does not let a successful sign-in be blocked by another account's failures", async () => {
    for (let i = 0; i < MAX_FAILURES_PER_ACCOUNT; i += 1) await attempt("someone-else@example.test", "wrong");
    expect((await attempt("admin@example.test", "correct horse battery")).status).toBe(200);
  });
});

describe("an unexpected error", () => {
  it("is reported to the caller without its message", async () => {
    const { handle } = await import("@/lib/api");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await handle(async () => {
      throw new Error('relation "users" does not exist (host db.internal, user mailer)');
    });

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: "Unexpected error" });
    expect(text).not.toMatch(/relation|users|mailer|db\.internal/);
    expect(log).toHaveBeenCalled(); // it is in the server's log, where it belongs
  });

  it("is a 404, not a 500, when the address holds something that is not a uuid", async () => {
    const { handle } = await import("@/lib/api");
    const invalid = Object.assign(new Error('invalid input syntax for type uuid: "abc"'), { code: "22P02" });

    const direct = await handle(async () => { throw invalid; });
    const wrapped = await handle(async () => { throw Object.assign(new Error("Failed query"), { cause: invalid }); });

    for (const response of [direct, wrapped]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Not found" });
    }
  });
});

describe("GET /api/health", () => {
  it("answers 200 and nothing else when the database is up", async () => {
    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("answers 503, with no reason, when the database cannot be reached", async () => {
    const { GET } = await import("@/app/api/health/route");
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await withDatabaseDown(() => GET());

    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ status: "unavailable" });
    expect(text).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|mailer/);
  });

  it("needs no session", async () => {
    const { GET } = await import("@/app/api/health/route");
    expect((await GET()).status).toBe(200);
  });
});

describe("the example secrets", () => {
  const PLACEHOLDER = "replace-me-with-openssl-rand-hex-32";

  it("are refused by a production server, and only by one", async () => {
    const { isPlaceholderSecret } = await import("@/lib/crypto");
    vi.stubEnv("NODE_ENV", "production");
    expect(isPlaceholderSecret(PLACEHOLDER)).toBe(true);
    expect(isPlaceholderSecret("REPLACE-ME-please")).toBe(true);
    expect(isPlaceholderSecret("d3b07384d113edec49eaa6238ad5ff00d3b07384d113edec49eaa6238ad5ff00")).toBe(false);
    expect(isPlaceholderSecret(undefined)).toBe(false);

    vi.stubEnv("NODE_ENV", "test");
    expect(isPlaceholderSecret(PLACEHOLDER)).toBe(false);
    vi.unstubAllEnvs();
  });

  it("cannot be the encryption key in production", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENCRYPTION_KEY", PLACEHOLDER);
    const { encryptSecret } = await import("@/lib/crypto");
    expect(() => encryptSecret("smtp password")).toThrow(/too short or still the example value/);
    vi.unstubAllEnvs();
  });

  it("cannot be the worker secret in production: the worker endpoint refuses even the matching bearer", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WORKER_SECRET", PLACEHOLDER);
    requestHeaders.current = new Headers({ authorization: `Bearer ${PLACEHOLDER}` });
    const { POST } = await import("@/app/api/worker/tick/route");

    expect((await POST()).status).toBe(401);
    vi.unstubAllEnvs();
  });
});
