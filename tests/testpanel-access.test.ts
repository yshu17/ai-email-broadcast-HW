import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "@/lib/db";
import { TEST_PANEL_FLAG, TestToolsDisabledError, testPanelEnabled } from "@/lib/testing/access";
import { GET as getState } from "@/app/api/dev/state/route.dev";
import { POST as postClock } from "@/app/api/dev/clock/route.dev";
import { POST as postScheduler } from "@/app/api/dev/scheduler/route.dev";
import { POST as postRate } from "@/app/api/dev/rate-limit/route.dev";
import { POST as postCampaign } from "@/app/api/dev/campaigns/route.dev";
import { DELETE as deleteCampaign, GET as getCampaign } from "@/app/api/dev/campaigns/[id]/route.dev";
import { clock, setFixedTime } from "@/lib/clock";
import { resetDatabase } from "./helpers";
import { ctx, disableTestTools, enableTestTools, jsonRequest } from "./testpanel-helpers";

/**
 * Who can reach the developer test tools. The rule: a development or test environment,
 * the flag set to exactly `true`, a signed-in admin, and (for a change) a request from this
 * site. Anything else gets the same 404 as an address the app does not have, so nothing
 * about the tools can be learned from outside.
 */
const session = vi.hoisted(() => ({ signedIn: true, crossOrigin: false }));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  const user = { id: "test-admin", email: "admin@example.test" };
  return {
    ...actual,
    requireUser: async () => {
      if (!session.signedIn) throw new actual.HttpError(401, "err.auth.required");
      return user;
    },
    requireAdminMutation: async () => {
      if (session.crossOrigin) throw new actual.HttpError(403, "err.origin.crossOrigin");
      if (!session.signedIn) throw new actual.HttpError(401, "err.auth.required");
      return user;
    },
    assertSameOrigin: async () => undefined,
  };
});

beforeEach(async () => {
  session.signedIn = true;
  session.crossOrigin = false;
  await resetDatabase();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  await disableTestTools();
  vi.restoreAllMocks();
});

afterAll(async () => { await sql.end(); });

const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

/** Every test-only endpoint, called in a way that would succeed (or fail on its own merits) for a permitted caller. */
const endpoints: { name: string; mutation: boolean; call: () => Promise<Response> }[] = [
  { name: "GET /api/dev/state", mutation: false, call: async () => getState(jsonRequest("GET")) as Promise<Response> },
  { name: "POST /api/dev/clock", mutation: true, call: async () => postClock(jsonRequest("POST", { action: "reset" })) as Promise<Response> },
  { name: "POST /api/dev/scheduler", mutation: true, call: async () => postScheduler(jsonRequest("POST", { action: "stop" })) as Promise<Response> },
  { name: "POST /api/dev/rate-limit", mutation: true, call: async () => postRate(jsonRequest("POST", { action: "reset" })) as Promise<Response> },
  { name: "POST /api/dev/campaigns", mutation: true, call: async () => postCampaign(jsonRequest("POST", {})) as Promise<Response> },
  { name: "GET /api/dev/campaigns/:id", mutation: false, call: async () => getCampaign(jsonRequest("GET"), ctx(UNKNOWN_ID)) as Promise<Response> },
  { name: "DELETE /api/dev/campaigns/:id", mutation: true, call: async () => deleteCampaign(jsonRequest("DELETE"), ctx(UNKNOWN_ID)) as Promise<Response> },
];

describe("when the test tools exist", () => {
  const cases: [string, Record<string, string | undefined>, boolean][] = [
    ["development, flag true", { NODE_ENV: "development", [TEST_PANEL_FLAG]: "true" }, true],
    ["test, flag true", { NODE_ENV: "test", [TEST_PANEL_FLAG]: "true" }, true],
    ["development, flag not set (the default)", { NODE_ENV: "development" }, false],
    ["test, flag not set", { NODE_ENV: "test" }, false],
    ["development, flag false", { NODE_ENV: "development", [TEST_PANEL_FLAG]: "false" }, false],
    ["development, flag 1 (only the word true counts)", { NODE_ENV: "development", [TEST_PANEL_FLAG]: "1" }, false],
    ["development, flag True (exactly true)", { NODE_ENV: "development", [TEST_PANEL_FLAG]: "True" }, false],
    ["development, flag empty", { NODE_ENV: "development", [TEST_PANEL_FLAG]: "" }, false],
    ["production, flag true", { NODE_ENV: "production", [TEST_PANEL_FLAG]: "true" }, false],
    ["production, flag not set", { NODE_ENV: "production" }, false],
    ["no environment named, flag true (cannot be told: off)", { [TEST_PANEL_FLAG]: "true" }, false],
    ["an environment nobody defined, flag true", { NODE_ENV: "staging", [TEST_PANEL_FLAG]: "true" }, false],
    ["a misspelt environment, flag true", { NODE_ENV: "Development", [TEST_PANEL_FLAG]: "true" }, false],
    ["an empty environment name, flag true", { NODE_ENV: "", [TEST_PANEL_FLAG]: "true" }, false],
  ];

  it.each(cases)("%s → %s", (_label, env, expected) => {
    expect(testPanelEnabled(env)).toBe(expected);
  });

  it("is off by default in the real test environment, until the flag is set", () => {
    expect(process.env.NODE_ENV).toBe("test");
    expect(process.env[TEST_PANEL_FLAG]).toBeUndefined();
    expect(testPanelEnabled()).toBe(false);
  });

  it("is switched on by the flag alone, in a test environment", async () => {
    await enableTestTools();
    expect(testPanelEnabled()).toBe(true);
  });
});

describe("the test-only endpoints", () => {
  describe("in production, whatever the flag says", () => {
    it.each(endpoints)("$name is a 404, for a signed-in admin too", async ({ call }) => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv(TEST_PANEL_FLAG, "true");

      const response = await call();

      expect(response.status).toBe(404);
      expect((await response.json()).error).toBe("Not found");
    });

    it.each(endpoints)("$name answers a visitor with no session exactly the same 404", async ({ call }) => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv(TEST_PANEL_FLAG, "true");
      session.signedIn = false;

      const response = await call();

      expect(response.status).toBe(404);
      expect((await response.json()).error).toBe("Not found");
    });
  });

  describe("with the flag off", () => {
    it.each(endpoints)("$name is a 404", async ({ call }) => {
      // NODE_ENV is "test" here, and the flag is not set.
      const response = await call();
      expect(response.status).toBe(404);
      expect((await response.json()).error).toBe("Not found");
    });
  });

  describe("with the flag on in a test environment", () => {
    beforeEach(async () => { await enableTestTools(); });

    it.each(endpoints)("$name refuses a visitor with no session (401)", async ({ call }) => {
      session.signedIn = false;
      expect((await call()).status).toBe(401);
    });

    it.each(endpoints.filter((endpoint) => endpoint.mutation))(
      "$name refuses a request from another site (403), even with a session",
      async ({ call }) => {
        session.crossOrigin = true;
        expect((await call()).status).toBe(403);
      },
    );

    it.each(endpoints)("$name lets a signed-in admin through", async ({ call, name }) => {
      const response = await call();
      // The campaign endpoints have no such campaign (or no body): their own answer, not a refusal to enter.
      const own = name.includes("/campaigns") && !response.ok;
      if (own) {
        const body = await response.json();
        expect(body.error).not.toBe("Not found");
        expect([400, 404]).toContain(response.status);
      } else {
        expect(response.status).toBe(200);
      }
    });

    it("there is no separate developer role in this app: any signed-in admin is one, and the flag makes them a tester", async () => {
      // Documented here because the requirement names one: the users table has no role column.
      const columns = await sql<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns WHERE table_name = 'users'`;
      expect(columns.map((c) => c.column_name)).not.toContain("role");
    });
  });
});

describe("a production build", () => {
  it("compiles the dev routes in only when the environment is not production", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    const production = (await import("../next.config")).default;

    vi.resetModules();
    vi.stubEnv("NODE_ENV", "development");
    const development = (await import("../next.config")).default;

    expect(production.pageExtensions).toEqual(["tsx", "ts", "jsx", "js"]);
    expect(development.pageExtensions).toContain("dev.ts");
  });

  it("keeps every test-only route in a `route.dev.ts` file, so none can be picked up in production", () => {
    const root = join(process.cwd(), "src", "app", "api", "dev");
    expect(existsSync(root)).toBe(true);

    const routeFiles: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory)) {
        const path = join(directory, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (/^route\./.test(entry)) routeFiles.push(path);
      }
    };
    walk(root);

    expect(routeFiles.length).toBeGreaterThanOrEqual(6);
    for (const file of routeFiles) expect(file, file).toMatch(/route\.dev\.ts$/);
  });

  it("puts nothing of the panel's API under a normal route name anywhere else", () => {
    // The only place a `dev` route may live is src/app/api/dev.
    const api = join(process.cwd(), "src", "app", "api");
    const strays: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory)) {
        const path = join(directory, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.dev\.tsx?$/.test(entry) && !path.includes(`${join("api", "dev")}`)) strays.push(path);
      }
    };
    walk(api);
    expect(strays).toEqual([]);
  });

  it("keeps the panel's words out of a production bundle", () => {
    // A production build drops the three dictionaries only if nothing keeps them alive: the choice must be
    // written inline in `messages`, and a `plural()` call (which a bundler cannot know is pure) must be marked.
    const messagesDirectory = join(process.cwd(), "src", "i18n", "messages");
    const index = readFileSync(join(messagesDirectory, "index.ts"), "utf8");
    expect(index).toMatch(/process\.env\.NODE_ENV === "production" \? \(\{\} as DevelopmentTools\) : \{ \.\.\.testhelp, \.\.\.testpanel, \.\.\.testguide \}/);
    // Re-exporting them from `domains.ts` would pull them into the bundle again.
    expect(readFileSync(join(messagesDirectory, "domains.ts"), "utf8")).not.toMatch(/export \{ test(help|panel|guide) \}/);

    for (const file of ["testhelp.ts", "testpanel.ts", "testguide.ts"]) {
      const source = readFileSync(join(messagesDirectory, file), "utf8");
      // A call is spread into the dictionary (`...plural(`); the import line and the comments are not calls.
      const calls = source.match(/\.\.\.\s*(?:\/\* @__PURE__ \*\/ )?plural\(/g)?.length ?? 0;
      const marked = source.match(/\.\.\.\/\* @__PURE__ \*\/ plural\(/g)?.length ?? 0;
      expect(marked, `${file}: every plural() call needs /* @__PURE__ */`).toBe(calls);
    }
  });
});

describe("the tools themselves refuse to be used outside a test environment", () => {
  it("the test clock cannot be set in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(TEST_PANEL_FLAG, "true");
    expect(() => setFixedTime(new Date("2030-01-01T00:00:00Z"))).toThrow(TestToolsDisabledError);
  });

  it("a clock that was held is ignored the moment the environment is production", async () => {
    await enableTestTools();
    setFixedTime(new Date("2030-01-01T00:00:00Z"));
    expect(clock.isSimulated()).toBe(true);

    vi.stubEnv("NODE_ENV", "production");

    expect(clock.isSimulated()).toBe(false);
    expect(clock.dbNow()).toBeUndefined();
    expect(Math.abs(clock.now().getTime() - Date.now())).toBeLessThan(2000);
  });
});
