import { render } from "@testing-library/react";
import { vi } from "vitest";
import TestPanel from "@/components/testpanel/TestPanel";
import { LocaleProvider } from "@/i18n/client";
import type { Locale } from "@/i18n/locale";
import { resetUiStateCache, UI_STATE_KEY } from "@/components/testpanel/ui-state";
import type { JournalEntry } from "@/lib/testing/journal";
import type { TestPanelSnapshot } from "@/lib/testing/snapshot";

/**
 * A stand-in for the test-only API, so the panel can be driven in a DOM without a server: it
 * answers the panel's calls from a snapshot it keeps, applies the simple rules (a clock that is
 * held, a limit that is applied) and records every request, so a test can say what was sent and
 * what was not. The rules of the real server are tested against the real server elsewhere.
 */
export type Recorded = { url: string; method: string; body: Record<string, unknown> | undefined };

export function makeSnapshot(overrides: Partial<TestPanelSnapshot> = {}): TestPanelSnapshot {
  const now = new Date().toISOString();
  return {
    serverTime: now,
    clock: { mode: "real", realNow: now, effectiveNow: now, fixedAt: null },
    scheduler: {
      cycleInFlight: false, cycles: 0, last: null, running: true, intervalSeconds: 5, nextCycleAt: null,
    },
    queue: { state: "idle", waiting: 0, active: 0, done: 0, failed: 0, sentInWindow: 0 },
    rate: { source: "configured", maxEmails: 4750, windowSeconds: 3600, override: null },
    smtp: { port: 2525, outputDir: "C:/project/received-emails", accepted: 0, refusedTemporarily: 0, refusedPermanently: 0, refusedForeign: 0 },
    campaigns: [],
    events: [],
    latestEventId: 0,
    ...overrides,
  };
}

export const campaignRow = (overrides: Partial<TestPanelSnapshot["campaigns"][number]> = {}): TestPanelSnapshot["campaigns"][number] => ({
  id: "11111111-1111-4111-8111-111111111111",
  name: "[TEST] Five in five",
  status: "SCHEDULED",
  scheduledAt: "2026-10-15T10:30:00.000Z",
  createdAt: "2026-10-15T10:25:00.000Z",
  startedAt: null,
  completedAt: null,
  totalRecipients: 0,
  queued: 0, sending: 0, sent: 0, failed: 0,
  ...overrides,
});

export const journalEntry = (id: number, overrides: Partial<JournalEntry> = {}): JournalEntry => ({
  id, at: new Date(2026, 9, 15, 10, 25, id).toISOString(), effectiveAt: null,
  type: "scheduler.cycle.started", source: "scheduler", data: { cycle: id, trigger: "run-now" },
  ...overrides,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export type FakeServer = {
  calls: Recorded[];
  state: TestPanelSnapshot;
  /** The requests to one endpoint, in order. */
  to: (url: string) => Recorded[];
  /** Answers the next request to `url` with this failure instead. */
  failNext: (url: string, status: number, body: unknown) => void;
  /** Makes every answer from `url` take this long, as a real request does. */
  slow: (url: string, milliseconds: number) => void;
};

export function installFakeServer(initial: TestPanelSnapshot = makeSnapshot()): FakeServer {
  const server: FakeServer = {
    calls: [],
    state: initial,
    to: (url) => server.calls.filter((call) => call.url === url),
    failNext: (url, status, body) => failures.set(url, { status, body }),
    slow: (url, milliseconds) => delays.set(url, milliseconds),
  };
  const failures = new Map<string, { status: number; body: unknown }>();
  const delays = new Map<string, number>();

  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const path = url.split("?")[0];
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    server.calls.push({ url: path, method, body });
    const delay = delays.get(path);
    if (delay && method !== "GET") await new Promise((resolve) => setTimeout(resolve, delay));

    const failure = failures.get(path);
    if (failure) {
      failures.delete(path);
      return json(failure.body, failure.status);
    }

    const state = server.state;
    if (path === "/api/dev/state") {
      // Like the real endpoint: only the events after `since`.
      const since = Number(new URL(url, "http://localhost").searchParams.get("since") ?? 0);
      const events = state.events.filter((event) => event.id > since);
      const latest = state.events.reduce((max, event) => Math.max(max, event.id), 0);
      return json({ ...state, events, latestEventId: latest, serverTime: new Date().toISOString() });
    }

    if (path === "/api/dev/clock") {
      if (body?.action === "set") {
        const at = `${body.date}T${body.time}:00.000Z`;
        state.clock = { mode: "fixed", realNow: state.clock.realNow, effectiveNow: at, fixedAt: at };
      } else if (body?.action === "advance") {
        const seconds = ({ minute: 60, fiveMinutes: 300, hour: 3600, day: 86400 } as Record<string, number>)[String(body.step)];
        const next = new Date(new Date(state.clock.effectiveNow).getTime() + seconds * 1000).toISOString();
        state.clock = { ...state.clock, effectiveNow: next, fixedAt: next };
      } else if (body?.action === "reset") {
        state.clock = { mode: "real", realNow: state.clock.realNow, effectiveNow: state.clock.realNow, fixedAt: null };
      }
      return json({ clock: state.clock });
    }

    if (path === "/api/dev/rate-limit") {
      if (body?.action === "apply") {
        const override = { maxEmails: Number(body.maxEmails), windowSeconds: Number(body.windowSeconds) };
        state.rate = { source: "test", ...override, override };
      } else if (body?.action === "reset") {
        state.rate = { source: "configured", maxEmails: 4750, windowSeconds: 3600, override: null };
      }
      return json({ override: state.rate.override });
    }

    if (path === "/api/dev/scheduler") {
      if (body?.action === "start") state.scheduler = { ...state.scheduler, running: true };
      if (body?.action === "stop") state.scheduler = { ...state.scheduler, running: false, nextCycleAt: null };
      if (body?.action === "interval") state.scheduler = { ...state.scheduler, intervalSeconds: Number(body.seconds) };
      if (body?.action === "run") {
        return json({ ran: true, reason: null, report: { id: 1, error: null, result: { dueCampaigns: 1, activatedCampaigns: 1 } }, snapshot: state.scheduler });
      }
      return json({ snapshot: state.scheduler });
    }

    if (path === "/api/dev/campaigns" && method === "POST") {
      const created = campaignRow({ id: "22222222-2222-4222-8222-222222222222", name: `[TEST] ${body?.name ?? "New"}`, status: "QUEUED", scheduledAt: null });
      state.campaigns = [created, ...state.campaigns];
      return json({ campaign: { id: created.id, name: created.name, status: created.status, scheduledAt: null }, recipients: Number(body?.recipients), scenario: String(body?.scenario) }, 201);
    }

    const one = /^\/api\/dev\/campaigns\/([\w-]+)$/.exec(path);
    if (one && method === "GET") {
      const campaign = state.campaigns.find((c) => c.id === one[1]);
      if (!campaign) return json({ error: "Campaign not found" }, 404);
      return json({
        campaign: { id: campaign.id, name: campaign.name, status: campaign.status, scheduledAt: campaign.scheduledAt, createdAt: campaign.createdAt },
        queue: [{ email: "success-abc123-001@test.invalid", status: "QUEUED", attempts: 1, nextAttemptAt: campaign.createdAt, sentAt: null, lastError: "451 try later" }],
        history: [{ at: campaign.createdAt, type: "row.created", to: "DRAFT" }, { at: campaign.createdAt, type: "campaign.scheduled", from: "DRAFT", to: "SCHEDULED", data: { scheduledAt: campaign.scheduledAt } }],
      });
    }
    if (one && method === "DELETE") {
      state.campaigns = state.campaigns.filter((c) => c.id !== one[1]);
      return json({ ok: true, removedContacts: 3 });
    }

    if (path.endsWith("/cancel-scheduled")) return json({ ok: true, alreadyCancelled: false, campaign: {} });
    if (path.endsWith("/schedule")) return json({ ok: true, scheduledAt: "2026-10-15T10:40:00.000Z" });
    return json({ error: `unexpected ${method} ${path}` }, 500);
  }));
  return server;
}

export function renderPanel(options: { locale?: Locale; open?: boolean; snapshot?: TestPanelSnapshot; sections?: Record<string, boolean> } = {}) {
  window.localStorage.clear();
  resetUiStateCache();
  if (options.open !== false || options.sections) {
    window.localStorage.setItem(UI_STATE_KEY, JSON.stringify({
      open: options.open !== false,
      ...(options.sections ? { sections: options.sections } : {}),
    }));
    resetUiStateCache();
  }
  const server = installFakeServer(options.snapshot ?? makeSnapshot());
  const view = render(<LocaleProvider locale={options.locale ?? "en"}><TestPanel /></LocaleProvider>);
  return { ...view, server };
}
