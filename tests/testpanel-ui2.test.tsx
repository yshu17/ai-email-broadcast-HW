// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./dom";
import { UI_STATE_KEY } from "@/components/testpanel/ui-state";
import { SCENARIO_IDS } from "@/lib/testing/scenarios";
import { TEST_LIMITS } from "@/lib/testing/limits";
import { TOUR_STEPS } from "@/lib/testing/tour";
import { campaignRow, journalEntry, makeSnapshot, renderPanel } from "./testpanel-ui-helpers";

/**
 * The rest of the panel in a DOM: making test campaigns, working on the selected one, the journal,
 * the tour and the scenarios, the Russian screen, what the page remembers, and an accessibility
 * check by axe. See testpanel-ui.test.tsx for the opening, the help and the first three sections.
 */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const drawer = () => screen.getByTestId("test-panel");
const inDrawer = () => within(drawer());
const helpButton = (id: string) => document.querySelector<HTMLElement>(`[data-help-button="${id}"]`) as HTMLElement;
const held = (effectiveNow = "2026-10-15T10:25:00.000Z") => ({
  mode: "fixed" as const, realNow: new Date().toISOString(), effectiveNow, fixedAt: effectiveNow,
});
const posts = (server: ReturnType<typeof renderPanel>["server"], url: string) => server.to(url).filter((call) => call.method !== "GET");
const FAR = "2099-10-15T10:30:00.000Z";
const withCampaign = (overrides = {}) => makeSnapshot({ campaigns: [campaignRow({ scheduledAt: FAR, ...overrides })] });

/* ------------------------------------------------------------------ creating */

describe("Create Test Campaign", () => {
  const field = (label: string) => inDrawer().getByLabelText(label) as HTMLInputElement;

  it("offers the seven templates, each with its help", () => {
    renderPanel();
    const group = inDrawer().getByRole("group", { name: "Templates" });
    const names = within(group).getAllByRole("button").filter((b) => !b.matches("[data-help-button]")).map((b) => b.textContent);
    expect(names).toEqual([
      "Starts in 1 min", "Starts in 5 min", "Overdue by 5 min", "Large campaign for the rate limit",
      "Temporary SMTP failure", "Permanent SMTP failure", "Slow SMTP",
    ]);
  });

  it("has a template only fill the form: nothing is created until Create is pressed", async () => {
    const user = userEvent.setup();
    const view = renderPanel({ snapshot: makeSnapshot({ clock: held() }) });
    await waitFor(() => expect(screen.getByTestId("test-banner")).toHaveTextContent("Test time is held"));

    await user.click(inDrawer().getByRole("button", { name: "Starts in 5 min" }));

    expect(field("How to send").value).toBe("schedule");
    expect(field("Recipients").value).toBe("5");
    expect(field("Start date").value).toBe("2026-10-15");
    expect(field("Start time").value).toBe("10:30"); // five minutes after the held 10:25
    expect(posts(view.server, "/api/dev/campaigns")).toEqual([]);
  });

  it.each([
    ["Starts in 1 min", { mode: "schedule", time: "10:26", recipients: "5" }],
    ["Large campaign for the rate limit", { mode: "now", recipients: "30" }],
    ["Overdue by 5 min", { mode: "overdue", overdue: "5" }],
    ["Temporary SMTP failure", { mode: "now", scenario: "tempfail", failures: "1", recipients: "3" }],
    ["Permanent SMTP failure", { mode: "now", scenario: "permfail", recipients: "3" }],
    ["Slow SMTP", { mode: "now", scenario: "slow", delay: "3", recipients: "3" }],
  ] as const)("fills the form for %s", async (name, expected: Record<string, string>) => {
    const user = userEvent.setup();
    renderPanel({ snapshot: makeSnapshot({ clock: held() }) });
    await waitFor(() => expect(screen.getByTestId("test-banner")).toHaveTextContent("Test time is held"));

    await user.click(inDrawer().getByRole("button", { name }));

    expect(field("How to send").value).toBe(expected.mode);
    if (expected.time) expect(field("Start time").value).toBe(expected.time);
    if (expected.recipients) expect(field("Recipients").value).toBe(expected.recipients);
    if (expected.overdue) expect(field("Overdue by").value).toBe(expected.overdue);
    if (expected.scenario) expect(field("SMTP scenario").value).toBe(expected.scenario);
    if (expected.failures) expect(field("Temporary failures").value).toBe(expected.failures);
    if (expected.delay) expect(field("Response delay").value).toBe(expected.delay);
  });

  it("creates a campaign: sends how many, how, and which scenario; never an address", async () => {
    const user = userEvent.setup();
    const view = renderPanel({ snapshot: makeSnapshot({ clock: held() }) });
    await waitFor(() => expect(screen.getByTestId("test-banner")).toHaveTextContent("Test time is held"));
    await user.click(inDrawer().getByRole("button", { name: "Starts in 5 min" }));

    await user.click(inDrawer().getByRole("button", { name: "Create test campaign" }));

    await waitFor(() => expect(posts(view.server, "/api/dev/campaigns")).toHaveLength(1));
    const body = posts(view.server, "/api/dev/campaigns")[0].body as Record<string, unknown>;
    expect(body).toEqual({
      recipients: 5, mode: "schedule", scenario: "success", date: "2026-10-15", time: "10:30",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    expect(Object.keys(body).some((key) => /mail|address|recipientList|\bto\b/i.test(key))).toBe(false);
    expect(await inDrawer().findByText(/Test campaign “\[TEST\] New” created\./)).toBeInTheDocument();
  });

  it("has no field in which a real address could be typed", () => {
    renderPanel();
    expect(drawer().querySelector('input[type="email"]')).toBeNull();
    // No field is labelled as one for an address ("Max emails" is a number, not an address).
    for (const label of drawer().querySelectorAll("label")) {
      expect(label.textContent ?? "", label.outerHTML).not.toMatch(/^s*(e-?mail( address)?|address|recipient list|to)s*$/i);
    }
    for (const input of drawer().querySelectorAll("input")) {
      expect(input.getAttribute("name") ?? "", input.outerHTML).not.toMatch(/mail|address/i);
    }
  });

  it("refuses a number of recipients that is out of range, or not a number, before sending", async () => {
    const user = userEvent.setup();
    const view = renderPanel();
    for (const value of ["0", "-2", String(TEST_LIMITS.recipients.max + 1), "3.5", "many", ""]) {
      const input = field("Recipients");
      await user.clear(input);
      if (value) await user.type(input, value);
      await user.click(inDrawer().getByRole("button", { name: "Create test campaign" }));
      expect((await inDrawer().findAllByRole("alert")).length, value).toBeGreaterThan(0);
    }
    expect(posts(view.server, "/api/dev/campaigns")).toEqual([]);
  });

  it("says the range of recipients that it enforces", async () => {
    const user = userEvent.setup();
    renderPanel();
    const input = field("Recipients");
    await user.clear(input);
    await user.type(input, "501");
    await user.click(inDrawer().getByRole("button", { name: "Create test campaign" }));
    expect(await inDrawer().findByText("Recipients must be a whole number from 1 to 500")).toBeInTheDocument();
  });

  it("refuses, in the browser, a start that is not after the application's time", async () => {
    const user = userEvent.setup();
    const view = renderPanel({ snapshot: makeSnapshot({ clock: held() }) });
    await waitFor(() => expect(screen.getByTestId("test-banner")).toHaveTextContent("Test time is held"));
    await user.click(inDrawer().getByRole("button", { name: "Starts in 5 min" }));
    const time = field("Start time");

    await user.clear(time);
    await user.type(time, "10:25"); // the held moment itself: already too late
    await user.click(inDrawer().getByRole("button", { name: "Create test campaign" }));
    expect(await inDrawer().findByText("The scheduled time must be in the future.")).toBeInTheDocument();

    await user.clear(time);
    await user.type(time, "10:10");
    await user.click(inDrawer().getByRole("button", { name: "Create test campaign" }));

    expect(posts(view.server, "/api/dev/campaigns")).toEqual([]);
  });

  it("shows the field for each scenario only when it applies, and checks it against its range", async () => {
    const user = userEvent.setup();
    const view = renderPanel();
    expect(inDrawer().queryByLabelText("Response delay")).toBeNull();
    expect(inDrawer().queryByLabelText("Temporary failures")).toBeNull();

    await user.selectOptions(field("SMTP scenario"), "slow");
    const delay = field("Response delay");
    expect(delay.value).toBe(String(TEST_LIMITS.slowDelaySeconds.default));
    await user.clear(delay);
    await user.type(delay, String(TEST_LIMITS.slowDelaySeconds.max + 1));
    await user.click(inDrawer().getByRole("button", { name: "Create test campaign" }));
    expect(await inDrawer().findByText(/Slow response delay must be a whole number from 1 to 20/)).toBeInTheDocument();

    await user.selectOptions(field("SMTP scenario"), "tempfail");
    expect(inDrawer().queryByLabelText("Response delay")).toBeNull();
    const failures = field("Temporary failures");
    await user.clear(failures);
    await user.type(failures, "0");
    await user.click(inDrawer().getByRole("button", { name: "Create test campaign" }));
    expect(await inDrawer().findByText(/Temporary failures must be a whole number from 1 to 5/)).toBeInTheDocument();

    expect(posts(view.server, "/api/dev/campaigns")).toEqual([]);
  });

  it("names the four scenarios the way the requirements do", () => {
    renderPanel();
    const options = [...field("SMTP scenario") instanceof HTMLSelectElement ? (field("SMTP scenario") as unknown as HTMLSelectElement).options : []].map((o) => o.textContent);
    expect(options).toEqual(["Success", "Temporary failure", "Permanent failure", "Slow response"]);
  });

  it("offers an overdue campaign only as a test option, and sends the minutes", async () => {
    const user = userEvent.setup();
    const view = renderPanel();
    await user.selectOptions(field("How to send"), "overdue");
    expect(field("Overdue by").value).toBe(String(TEST_LIMITS.overdueMinutes.default));

    await user.click(inDrawer().getByRole("button", { name: "Create test campaign" }));

    await waitFor(() => expect(posts(view.server, "/api/dev/campaigns")).toHaveLength(1));
    expect(posts(view.server, "/api/dev/campaigns")[0].body).toMatchObject({ mode: "overdue", overdueMinutes: 5 });
    expect(within(field("How to send") as unknown as HTMLElement).getByText("Already overdue (test only)")).toBeInTheDocument();
  });

  it("keeps a name typed by the person, and offers the automatic one as the placeholder", async () => {
    const user = userEvent.setup();
    const view = renderPanel();
    expect(field("Campaign name").placeholder).toBe("Automatic");
    await user.type(field("Campaign name"), "Smoke");
    await user.click(inDrawer().getByRole("button", { name: "Create test campaign" }));
    await waitFor(() => expect(posts(view.server, "/api/dev/campaigns")).toHaveLength(1));
    expect(posts(view.server, "/api/dev/campaigns")[0].body).toMatchObject({ name: "Smoke" });
  });

  it("shows a refusal from the server in its own words and keeps the form as it was", async () => {
    const user = userEvent.setup();
    const view = renderPanel();
    view.server.failNext("/api/dev/campaigns", 400, { error: "Configure SMTP first", code: "TEST_INVALID" });
    await user.type(field("Campaign name"), "Keep me");

    await user.click(inDrawer().getByRole("button", { name: "Create test campaign" }));

    expect(await inDrawer().findByText("Configure SMTP first")).toBeInTheDocument();
    expect(field("Campaign name").value).toBe("Keep me");
  });
});

/* ------------------------------------------------------------ the selected campaign */

describe("the selected test campaign", () => {
  it("shows its status, its scheduledAt in UTC, and the same moment in your zone", async () => {
    renderPanel({ snapshot: withCampaign() });
    const section = within(await screen.findByRole("region", { name: "Test campaigns" }));

    expect(await section.findByText(FAR)).toBeInTheDocument();
    const time = section.getByText("In your time zone").closest("div")?.querySelector("time");
    expect(time?.getAttribute("datetime")).toBe(FAR);
    expect(section.getAllByText("SCHEDULED").length).toBeGreaterThan(0);
    expect(section.getByText(/waiting 0 · sending 0 · sent 0 · failed 0/)).toBeInTheDocument();
  });

  it("lists only what the snapshot gives it, marked [TEST], newest first", async () => {
    renderPanel({ snapshot: makeSnapshot({ campaigns: [campaignRow({ id: "b", name: "[TEST] Second" }), campaignRow({ id: "a", name: "[TEST] First" })] }) });
    const select = (await screen.findByLabelText("Test campaign")) as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual(["[TEST] Second · SCHEDULED", "[TEST] First · SCHEDULED"]);
  });

  it("says there is nothing yet when there are no test campaigns", () => {
    renderPanel();
    expect(inDrawer().getByText("No test campaigns yet. Create one above.")).toBeInTheDocument();
  });

  it("opens the campaign's own page", async () => {
    renderPanel({ snapshot: withCampaign() });
    const link = await inDrawer().findByRole("link", { name: "Open campaign" });
    expect(link).toHaveAttribute("href", "/campaigns/11111111-1111-4111-8111-111111111111");
  });

  it("runs a cycle through the same endpoint as Run now", async () => {
    const user = userEvent.setup();
    const view = renderPanel({ snapshot: withCampaign() });

    await user.click(await inDrawer().findByRole("button", { name: "Run cycle" }));

    await waitFor(() => expect(posts(view.server, "/api/dev/scheduler")).toHaveLength(1));
    expect(posts(view.server, "/api/dev/scheduler")[0].body).toEqual({ action: "run" });
  });

  it("changes the date and time and cancels only while the campaign is SCHEDULED", async () => {
    renderPanel({ snapshot: makeSnapshot({ campaigns: [campaignRow({ status: "COMPLETED", scheduledAt: FAR })] }) });
    const section = within(await screen.findByRole("region", { name: "Test campaigns" }));

    await waitFor(() => expect(section.getAllByText("COMPLETED").length).toBeGreaterThan(0));
    expect(section.getByRole("button", { name: "Change time" })).toBeDisabled();
    expect(section.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("opens the ordinary change-time form, on the application's own time", async () => {
    const user = userEvent.setup();
    renderPanel({ snapshot: withCampaign() });

    await user.click(await inDrawer().findByRole("button", { name: "Change time" }));

    const dialog = await screen.findByRole("dialog", { name: "Change send time" });
    expect(dialog).toHaveTextContent("[TEST] Five in five");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("opens the ordinary cancel confirmation", async () => {
    const user = userEvent.setup();
    renderPanel({ snapshot: withCampaign() });

    await user.click(await inDrawer().findByRole("button", { name: "Cancel" }));

    expect(await screen.findByRole("dialog", { name: "Cancel scheduled campaign?" })).toBeInTheDocument();
  });

  it("shows the queue rows and the status history on request, and hides them again", async () => {
    const user = userEvent.setup();
    renderPanel({ snapshot: withCampaign() });

    await user.click(await inDrawer().findByRole("button", { name: "Queue rows" }));
    const table = await inDrawer().findByRole("table", { name: "Queue rows of the selected campaign" });
    expect(within(table).getByText("success-abc123-001@test.invalid")).toBeInTheDocument();
    expect(within(table).getByText("451 try later")).toBeInTheDocument();
    await user.click(inDrawer().getByRole("button", { name: "Hide queue rows" }));
    expect(inDrawer().queryByRole("table")).toBeNull();

    await user.click(inDrawer().getByRole("button", { name: "Status history" }));
    const history = await inDrawer().findByRole("list", { name: "Status history of the selected campaign" });
    expect(within(history).getByText("Campaign created (draft)")).toBeInTheDocument();
    expect(within(history).getByText(/Campaign “\[TEST\] Five in five” scheduled for/)).toBeInTheDocument();
  });

  it("asks before resetting a campaign, sends nothing if the person backs out, and deletes only on confirmation", async () => {
    const user = userEvent.setup();
    const view = renderPanel({ snapshot: withCampaign() });

    await user.click(await inDrawer().findByRole("button", { name: "Reset campaign" }));
    const dialog = await screen.findByRole("dialog", { name: "Reset test campaign?" });
    expect(dialog).toHaveTextContent("Real campaigns are not touched");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(posts(view.server, "/api/dev/campaigns/11111111-1111-4111-8111-111111111111")).toEqual([]);

    await user.click(inDrawer().getByRole("button", { name: "Reset campaign" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Reset test campaign?" })).getByRole("button", { name: "Reset" }));

    await waitFor(() => expect(view.server.calls.filter((call) => call.method === "DELETE")).toHaveLength(1));
    expect(await inDrawer().findByText(/was reset\. Made-up contacts removed: 3\./)).toBeInTheDocument();
    await waitFor(() => expect(inDrawer().queryByText("[TEST] Five in five", { selector: "option" })).toBeNull());
  });

  it("offers no action that sets a status directly", () => {
    renderPanel({ snapshot: withCampaign() });
    const names = [...drawer().querySelectorAll("button")].map((b) => b.textContent ?? "");
    for (const forbidden of [/mark.*complete/i, /set.*completed/i, /force/i, /send.*directly/i, /skip.*queue/i]) {
      expect(names.filter((name) => forbidden.test(name)), String(forbidden)).toEqual([]);
    }
  });
});

/* ---------------------------------------------------------------------- journal */

describe("the event journal", () => {
  const events = () => [
    journalEntry(1, { type: "campaign.created", source: "panel", campaignId: "11111111-1111-4111-8111-111111111111", to: "DRAFT", data: { test: true } }),
    journalEntry(2, { type: "scheduler.cycle.started", data: { cycle: 1, trigger: "run-now" } }),
    journalEntry(3, { type: "campaign.activated", campaignId: "11111111-1111-4111-8111-111111111111", from: "SCHEDULED", to: "QUEUED", effectiveAt: "2026-10-15T10:30:00.000Z", data: {} }),
    journalEntry(4, { type: "rate.allowed", source: "rate-limiter", data: { count: 2, maxEmails: 2, windowSeconds: 10 } }),
  ];

  it("lists what happened, oldest first, with the time, where it came from, and the campaign's name", async () => {
    renderPanel({ snapshot: makeSnapshot({ campaigns: [campaignRow()], events: events(), latestEventId: 4 }) });

    const log = await screen.findByTestId("journal");
    const items = within(log).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent("Campaign “[TEST] Five in five” created as DRAFT");
    expect(items[0]).toHaveTextContent("Panel");
    expect(items[1]).toHaveTextContent("Scheduler cycle 1 started (Run now)");
    expect(items[2]).toHaveTextContent("Campaign “[TEST] Five in five” moved from SCHEDULED to QUEUED");
    expect(items[3]).toHaveTextContent("Rate limiter allowed 2 emails (limit 2 per 10 s)");
    expect(items[3]).toHaveTextContent("Rate limiter");
    expect(items[0].querySelector("time")).not.toBeNull();
    expect(items[2]).toHaveTextContent("test time");
  });

  it("says the count and the most it shows", async () => {
    renderPanel({ snapshot: makeSnapshot({ events: events(), latestEventId: 4 }) });
    const section = within(screen.getByRole("region", { name: "Event journal" }));
    expect(await section.findByText("4 events")).toBeInTheDocument();
    expect(section.getByText(`${TEST_LIMITS.eventLog.show} latest`)).toBeInTheDocument();
  });

  it("keeps at most the number it promises, dropping the oldest", async () => {
    const many = Array.from({ length: TEST_LIMITS.eventLog.show + 40 }, (_, index) => journalEntry(index + 1, { data: { cycle: index + 1, trigger: "run-now" } }));
    renderPanel({ snapshot: makeSnapshot({ events: many, latestEventId: many.length }) });

    const log = await screen.findByTestId("journal");
    const items = within(log).getAllByRole("listitem");
    expect(items).toHaveLength(TEST_LIMITS.eventLog.show);
    expect(items[0]).toHaveTextContent("cycle 41");
    expect(items[items.length - 1]).toHaveTextContent(`cycle ${many.length}`);
  });

  it("clears only the view: what happens next still appears", async () => {
    const user = userEvent.setup();
    const view = renderPanel({ snapshot: makeSnapshot({ events: events(), latestEventId: 4 }) });
    await screen.findByTestId("journal");

    await user.click(inDrawer().getByRole("button", { name: "Clear view" }));
    expect(screen.queryByTestId("journal")).toBeNull();
    expect(inDrawer().getByText(/Nothing here yet/)).toBeInTheDocument();
    expect(view.server.state.events).toHaveLength(4); // the server's record is untouched

    view.server.state.events = [...events(), journalEntry(5, { type: "rate.limited", source: "rate-limiter", data: { sent: 2, maxEmails: 2, windowSeconds: 10 } })];
    await user.click(within(screen.getByRole("region", { name: "Event journal" })).getByRole("button", { name: "Refresh" }));

    const log = await screen.findByTestId("journal");
    expect(within(log).getAllByRole("listitem")).toHaveLength(1);
    expect(log).toHaveTextContent("Rate limit reached: 2 sent");
  });

  it("refreshes on request, and can be told not to refresh itself", async () => {
    const user = userEvent.setup();
    const view = renderPanel({ snapshot: makeSnapshot({ events: [], latestEventId: 0 }) });
    const checkbox = inDrawer().getByRole("checkbox", { name: "Refresh automatically" });
    expect(checkbox).toBeChecked();

    await user.click(checkbox);
    expect(JSON.parse(window.localStorage.getItem(UI_STATE_KEY) ?? "{}").autoRefresh).toBe(false);

    view.server.state.events = events();
    await user.click(within(screen.getByRole("region", { name: "Event journal" })).getByRole("button", { name: "Refresh" }));
    expect(await screen.findByTestId("journal")).toBeInTheDocument();
  });

  it("contains no address, no email text and no credential", async () => {
    renderPanel({ snapshot: makeSnapshot({ events: events(), latestEventId: 4 }) });
    const log = await screen.findByTestId("journal");
    expect(log.textContent).not.toMatch(/@|password|token|secret|authorization/i);
  });

  it("names an event it does not know by its type, without breaking", async () => {
    renderPanel({ snapshot: makeSnapshot({ events: [journalEntry(1, { type: "something.new", data: {} })], latestEventId: 1 }) });
    expect(await screen.findByText("Event: something.new")).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------- the tour */

describe("the tour", () => {
  const start = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(inDrawer().getByRole("button", { name: "How to test scheduling" }));
    return screen.findByTestId("tour-card");
  };

  it("starts from a button, at the first step, saying where it is", async () => {
    const user = userEvent.setup();
    renderPanel({ snapshot: withCampaign() });

    const card = await start(user);

    expect(card).toHaveAttribute("role", "region");
    expect(within(card).getByText("Step 1 of 10")).toBeInTheDocument();
    expect(within(card).getByRole("heading", { name: "Hold the test clock" })).toBeInTheDocument();
    expect(within(card).getByText(/Application time shows the moment you set/)).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Back" })).toBeDisabled();
  });

  it("has ten steps, and each says what to do, what to expect, and lights an element that is there", async () => {
    const user = userEvent.setup();
    renderPanel({ snapshot: withCampaign() });
    const card = await start(user);

    for (let step = 0; step < TOUR_STEPS.length; step += 1) {
      expect(within(card).getByText(`Step ${step + 1} of 10`)).toBeInTheDocument();
      expect(within(card).getByText("Expected result:")).toBeInTheDocument();
      expect(card.textContent).not.toMatch(/\{\w+\}/);
      await waitFor(() => expect(document.querySelector(`[data-tour="${TOUR_STEPS[step].target}"]`)).not.toBeNull());
      await waitFor(() => expect(screen.getByTestId("tour-highlight")).toBeInTheDocument());
      if (step < TOUR_STEPS.length - 1) await user.click(within(card).getByRole("button", { name: "Next" }));
    }
    expect(within(card).getByRole("button", { name: "Finish" })).toBeInTheDocument();
  });

  it("goes through all the steps to the end, and finishing closes it and rewinds it", async () => {
    const user = userEvent.setup();
    renderPanel({ snapshot: withCampaign() });
    const card = await start(user);

    for (let step = 0; step < TOUR_STEPS.length - 1; step += 1) await user.click(within(card).getByRole("button", { name: "Next" }));
    await user.click(within(card).getByRole("button", { name: "Finish" }));

    expect(screen.queryByTestId("tour-card")).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(UI_STATE_KEY) ?? "{}").tourStep).toBe(0);
    expect((await start(user)).textContent).toContain("Step 1 of 10");
  });

  it("goes back a step", async () => {
    const user = userEvent.setup();
    renderPanel({ snapshot: withCampaign() });
    const card = await start(user);

    await user.click(within(card).getByRole("button", { name: "Next" }));
    await user.click(within(card).getByRole("button", { name: "Next" }));
    expect(within(card).getByText("Step 3 of 10")).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Back" }));

    expect(within(card).getByText("Step 2 of 10")).toBeInTheDocument();
  });

  it("can be closed and started again, picking up where it was left; and Start over goes back to the first step", async () => {
    const user = userEvent.setup();
    renderPanel({ snapshot: withCampaign() });
    const card = await start(user);
    await user.click(within(card).getByRole("button", { name: "Next" }));
    await user.click(within(card).getByRole("button", { name: "Next" }));

    await user.click(within(card).getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("tour-card")).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(UI_STATE_KEY) ?? "{}").tourStep).toBe(2);
    expect(inDrawer().getByRole("button", { name: "How to test scheduling" })).toHaveFocus();

    const again = await start(user);
    expect(within(again).getByText("Step 3 of 10")).toBeInTheDocument();
    await user.click(within(again).getByRole("button", { name: "Start over" }));
    expect(within(again).getByText("Step 1 of 10")).toBeInTheDocument();
  });

  it("closes on Escape, but leaves the drawer open", async () => {
    const user = userEvent.setup();
    renderPanel({ snapshot: withCampaign() });
    await start(user);

    await user.keyboard("{Escape}");

    expect(screen.queryByTestId("tour-card")).toBeNull();
    expect(screen.getByTestId("test-panel")).toBeInTheDocument();
  });

  it("opens the section a step needs, and changes no setting by itself", async () => {
    const user = userEvent.setup();
    const view = renderPanel({ snapshot: withCampaign(), sections: { clock: false, scheduler: false, queue: false, create: false, campaigns: false, journal: false, guides: false } });
    const before = view.server.calls.length;
    const card = await start(user);

    for (let step = 0; step < TOUR_STEPS.length - 1; step += 1) {
      await waitFor(() => expect(document.querySelector(`[data-tour="${TOUR_STEPS[step].target}"]`)).not.toBeNull());
      await user.click(within(card).getByRole("button", { name: "Next" }));
    }

    expect(view.server.calls.slice(before).filter((call) => call.method !== "GET")).toEqual([]);
  });

  it("is reachable by keyboard: Tab through Back, Next, Close and Start over; Enter moves on", async () => {
    const user = userEvent.setup();
    renderPanel({ snapshot: withCampaign() });
    const card = await start(user);
    expect(card).toHaveFocus();

    await user.tab(); // Back is disabled on the first step
    expect(within(card).getByRole("button", { name: "Next" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(within(card).getByText("Step 2 of 10")).toBeInTheDocument();
    await user.tab();
    expect(within(card).getByRole("button", { name: "Close" })).toHaveFocus();
    await user.tab();
    expect(within(card).getByRole("button", { name: "Start over" })).toHaveFocus();
  });

  it("announces the step to a screen reader", async () => {
    const user = userEvent.setup();
    renderPanel({ snapshot: withCampaign() });
    const card = await start(user);
    const live = card.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    expect(live?.textContent).toBe("Step 1 of 10");
    await user.click(within(card).getByRole("button", { name: "Next" }));
    expect(live?.textContent).toBe("Step 2 of 10");
  });

  it("is in Russian on a Russian screen", async () => {
    const user = userEvent.setup();
    renderPanel({ locale: "ru", snapshot: withCampaign() });
    await user.click(inDrawer().getByRole("button", { name: "Как протестировать планирование" }));

    const card = await screen.findByTestId("tour-card");
    expect(within(card).getByText("Шаг 1 из 10")).toBeInTheDocument();
    expect(within(card).getByRole("heading", { name: "Зафиксируйте тестовое время" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Далее" })).toBeInTheDocument();
    expect(card.textContent).not.toMatch(/Step|Next|Back/);
  });
});

/* ------------------------------------------------------------------- scenarios */

describe("the scenarios", () => {
  it("are nine, each with what to set first, what to do, the statuses, the jobs and how to put it back", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(inDrawer().getByRole("button", { name: "Scenarios" }));
    expect(SCENARIO_IDS).toHaveLength(9);

    const expected = [
      "Check a normal scheduled start", "Check sending right away", "Check cancelling", "Check moving the start time",
      "Check a missed start", "Check recovery after a restart", "Check rate limiting",
      "Check a temporary SMTP failure", "Check a permanent SMTP failure",
    ];
    for (const title of expected) {
      const toggle = inDrawer().getByRole("button", { name: title });
      await user.click(toggle);
      const card = toggle.closest("[data-scenario]") as HTMLElement;
      for (const part of ["Start with", "Do this", "Expect these statuses", "Expect this many jobs", "Put it back"]) {
        expect(within(card).getByText(part), `${title}: ${part}`).toBeInTheDocument();
      }
      expect(card.textContent).not.toMatch(/\{\w+\}/);
      expect(within(card).getAllByRole("listitem").length).toBeGreaterThanOrEqual(5);
    }
  });

  it("show the expected number of jobs, from the same templates the form uses", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(inDrawer().getByRole("button", { name: "Scenarios" }));
    await user.click(inDrawer().getByRole("button", { name: "Check rate limiting" }));

    const card = inDrawer().getByRole("button", { name: "Check rate limiting" }).closest("[data-scenario]") as HTMLElement;
    expect(card).toHaveTextContent("Max emails 2, Interval 10 seconds");
    expect(card).toHaveTextContent("30 recipients");
    expect(card).toHaveTextContent("Waiting jobs fall from 30 to 0");
  });

  it("only explain: opening one changes nothing and sends nothing", async () => {
    const user = userEvent.setup();
    const view = renderPanel();
    const before = view.server.calls.length;
    await user.click(inDrawer().getByRole("button", { name: "Scenarios" }));
    await user.click(inDrawer().getByRole("button", { name: "Check cancelling" }));
    expect(view.server.calls.slice(before).filter((call) => call.method !== "GET")).toEqual([]);
  });
});

/* ------------------------------------------------------------- the Russian screen */

describe("on a Russian screen", () => {
  it("is Russian throughout: its title, its sections, its buttons, its labels", async () => {
    const user = userEvent.setup();
    renderPanel({ locale: "ru" });
    await user.click(inDrawer().getByRole("radio", { name: "Фиксированное тестовое время" }));

    expect(screen.getByRole("complementary", { name: "Тестовая панель" })).toBeInTheDocument();
    for (const section of ["Тестовое время", "Планировщик", "Очередь и rate limit", "Создать тестовую кампанию", "Тестовые кампании", "Журнал событий", "Сценарии"]) {
      expect(inDrawer().getAllByRole("button", { name: section }).length, section).toBeGreaterThan(0);
    }
    for (const name of ["Задать", "Продвинуть", "Сбросить на реальное время", "Старт", "Стоп", "Запустить сейчас", "Применить", "Сбросить на стандартные", "Создать тестовую кампанию"]) {
      expect(inDrawer().getAllByRole("button", { name }).length, name).toBeGreaterThan(0);
    }
    expect(screen.getByTestId("test-banner")).toHaveTextContent("ТЕСТОВЫЙ РЕЖИМ");
    expect(inDrawer().getByLabelText("Интервал планировщика")).toBeInTheDocument();
  });

  it("does not mix English into the panel's own words", () => {
    renderPanel({ locale: "ru" });
    const text = drawer().textContent ?? "";
    for (const english of ["Run now", "Test Clock", "Queue and Rate Limit", "Create test campaign", "Scheduler interval", "Fixed test time"]) {
      expect(text, english).not.toContain(english);
    }
  });

  it("words its refusals in Russian, from the same limits", async () => {
    const user = userEvent.setup();
    renderPanel({ locale: "ru" });
    const field = inDrawer().getByLabelText("Интервал планировщика");
    await user.clear(field);
    await user.type(field, "0");
    await user.tab();
    expect(await inDrawer().findByText("«Интервал планировщика»: нужно целое число от 1 до 300")).toBeInTheDocument();
  });

  it("gives every help button a Russian name: «Подробнее: …»", () => {
    renderPanel({ locale: "ru" });
    const buttons = [...drawer().querySelectorAll<HTMLElement>("[data-help-button]")];
    expect(buttons.length).toBeGreaterThan(40);
    for (const button of buttons) expect(button.getAttribute("aria-label")).toMatch(/^Подробнее: /);
  });

  it("shows the dates in the Russian way and keeps statuses and zone names as they are", async () => {
    renderPanel({ locale: "ru", snapshot: withCampaign() });
    const section = within(await screen.findByRole("region", { name: "Тестовые кампании" }));
    expect(await section.findByText(FAR)).toBeInTheDocument(); // the UTC instant, unchanged
    expect(section.getAllByText(/Запланирована/).length).toBeGreaterThan(0); // the status, worded by the app's own dictionary
  });
});

/* ------------------------------------------------------------------ what it remembers */

describe("what the panel remembers", () => {
  it("keeps only preferences about itself, in this browser, and nothing else", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(inDrawer().getByRole("button", { name: "Scheduler" }));
    await user.selectOptions(inDrawer().getByLabelText("Step"), "hour");
    await user.click(inDrawer().getByRole("button", { name: "How to test scheduling" }));
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(Object.keys(window.localStorage)).toEqual([UI_STATE_KEY]);
    const saved = JSON.parse(window.localStorage.getItem(UI_STATE_KEY) ?? "{}");
    expect(Object.keys(saved).sort()).toEqual(["advanceStep", "autoRefresh", "open", "sections", "tourStep"]);
    expect(saved).toMatchObject({ open: true, advanceStep: "hour", tourStep: 1 });
    expect(saved.sections.scheduler).toBe(false);
    expect(window.sessionStorage.length).toBe(0);
    expect(document.cookie).toBe("");
  });

  it("starts in the state it was left in", () => {
    renderPanel({ open: true, sections: { clock: false, scheduler: true, queue: false, create: false, campaigns: false, journal: false, guides: false } });
    expect(inDrawer().queryByRole("radio", { name: "Fixed test time" })).toBeNull();
    expect(inDrawer().getByRole("button", { name: "Run now" })).toBeInTheDocument();
  });

  it("carries on with nothing remembered when the browser will not let it read or write", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => renderPanel({ open: false })).not.toThrow();
    vi.restoreAllMocks();
  });
});

/* ---------------------------------------------------------------- accessibility */

describe("accessibility, as axe judges it", () => {
  // Contrast needs real layout, which a DOM without a screen cannot give: it is checked from the colours themselves, in testpanel-contrast.
  const audit = async (node: Element) => {
    const results = await axe.run(node as HTMLElement, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
      rules: { "color-contrast": { enabled: false } },
    });
    return results.violations.map((violation) => `${violation.impact}: ${violation.id} — ${violation.help} (${violation.nodes.slice(0, 3).map((n) => n.html.slice(0, 90)).join(" | ")})`);
  };

  it("finds nothing wrong with the open panel", async () => {
    renderPanel({ snapshot: withCampaign() });
    await screen.findByText(FAR);
    expect(await audit(drawer())).toEqual([]);
  });

  it("finds nothing wrong with every part of the panel open at once (fixed clock, schedule, slow scenario, queue rows)", async () => {
    const user = userEvent.setup();
    renderPanel({ snapshot: withCampaign() });
    await screen.findByText(FAR);
    await user.click(inDrawer().getByRole("radio", { name: "Fixed test time" }));
    await user.selectOptions(inDrawer().getByLabelText("How to send"), "schedule");
    await user.selectOptions(inDrawer().getByLabelText("SMTP scenario"), "slow");
    await user.click(inDrawer().getByRole("button", { name: "Queue rows" }));
    await user.click(inDrawer().getByRole("button", { name: "Status history" }));
    await user.click(inDrawer().getByRole("button", { name: "Scenarios" }));
    await user.click(inDrawer().getByRole("button", { name: "Check rate limiting" }));
    await inDrawer().findByRole("table");

    expect(await audit(drawer())).toEqual([]);
  });

  it("finds nothing wrong with a help popover open", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(helpButton("schedInterval"));
    expect(await audit(drawer())).toEqual([]);
  });

  it("finds nothing wrong with a tooltip open", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(helpButton("queueWaiting"));
    expect(await audit(drawer())).toEqual([]);
  });

  it("finds nothing wrong with the tour open", async () => {
    const user = userEvent.setup();
    renderPanel({ snapshot: withCampaign() });
    await user.click(inDrawer().getByRole("button", { name: "How to test scheduling" }));
    const card = await screen.findByTestId("tour-card");
    expect(await audit(card)).toEqual([]);
    expect(await audit(document.body)).toEqual([]);
  });

  it("finds nothing wrong with the Russian panel", async () => {
    renderPanel({ locale: "ru", snapshot: withCampaign() });
    await screen.findByText(FAR);
    expect(await audit(drawer())).toEqual([]);
  });

  it("finds nothing wrong with the banner and the floating button", async () => {
    renderPanel({ open: false });
    expect(await audit(screen.getByTestId("test-banner"))).toEqual([]);
    expect(await audit(screen.getByRole("button", { name: /Test Panel/ }))).toEqual([]);
  });

  it("gives the drawer a name and an order a keyboard can follow: title first, then the tour, then the sections", () => {
    renderPanel();
    const focusable = [...drawer().querySelectorAll<HTMLElement>("button, input, select, a[href]")].filter((el) => !el.hasAttribute("disabled"));
    expect(focusable[0].getAttribute("aria-label") ?? focusable[0].textContent).toMatch(/More: Test mode|Test mode/);
    const order = focusable.map((el) => el.textContent ?? "");
    expect(order.findIndex((text) => text === "How to test scheduling")).toBeLessThan(order.findIndex((text) => text === "Test Clock▾"));
  });

  it("shows a visible focus ring on its buttons (a focus-visible style in the stylesheet)", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toMatch(/\.help-icon:focus-visible\s*\{[^}]*outline:\s*2px solid/);
    expect(css).toMatch(/\.help-close:focus-visible\s*\{[^}]*outline:\s*2px solid/);
    expect(css).toMatch(/\.btn:focus-visible\s*\{[^}]*outline:/);
  });
});
