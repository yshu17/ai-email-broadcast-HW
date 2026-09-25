// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./dom";
import { UI_STATE_KEY } from "@/components/testpanel/ui-state";
import { HELP_IDS } from "@/lib/testing/help";
import { TEST_LIMITS } from "@/lib/testing/limits";
import { campaignRow, journalEntry, makeSnapshot, renderPanel } from "./testpanel-ui-helpers";

/**
 * The test panel in a DOM, driven as a person would: opened from its button, its sections read and
 * used, with a stand-in for the test-only API that records what was sent. The rules of the server are
 * tested against the real server elsewhere; these check what the panel shows, what it refuses before
 * sending anything, and what it sends.
 */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const drawer = () => screen.getByTestId("test-panel");
/** The `?` button of a registry entry (several elements can share a title, never an id). */
const helpButton = (id: string) => document.querySelector<HTMLElement>(`[data-help-button="${id}"]`) as HTMLElement;
const inDrawer = () => within(drawer());
const heldClock = (effectiveNow = "2026-10-15T10:25:00.000Z") => ({
  mode: "fixed" as const, realNow: new Date().toISOString(), effectiveNow, fixedAt: effectiveNow,
});

/** The requests to an endpoint that changed something (everything but the polling of the state). */
const posts = (server: ReturnType<typeof renderPanel>["server"], url: string) => server.to(url).filter((call) => call.method !== "GET");

describe("opening and closing the panel", () => {
  it("is a 'Test Panel' button that opens a drawer, and the drawer's close button closes it", async () => {
    const user = userEvent.setup();
    renderPanel({ open: false });

    const toggle = screen.getByRole("button", { name: /Test Panel/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("test-panel")).toBeNull();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("complementary", { name: "Test Panel" })).toBeInTheDocument();

    await user.click(inDrawer().getByRole("button", { name: "Close the test panel" }));
    expect(screen.queryByTestId("test-panel")).toBeNull();
    expect(toggle).toHaveFocus();
  });

  it("says it is in test mode, in a banner that is there even when the drawer is closed", () => {
    renderPanel({ open: false });

    const banner = screen.getByTestId("test-banner");
    expect(banner).toHaveTextContent("TEST MODE");
    expect(banner).toHaveTextContent("Email goes only to the built-in test SMTP server");
    expect(banner).toHaveAttribute("role", "status");
  });

  it("shows what has been changed: the held test time and the test rate limit", async () => {
    renderPanel({
      open: false,
      snapshot: makeSnapshot({
        clock: heldClock(),
        rate: { source: "test", maxEmails: 2, windowSeconds: 10, override: { maxEmails: 2, windowSeconds: 10 } },
      }),
    });

    await waitFor(() => expect(screen.getByTestId("test-banner")).toHaveTextContent("Test time is held"));
    expect(screen.getByTestId("test-banner")).toHaveTextContent("Test email limit: 2 per 10 s");
  });

  it("closes on Escape and hands the focus back to its button", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(inDrawer().getByRole("heading", { name: "Test Panel" }));
    inDrawer().getByRole("button", { name: "Close the test panel" }).focus();

    await user.keyboard("{Escape}");

    expect(screen.queryByTestId("test-panel")).toBeNull();
    expect(screen.getByRole("button", { name: /Test Panel/ })).toHaveFocus();
  });

  it("closes a help popover on Escape first, and only the next Escape closes the drawer", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(helpButton("clockModeReal"));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);

    await user.keyboard("{Escape}");
    expect(screen.queryAllByRole("dialog")).toHaveLength(0);
    expect(screen.getByTestId("test-panel")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("test-panel")).toBeNull();
  });

  it("puts the focus on its title when a keyboard user opens it", async () => {
    const user = userEvent.setup();
    renderPanel({ open: false });

    screen.getByRole("button", { name: /Test Panel/ }).focus();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(inDrawer().getByRole("heading", { name: "Test Panel" })).toHaveFocus());
  });

  it("scrolls inside (a body that can scroll), so a long panel never runs off a short screen", () => {
    renderPanel();
    expect(screen.getByTestId("test-panel-body").className).toContain("overflow-y-auto");
    expect(drawer().className).toContain("w-full"); // the whole width on a narrow screen
    expect(drawer().className).toContain("sm:w-[28rem]");
  });

  it("does not darken or block the page: it is a drawer beside it, not a dialog over it", () => {
    renderPanel();
    expect(drawer()).not.toHaveAttribute("aria-modal");
    expect(document.querySelector('[class*="bg-black"]')).toBeNull();
  });

  it("folds its sections, and remembers which", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(inDrawer().getByRole("button", { name: "Scheduler" }));

    expect(inDrawer().queryByRole("button", { name: "Run now" })).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(UI_STATE_KEY) ?? "{}").sections.scheduler).toBe(false);
  });
});

describe("the help on every element", () => {
  const stateWithEverything = () => makeSnapshot({
    campaigns: [campaignRow()],
    events: [journalEntry(1)],
    latestEventId: 1,
  });

  /** Puts the panel in every state that shows a control the others hide. */
  async function revealEverything(user: ReturnType<typeof userEvent.setup>) {
    const found = new Set<string>();
    const collect = () => document.querySelectorAll<HTMLElement>("[data-help-button]").forEach((el) => found.add(el.dataset.helpButton ?? ""));
    collect();

    await user.click(inDrawer().getByRole("radio", { name: "Fixed test time" }));
    collect();

    const mode = inDrawer().getByLabelText("How to send");
    const scenario = inDrawer().getByLabelText("SMTP scenario");
    await user.selectOptions(mode, "schedule");
    collect();
    await user.selectOptions(mode, "overdue");
    collect();
    await user.selectOptions(scenario, "slow");
    collect();
    await user.selectOptions(scenario, "tempfail");
    collect();

    await user.click(inDrawer().getByRole("button", { name: "Queue rows" }));
    collect();
    // The scenario cards
    await user.click(inDrawer().getByRole("button", { name: "Scenarios" }));
    collect();
    return found;
  }

  it("has a help button for every element of the registry somewhere in the panel", async () => {
    const user = userEvent.setup();
    renderPanel({ snapshot: stateWithEverything() });
    await screen.findByText(/\[TEST\] Five in five/);

    const found = await revealEverything(user);

    const missing = HELP_IDS.filter((id) => !found.has(id));
    expect(missing).toEqual([]);
    expect(found.size).toBeGreaterThanOrEqual(75);
  });

  it("gives every control (field, switch, action) its own help, wherever it appears", async () => {
    const user = userEvent.setup();
    renderPanel({ snapshot: stateWithEverything() });
    await screen.findByText(/\[TEST\] Five in five/);
    await revealEverything(user);

    const controls = [...drawer().querySelectorAll<HTMLElement>("button, input, select, textarea, a[href]")].filter((element) =>
      !element.matches("[data-help-button], [data-help-close], [data-panel-chrome]"));
    expect(controls.length).toBeGreaterThan(30);

    const without = controls.filter((element) => {
      const id = element.dataset.helpId;
      return !id || !document.querySelector(`[data-help-button="${id}"]`);
    });
    expect(without.map((element) => element.outerHTML.slice(0, 120))).toEqual([]);
  });

  it("gives every figure it reports its own help", async () => {
    const user = userEvent.setup();
    renderPanel({ snapshot: stateWithEverything() });
    await screen.findByText(/\[TEST\] Five in five/);
    await revealEverything(user);

    const metrics = [...drawer().querySelectorAll<HTMLElement>("[data-metric]")].filter((element) => !element.dataset.metric?.endsWith("-value"));
    expect(metrics.length).toBeGreaterThan(20);
    for (const metric of metrics) {
      expect(metric.querySelector("[data-help-button]"), metric.dataset.metric).not.toBeNull();
    }
  });

  it("ties every control to its help for a screen reader: aria-describedby points at text that exists", async () => {
    const user = userEvent.setup();
    renderPanel({ snapshot: stateWithEverything() });
    await screen.findByText(/\[TEST\] Five in five/);
    await revealEverything(user);

    const described = [...drawer().querySelectorAll<HTMLElement>("[data-help-id]")];
    expect(described.length).toBeGreaterThan(30);
    for (const element of described) {
      const target = document.getElementById(element.getAttribute("aria-describedby") ?? "");
      expect(target, element.outerHTML.slice(0, 100)).not.toBeNull();
      expect(target?.textContent?.trim().length).toBeGreaterThan(0);
    }
  });

  it("puts the help icon beside the label, not inside it (a click on it must not reach the field)", async () => {
    renderPanel();
    for (const label of drawer().querySelectorAll("label")) {
      expect(label.querySelector("[data-help-button]"), label.textContent ?? "").toBeNull();
    }
  });

  it("opens a popover for a complex setting and a tooltip for a simple figure, inside the drawer", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(inDrawer().getByRole("button", { name: "More: Scheduler interval" }));
    const popover = screen.getByRole("dialog", { name: "Scheduler interval" });
    expect(drawer().contains(popover)).toBe(true);
    expect(popover.style.position).toBe("fixed");

    await user.click(inDrawer().getByRole("button", { name: "More: Waiting jobs" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent("have not started yet");
    expect(screen.queryByRole("dialog")).toBeNull(); // only one open at a time
  });

  it("changes nothing by being opened: no request is made", async () => {
    const user = userEvent.setup();
    const view = renderPanel();
    const before = view.server.calls.length;

    await user.click(helpButton("clockAdvance"));
    await user.click(helpButton("schedRunNow"));
    await user.keyboard("{Escape}");

    expect(view.server.calls.slice(before).filter((call) => call.method !== "GET")).toEqual([]);
  });
});

describe("Test Clock", () => {
  it("shows the real time, the application's time, your zone and the mode", () => {
    renderPanel();
    const section = within(screen.getByRole("region", { name: "Test Clock" }));

    expect(section.getByText("Real time", { selector: "dt" })).toBeInTheDocument();
    expect(section.getByText("Application time")).toBeInTheDocument();
    expect(section.getByText("Your time zone")).toBeInTheDocument();
    expect(section.getByText("Mode")).toBeInTheDocument();
    expect(section.getAllByText("Real time").length).toBeGreaterThan(1);
  });

  it("has Advance and Reset to real time disabled while the clock is not held", () => {
    renderPanel();
    expect(inDrawer().getByRole("button", { name: "Advance" })).toBeDisabled();
    expect(inDrawer().getByRole("button", { name: "Reset to real time" })).toBeDisabled();
  });

  it("offers Real time and Fixed test time, and Fixed reveals the date, the time and the zone", async () => {
    const user = userEvent.setup();
    renderPanel();
    expect(inDrawer().getByRole("radio", { name: "Real time" })).toBeChecked();
    expect(inDrawer().queryByLabelText("Date")).toBeNull();

    await user.click(inDrawer().getByRole("radio", { name: "Fixed test time" }));

    expect(inDrawer().getByLabelText("Date")).toBeInTheDocument();
    expect(inDrawer().getByLabelText("Time")).toBeInTheDocument();
    expect(inDrawer().getByLabelText("Time zone")).toBeInTheDocument();
    expect(inDrawer().getByRole("button", { name: "Set" })).toBeInTheDocument();
  });

  it("starts the fields on the moment the app is at now, in the zone shown", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(inDrawer().getByRole("radio", { name: "Fixed test time" }));

    expect((inDrawer().getByLabelText("Date") as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((inDrawer().getByLabelText("Time") as HTMLInputElement).value).toMatch(/^\d{2}:\d{2}$/);
    expect((inDrawer().getByLabelText("Time zone") as HTMLInputElement).value).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  async function hold(user: ReturnType<typeof userEvent.setup>, date = "2026-10-15", time = "10:25", zone = "Europe/Warsaw") {
    await user.click(inDrawer().getByRole("radio", { name: "Fixed test time" }));
    const dateInput = inDrawer().getByLabelText("Date");
    const timeInput = inDrawer().getByLabelText("Time");
    const zoneInput = inDrawer().getByLabelText("Time zone");
    await user.clear(dateInput); await user.type(dateInput, date);
    await user.clear(timeInput); await user.type(timeInput, time);
    await user.clear(zoneInput); await user.type(zoneInput, zone);
  }

  it("sets the clock: sends the date, the time and the zone, and then shows it held", async () => {
    const user = userEvent.setup();
    const view = renderPanel();
    await hold(user);

    await user.click(inDrawer().getByRole("button", { name: "Set" }));

    await waitFor(() => expect(posts(view.server, "/api/dev/clock")).toHaveLength(1));
    expect(posts(view.server, "/api/dev/clock")[0].body).toEqual({ action: "set", date: "2026-10-15", time: "10:25", timeZone: "Europe/Warsaw" });
    expect(await inDrawer().findByText("Fixed test time", { selector: ".test-chip" })).toBeInTheDocument();
    expect(await inDrawer().findByText("The test clock is held at the time you set.")).toBeInTheDocument();
    expect(screen.getByTestId("test-banner")).toHaveTextContent("Test time is held");
  });

  it("says what it will hold the clock at, in UTC, before it is set", async () => {
    const user = userEvent.setup();
    renderPanel();
    await hold(user);

    expect(await inDrawer().findByText(/2026-10-15T08:25:00\.000Z \(UTC\)/)).toBeInTheDocument();
  });

  it("advances by the chosen step", async () => {
    const user = userEvent.setup();
    const view = renderPanel({ snapshot: makeSnapshot({ clock: heldClock() }) });
    await waitFor(() => expect(inDrawer().getByRole("button", { name: "Advance" })).toBeEnabled());

    await user.selectOptions(inDrawer().getByLabelText("Step"), "hour");
    await user.click(inDrawer().getByRole("button", { name: "Advance" }));

    await waitFor(() => expect(posts(view.server, "/api/dev/clock")).toHaveLength(1));
    expect(posts(view.server, "/api/dev/clock")[0].body).toEqual({ action: "advance", step: "hour" });
  });

  it("offers exactly the four steps: 1 minute, 5 minutes, 1 hour, 1 day", () => {
    renderPanel();
    const options = [...(inDrawer().getByLabelText("Step") as HTMLSelectElement).options].map((option) => option.textContent);
    expect(options).toEqual(["1 minute", "5 minutes", "1 hour", "1 day"]);
  });

  it("resets to real time with the button, and with the Real time radio", async () => {
    const user = userEvent.setup();
    const view = renderPanel({ snapshot: makeSnapshot({ clock: heldClock() }) });
    await waitFor(() => expect(inDrawer().getByRole("button", { name: "Reset to real time" })).toBeEnabled());

    await user.click(inDrawer().getByRole("button", { name: "Reset to real time" }));
    await waitFor(() => expect(posts(view.server, "/api/dev/clock")).toHaveLength(1));
    expect(posts(view.server, "/api/dev/clock")[0].body).toEqual({ action: "reset" });
    await waitFor(() => expect(inDrawer().getByRole("radio", { name: "Real time" })).toBeChecked());

    view.server.state.clock = heldClock();
    await user.click(inDrawer().getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(inDrawer().getByRole("button", { name: "Reset to real time" })).toBeEnabled());
    await user.click(inDrawer().getByRole("radio", { name: "Real time" }));
    await waitFor(() => expect(posts(view.server, "/api/dev/clock")).toHaveLength(2));
  });

  it("refuses a zone that does not exist, a date the calendar does not have, and a year out of range, before sending", async () => {
    const user = userEvent.setup();
    const view = renderPanel();

    await hold(user, "2026-10-15", "10:25", "Mars/Olympus");
    await user.click(inDrawer().getByRole("button", { name: "Set" }));
    expect(await inDrawer().findByText("Unknown time zone")).toBeInTheDocument();

    await hold(user, "1999-12-31", "10:25", "UTC");
    await user.click(inDrawer().getByRole("button", { name: "Set" }));
    expect(await inDrawer().findByText(/must fall between the years 2000 and 2100/)).toBeInTheDocument();

    expect(posts(view.server, "/api/dev/clock")).toEqual([]);
  });
});

describe("Scheduler", () => {
  it("shows whether it is running, the interval, the last and next cycle, the found and the result", () => {
    renderPanel({
      snapshot: makeSnapshot({
        scheduler: {
          cycleInFlight: false, cycles: 3, running: true, intervalSeconds: 5, nextCycleAt: "2026-10-15T10:30:05.000Z",
          last: {
            id: 3, source: "panel-loop", startedAt: "2026-10-15T10:30:00.000Z", finishedAt: "2026-10-15T10:30:00.084Z", durationMs: 84,
            effectiveNow: "2026-10-15T10:30:00.000Z", simulatedClock: true, error: null,
            result: { claimed: 5, sent: 4, failed: 1, retried: 0, suppressed: 0, reclaimed: 0, dueCampaigns: 2, activatedCampaigns: 1, failedActivations: 0, recoveredCampaigns: 0, completedCampaigns: 0, rateLimited: false, durationMs: 80 },
          },
        },
      }),
    });
    const section = within(screen.getByRole("region", { name: "Scheduler" }));

    return waitFor(() => {
      expect(section.getByText("Running")).toBeInTheDocument();
      expect(section.getByText(/84 ms/)).toBeInTheDocument();
      expect(section.getByText("Due campaigns found").parentElement).toHaveTextContent("2");
      expect(section.getByText(/started 1 · claimed 5 · sent 4 · failed 1 · retried 0/)).toBeInTheDocument();
      expect((section.getByLabelText("Scheduler interval") as HTMLInputElement).value).toBe("5");
    });
  });

  it("shows the last error, without secrets, and a dash when there is none", async () => {
    renderPanel({
      snapshot: makeSnapshot({
        scheduler: {
          cycleInFlight: false, cycles: 1, running: true, intervalSeconds: 5, nextCycleAt: null,
          last: { id: 1, source: "run-now", startedAt: "2026-10-15T10:30:00.000Z", finishedAt: "2026-10-15T10:30:00.010Z", durationMs: 10, effectiveNow: "2026-10-15T10:30:00.000Z", simulatedClock: false, result: null, error: "connect failed to ***@db.internal" },
        },
      }),
    });
    expect(await screen.findByText("connect failed to ***@db.internal")).toBeInTheDocument();
  });

  it("runs one cycle, and a double click sends one request", async () => {
    const user = userEvent.setup();
    const view = renderPanel();
    view.server.slow("/api/dev/scheduler", 150); // a real request takes a moment: the button must hold until it is over

    await user.dblClick(inDrawer().getByRole("button", { name: "Run now" }));

    await waitFor(() => expect(posts(view.server, "/api/dev/scheduler")).toHaveLength(1));
    expect(posts(view.server, "/api/dev/scheduler")[0].body).toEqual({ action: "run" });
    expect(await inDrawer().findByText("One cycle ran: 1 due, 1 started.")).toBeInTheDocument();
  });

  it("says so when a cycle was already running and nothing was started", async () => {
    const user = userEvent.setup();
    const view = renderPanel();
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/dev/scheduler" && init?.method === "POST") {
        return new Response(JSON.stringify({ ran: false, reason: "busy", report: null, snapshot: view.server.state.scheduler }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return original(input, init);
    }));

    await user.click(inDrawer().getByRole("button", { name: "Run now" }));

    expect(await inDrawer().findByText("A cycle is already running; nothing new was started.")).toBeInTheDocument();
  });

  it("stops and starts it", async () => {
    const user = userEvent.setup();
    const view = renderPanel();
    await waitFor(() => expect(inDrawer().getByText("Running")).toBeInTheDocument());
    expect(inDrawer().getByRole("button", { name: "Start" })).toBeDisabled();

    await user.click(inDrawer().getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(inDrawer().getByText("Stopped")).toBeInTheDocument());
    expect(posts(view.server, "/api/dev/scheduler")[0].body).toEqual({ action: "stop" });
    expect(inDrawer().getByRole("button", { name: "Stop" })).toBeDisabled();

    await user.click(inDrawer().getByRole("button", { name: "Start" }));
    await waitFor(() => expect(inDrawer().getByText("Running")).toBeInTheDocument());
    expect(posts(view.server, "/api/dev/scheduler")[1].body).toEqual({ action: "start" });
  });

  it("changes the interval when a number in range is typed and the field is left", async () => {
    const user = userEvent.setup();
    const view = renderPanel();
    const field = inDrawer().getByLabelText("Scheduler interval");

    await user.clear(field);
    await user.type(field, "12");
    await user.tab();

    await waitFor(() => expect(posts(view.server, "/api/dev/scheduler")).toHaveLength(1));
    expect(posts(view.server, "/api/dev/scheduler")[0].body).toEqual({ action: "interval", seconds: 12 });
  });

  it.each([
    ["zero", "0"], ["above the maximum", String(TEST_LIMITS.schedulerInterval.max + 1)],
    ["a fraction", "2.5"], ["text", "soon"], ["empty", ""],
  ])("refuses %s in the browser, says the range, and sends nothing", async (_label, value) => {
    const user = userEvent.setup();
    const view = renderPanel();
    const field = inDrawer().getByLabelText("Scheduler interval");

    await user.clear(field);
    if (value) await user.type(field, value);
    await user.tab();

    const alert = await inDrawer().findByRole("alert");
    expect(alert.textContent).toMatch(/whole number from 1 to 300|is required/);
    expect(posts(view.server, "/api/dev/scheduler")).toEqual([]);
  });

  it("tells the range beside the field", () => {
    renderPanel();
    expect(inDrawer().getByText("From 1 to 300 seconds")).toBeInTheDocument();
  });
});

describe("Queue and Rate Limit", () => {
  it("shows the queue's state and jobs, the limit, the window, and the built-in SMTP server", async () => {
    renderPanel({
      snapshot: makeSnapshot({
        queue: { state: "limited", waiting: 28, active: 1, done: 2, failed: 3, sentInWindow: 2 },
        rate: { source: "test", maxEmails: 2, windowSeconds: 10, override: { maxEmails: 2, windowSeconds: 10 } },
        smtp: { port: 2525, outputDir: "C:/project/received-emails", accepted: 9, refusedTemporarily: 0, refusedPermanently: 0, refusedForeign: 0 },
      }),
    });
    const section = within(screen.getByRole("region", { name: "Queue and Rate Limit" }));

    await waitFor(() => expect(section.getByText("Limited by the rate limit")).toBeInTheDocument());
    expect(section.getByText("Waiting jobs").closest("div")).toHaveTextContent("28");
    expect(section.getByText("Active jobs").closest("div")).toHaveTextContent("1");
    expect(section.getByText("Completed jobs").closest("div")).toHaveTextContent("2");
    expect(section.getByText("Failed jobs").closest("div")).toHaveTextContent("3");
    expect(section.getByText("2 emails per 10 s")).toBeInTheDocument();
    expect(section.getByText("Window length").closest("div")).toHaveTextContent("10 s");
    expect(section.getByText(/port 2525 · accepted 9/)).toBeInTheDocument();
    expect(section.getByText(/received-emails/)).toBeInTheDocument();
  });

  it("shows the formula, worked out from the two numbers as they are typed", async () => {
    const user = userEvent.setup();
    renderPanel();
    const max = inDrawer().getByLabelText("Max emails");
    const window = inDrawer().getByLabelText("Interval");

    await user.clear(max); await user.type(max, "2");
    await user.clear(window); await user.type(window, "10");

    expect(inDrawer().getByText("Rate (emails per second) = 2 / 10 s = 0.2")).toBeInTheDocument();
  });

  it("offers the three recommended settings, which only fill the fields", async () => {
    const user = userEvent.setup();
    const view = renderPanel();

    await user.click(inDrawer().getByRole("button", { name: "Emails: 2 / 10 s" }));
    expect((inDrawer().getByLabelText("Max emails") as HTMLInputElement).value).toBe("2");
    expect((inDrawer().getByLabelText("Interval") as HTMLInputElement).value).toBe("10");
    await user.click(inDrawer().getByRole("button", { name: "Emails: 5 / 1 s" }));
    expect((inDrawer().getByLabelText("Max emails") as HTMLInputElement).value).toBe("5");
    expect((inDrawer().getByLabelText("Interval") as HTMLInputElement).value).toBe("1");
    await user.click(inDrawer().getByRole("button", { name: "Emails: 10 / 5 s" }));
    expect((inDrawer().getByLabelText("Max emails") as HTMLInputElement).value).toBe("10");

    expect(posts(view.server, "/api/dev/rate-limit")).toEqual([]);
  });

  it("applies the numbers, shows the limit as a test one, and says when it takes effect", async () => {
    const user = userEvent.setup();
    const view = renderPanel();
    await user.click(inDrawer().getByRole("button", { name: "Emails: 2 / 10 s" }));

    await user.click(inDrawer().getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(posts(view.server, "/api/dev/rate-limit")).toHaveLength(1));
    expect(posts(view.server, "/api/dev/rate-limit")[0].body).toEqual({ action: "apply", maxEmails: 2, windowSeconds: 10 });
    expect(await inDrawer().findByText("The test limit is set. The queue reads it on the next cycle.")).toBeInTheDocument();
    expect(await screen.findByText("Test email limit: 2 per 10 s")).toBeInTheDocument();
  });

  it.each([
    ["Max emails", "0"], ["Max emails", "-3"], ["Max emails", String(TEST_LIMITS.rateMaxEmails.max + 1)], ["Max emails", "1.5"], ["Max emails", ""],
    ["Interval", "0"], ["Interval", "-1"], ["Interval", String(TEST_LIMITS.rateWindowSeconds.max + 1)], ["Interval", "abc"], ["Interval", ""],
  ])("refuses %s = %j in the browser, and sends nothing", async (label, value) => {
    const user = userEvent.setup();
    const view = renderPanel();
    await user.click(inDrawer().getByRole("button", { name: "Emails: 2 / 10 s" }));
    const field = inDrawer().getByLabelText(label);
    await user.clear(field);
    if (value) await user.type(field, value);

    await user.click(inDrawer().getByRole("button", { name: "Apply" }));

    expect(await inDrawer().findByRole("alert")).toBeInTheDocument();
    expect(posts(view.server, "/api/dev/rate-limit")).toEqual([]);
  });

  it("says the range it enforces in that refusal", async () => {
    const user = userEvent.setup();
    renderPanel();
    const field = inDrawer().getByLabelText("Max emails");
    await user.clear(field);
    await user.type(field, "0");
    await user.click(inDrawer().getByRole("button", { name: "Apply" }));

    expect(await inDrawer().findByText("Max emails must be a whole number from 1 to 1000")).toBeInTheDocument();
  });

  it("resets to the defaults: the configured limit is back, and the banner stops mentioning it", async () => {
    const user = userEvent.setup();
    const view = renderPanel({
      snapshot: makeSnapshot({ rate: { source: "test", maxEmails: 2, windowSeconds: 10, override: { maxEmails: 2, windowSeconds: 10 } } }),
    });
    await waitFor(() => expect(inDrawer().getByRole("button", { name: "Reset to defaults" })).toBeEnabled());

    await user.click(inDrawer().getByRole("button", { name: "Reset to defaults" }));

    await waitFor(() => expect(posts(view.server, "/api/dev/rate-limit")).toHaveLength(1));
    expect(posts(view.server, "/api/dev/rate-limit")[0].body).toEqual({ action: "reset" });
    await waitFor(() => expect(screen.getByTestId("test-banner")).not.toHaveTextContent("Test email limit"));
    expect(await inDrawer().findByText("Back to the configured limit.")).toBeInTheDocument();
  });

  it("explains that scheduledAt is the start, not the delivery, in the formula's help", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(inDrawer().getByRole("button", { name: "More: Rate formula" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("scheduledAt sets when processing starts, not when everything is delivered");
  });

  it("does not show, ask for or change any real SMTP setting", () => {
    renderPanel();
    // No field for a host, a port, a user name or a password of a real mail server, and none named after one.
    expect(inDrawer().queryByLabelText(/password|SMTP host|SMTP port|SMTP username|Sender email/i)).toBeNull();
    expect(drawer().querySelector('input[type="password"]')).toBeNull();
    expect(drawer().textContent ?? "").not.toMatch(/SendPulse|smtp-pulse.com/i);
  });
});
