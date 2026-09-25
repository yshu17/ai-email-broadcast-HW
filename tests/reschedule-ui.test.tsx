import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import CampaignsTable, { type CampaignRow } from "@/app/(admin)/campaigns/CampaignsTable";
import CampaignReport from "@/app/(admin)/campaigns/[id]/CampaignReport";
import RescheduleDialog, { attemptReschedule, requestReschedule } from "@/components/RescheduleDialog";
import { LocaleProvider } from "@/i18n/client";

/**
 * Changing the time of a scheduled campaign, from the person's side: where the action
 * is offered, what the form shows, and what happens between pressing "Save" and the
 * request. The locale, the time zone and "now" are pinned by props, so nothing here
 * depends on the machine or on the clock.
 *
 * The form is rendered to static markup (what a person would read); what pressing
 * "Save" does lives in `attemptReschedule`, a plain function, so it is driven directly:
 * with a real clock value, a real time zone and a stand-in for the network.
 */
afterEach(() => vi.unstubAllGlobals());

const noop = () => undefined;
const MADRID = { locale: "en-GB", timeZone: "Europe/Madrid" };
const NOW = new Date("2026-10-01T10:00:00.000Z");
const inRu = (node: React.ReactNode) => renderToStaticMarkup(<LocaleProvider locale="ru">{node}</LocaleProvider>);

function row(overrides: Partial<CampaignRow> = {}): CampaignRow {
  return {
    id: "c1", name: "Autumn sale", subject: "Big discounts", status: "DRAFT",
    createdAt: "2026-09-01T10:00:00.000Z", scheduledAt: null, startedAt: null, completedAt: null,
    totalRecipients: 0, estimatedRecipients: null, queued: 0, sending: 0, sent: 0, failed: 0, uniqueOpens: 0,
    ...overrides,
  };
}
const scheduled = (overrides: Partial<CampaignRow> = {}) =>
  row({ status: "SCHEDULED", scheduledAt: "2026-10-15T08:30:00.000Z", estimatedRecipients: 4850, ...overrides });

const table = (rows: CampaignRow[]) =>
  renderToStaticMarkup(<CampaignsTable rows={rows} onDuplicate={noop} onCancelScheduled={noop} onReschedule={noop} {...MADRID} />);

/* ------------------------------------------------------- where the action is offered */

describe("the 'Change time' action", () => {
  it("is offered for a SCHEDULED campaign in the list, labelled with the campaign's name", () => {
    const html = table([scheduled()]);

    expect(html).toContain('aria-label="Change the send time of the scheduled campaign: Autumn sale"');
    expect(html).toContain(">Change time<");
  });

  it("sits beside the existing Cancel and Duplicate actions, which stay", () => {
    const html = table([scheduled()]);

    expect(html).toContain('aria-label="Cancel scheduled campaign: Autumn sale"');
    expect(html).toContain('aria-label="Duplicate campaign: Autumn sale"');
  });

  it.each(["DRAFT", "QUEUED", "SENDING", "PAUSED", "COMPLETED", "CANCELLED"])(
    "is not offered for a %s campaign",
    (status) => {
      const html = table([row({ status, scheduledAt: "2026-10-15T08:30:00.000Z", totalRecipients: 12 })]);

      expect(html).not.toContain("Change time");
      expect(html).not.toContain("Change the send time");
    },
  );

  it("is offered only on the SCHEDULED row of a mixed list", () => {
    const html = table([
      row({ id: "a", name: "Draft one" }),
      scheduled({ id: "b", name: "Scheduled one" }),
      row({ id: "c", name: "Sent one", status: "COMPLETED" }),
    ]);

    expect(html.match(/Change the send time of the scheduled campaign/g)).toHaveLength(1);
    expect(html).toContain("Change the send time of the scheduled campaign: Scheduled one");
  });

  it("is offered on the campaign's own page while it is SCHEDULED, and only then", () => {
    const page = (status: string) =>
      renderToStaticMarkup(<CampaignReport campaignId="c1" initialStatus={status} onStatusChange={noop} />);

    expect(page("SCHEDULED")).toContain("Change time");
    for (const status of ["QUEUED", "SENDING", "PAUSED", "COMPLETED", "CANCELLED"]) {
      expect(page(status), status).not.toContain("Change time");
    }
  });
});

/* ------------------------------------------------------------------- the form */

describe("the change-time form", () => {
  const target = { id: "c1", name: "Autumn sale", scheduledAt: "2026-10-15T08:30:00.000Z" };
  const dialog = (overrides: Partial<Parameters<typeof RescheduleDialog>[0]> = {}) =>
    renderToStaticMarkup(
      <RescheduleDialog campaign={target} onClose={noop} onRescheduled={noop} onStale={noop} now={NOW} {...MADRID} {...overrides} />,
    );
  const input = (html: string, id: string) => new RegExp(`<input[^>]*id="${id}"[^>]*>`).exec(html)?.[0] ?? "";

  it("is an accessible dialog with a title, a Save button and a Cancel button", () => {
    const html = dialog();

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toMatch(/aria-labelledby="[^"]+"/);
    expect(html).toContain("Change send time");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Save<\/button>/);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Cancel<\/button>/);
  });

  it("names the campaign and shows the time it has now, in the viewer's zone, with the zone named", () => {
    const html = dialog();

    expect(html).toContain("Autumn sale");
    expect(html).toContain("Currently scheduled for");
    // 08:30 UTC is 10:30 in Madrid in October (summer time, UTC+2).
    expect(html).toMatch(/15 Oct 2026, 10:30 (GMT\+2|CEST)/);
    expect(html).toContain("Your time zone: Europe/Madrid (UTC+02:00)");
  });

  it("opens with the current date and time already in the fields", () => {
    const html = dialog();

    expect(input(html, "rescheduleDate")).toContain('value="2026-10-15"');
    expect(input(html, "rescheduleTime")).toContain('value="10:30"');
  });

  it("fills the fields in whatever zone the viewer is in, for the same instant", () => {
    const tokyo = dialog({ timeZone: "Asia/Tokyo" });
    const newYork = dialog({ timeZone: "America/New_York" });

    expect(input(tokyo, "rescheduleTime")).toContain('value="17:30"');
    expect(input(newYork, "rescheduleTime")).toContain('value="04:30"');
    expect(tokyo).toContain("Asia/Tokyo (UTC+09:00)");
    expect(newYork).toContain("America/New_York (UTC-04:00)");
  });

  it("does not let the person pick a day that has already gone (the picker's floor is today, in their zone)", () => {
    const html = dialog();

    expect(input(html, "rescheduleDate")).toContain('min="2026-10-01"');
    // Today's floor for the time input applies only while the chosen date is today.
    expect(input(html, "rescheduleTime")).not.toContain("min=");
    expect(input(dialog({ campaign: { ...target, scheduledAt: "2026-10-01T10:30:00.000Z" } }), "rescheduleTime")).toContain('min="12:01"');
  });

  it("shows no error before anything has been changed", () => {
    expect(dialog()).not.toContain('role="alert"');
  });

  it("when the current time is one of two the clocks repeat, says which one it is and keeps the choice", () => {
    // 02:30 in Madrid on 25 Oct 2026 happens twice; 01:30 UTC is the second time, after the clocks go back.
    const html = dialog({ campaign: { ...target, scheduledAt: "2026-10-25T01:30:00.000Z" } });

    expect(input(html, "rescheduleTime")).toContain('value="02:30"');
    expect(html).toContain("Which 02:30 do you mean?");
    const radios = html.match(/<input[^>]*name="scheduleOccurrence"[^>]*>/g) ?? [];
    expect(radios).toHaveLength(2);
    expect(radios.find((radio) => radio.includes('value="second"'))).toContain("checked");
    expect(radios.find((radio) => radio.includes('value="first"'))).not.toContain("checked");
  });

  it("uses its own field ids, so it can sit on a page beside the first-time scheduling form", () => {
    const html = dialog();

    expect(html).toContain('id="rescheduleDate"');
    expect(html).not.toContain('id="scheduleDate"');
  });

  it("is worded in Russian for a Russian screen", () => {
    const html = inRu(<RescheduleDialog campaign={target} onClose={noop} onRescheduled={noop} onStale={noop} now={NOW} {...MADRID} />);

    expect(html).toContain("Изменить время отправки");
    expect(html).toContain("Сейчас запланировано на");
    expect(html).toContain("Ваш часовой пояс: Europe/Madrid (UTC+02:00)");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Сохранить<\/button>/);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Отмена<\/button>/);
    expect(html).not.toMatch(/Change|Save|Currently/);
  });

  it("offers the action in Russian in the list", () => {
    const html = inRu(<CampaignsTable rows={[scheduled()]} onDuplicate={noop} onCancelScheduled={noop} onReschedule={noop} {...MADRID} />);

    expect(html).toContain(">Изменить время<");
    expect(html).toContain('aria-label="Изменить время отправки запланированной рассылки: Autumn sale"');
  });
});

/* ------------------------------------------------- pressing Save: attemptReschedule */

describe("pressing Save", () => {
  const respond = (status: number, body: unknown) =>
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })));
  const calls = () => (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;

  const attempt = (
    plan: { date: string; time: string; occurrence?: "first" | "second" },
    options: { now?: Date; timeZone?: string; inFlight?: { current: boolean } } = {},
  ) => attemptReschedule({
    campaignId: "c1", plan, now: NOW, timeZone: "Europe/Madrid", inFlight: { current: false }, ...options,
  });

  it("sends the new time to the schedule endpoint as one unambiguous instant, and reports the saved time", async () => {
    respond(200, { ok: true, scheduledAt: "2026-10-16T07:00:00.000Z", campaign: { id: "c1", status: "SCHEDULED" } });

    const result = await attempt({ date: "2026-10-16", time: "09:00" });

    expect(result).toEqual({ status: "saved", scheduledAt: "2026-10-16T07:00:00.000Z" });
    expect(calls()).toHaveLength(1);
    const [url, init] = calls()[0];
    expect(url).toBe("/api/campaigns/c1/schedule");
    expect(init.method).toBe("PATCH");
    // 09:00 in Madrid on 16 Oct 2026 (summer time, UTC+2) is 07:00 UTC. The zone is applied once.
    expect(JSON.parse(init.body)).toEqual({ scheduledAt: "2026-10-16T07:00:00.000Z" });
  });

  it("reads the typed time in the person's own zone, whichever zone that is", async () => {
    respond(200, { ok: true, scheduledAt: "x" });

    await attempt({ date: "2026-10-16", time: "09:00" }, { timeZone: "Asia/Tokyo" });
    await attempt({ date: "2026-10-16", time: "09:00" }, { timeZone: "America/New_York" });
    await attempt({ date: "2026-10-16", time: "09:00" }, { timeZone: "UTC" });

    const sent = calls().map(([, init]) => JSON.parse(init.body).scheduledAt);
    expect(sent).toEqual(["2026-10-16T00:00:00.000Z", "2026-10-16T13:00:00.000Z", "2026-10-16T09:00:00.000Z"]);
  });

  it("moves to an earlier time as readily as to a later one", async () => {
    respond(200, { ok: true, scheduledAt: "2026-10-15T16:00:00.000Z" });

    const result = await attempt({ date: "2026-10-15", time: "18:00" });

    expect(result).toEqual({ status: "saved", scheduledAt: "2026-10-15T16:00:00.000Z" });
    expect(JSON.parse(calls()[0][1].body)).toEqual({ scheduledAt: "2026-10-15T16:00:00.000Z" });
  });

  it("resolves a time that clocks going back repeat by the occurrence the person picked, and refuses to guess", async () => {
    respond(200, { ok: true, scheduledAt: "x" });

    const unpicked = await attempt({ date: "2026-10-25", time: "02:30" });
    expect(unpicked).toMatchObject({ status: "invalid", failure: { code: "SCHEDULE_AMBIGUOUS" } });
    expect(calls()).toHaveLength(0);

    await attempt({ date: "2026-10-25", time: "02:30", occurrence: "first" });
    await attempt({ date: "2026-10-25", time: "02:30", occurrence: "second" });
    expect(calls().map(([, init]) => JSON.parse(init.body).scheduledAt)).toEqual([
      "2026-10-25T00:30:00.000Z", "2026-10-25T01:30:00.000Z",
    ]);
  });

  it("refuses, before any request, a time that the clocks skip", async () => {
    respond(200, { ok: true });

    // 02:30 on 29 March 2027 does not exist in Madrid: 02:00 jumps to 03:00.
    const result = await attempt({ date: "2027-03-28", time: "02:30" }, { now: NOW });

    expect(result).toMatchObject({ status: "invalid", failure: { code: "SCHEDULE_NONEXISTENT" } });
    expect(calls()).toHaveLength(0);
  });

  describe("a time that is not in the future never reaches the server", () => {
    it("rejects a time in the past", async () => {
      respond(200, { ok: true });

      const result = await attempt({ date: "2026-09-30", time: "09:00" });

      expect(result).toMatchObject({ status: "invalid", failure: { code: "SCHEDULE_PAST" } });
      expect(calls()).toHaveLength(0);
    });

    it("rejects the current minute: 'now' is already too late", async () => {
      respond(200, { ok: true });
      // NOW is 10:00:00 UTC = 12:00 in Madrid.

      const result = await attempt({ date: "2026-10-01", time: "12:00" });

      expect(result).toMatchObject({ status: "invalid", failure: { code: "SCHEDULE_PAST" } });
      expect(calls()).toHaveLength(0);
    });

    it("accepts the next minute", async () => {
      respond(200, { ok: true, scheduledAt: "2026-10-01T10:01:00.000Z" });

      const result = await attempt({ date: "2026-10-01", time: "12:01" });

      expect(result).toMatchObject({ status: "saved" });
    });

    it("checks again at the moment of saving, against the clock as it is then, not as it was when the form opened", async () => {
      respond(200, { ok: true, scheduledAt: "x" });
      const plan = { date: "2026-10-01", time: "12:30" };

      // While the form was open the time was still ahead...
      expect(await attempt(plan, { now: new Date("2026-10-01T10:29:00.000Z") })).toMatchObject({ status: "saved" });
      // ...but the person took their time, and by the moment they press Save it has gone by.
      expect(await attempt(plan, { now: new Date("2026-10-01T10:30:00.000Z") })).toMatchObject({
        status: "invalid", failure: { code: "SCHEDULE_PAST" },
      });
      expect(calls()).toHaveLength(1);
    });

    it("says which field is at fault: a day already gone is the date's, a time earlier today is the time's", async () => {
      expect(await attempt({ date: "2026-09-30", time: "23:00" })).toMatchObject({ failure: { field: "date" } });
      expect(await attempt({ date: "2026-10-01", time: "08:00" })).toMatchObject({ failure: { field: "time" } });
    });

    it("asks for both fields when one is empty", async () => {
      respond(200, { ok: true });
      expect(await attempt({ date: "", time: "09:00" })).toMatchObject({ failure: { code: "SCHEDULE_REQUIRED", field: "date" } });
      expect(await attempt({ date: "2026-10-16", time: "" })).toMatchObject({ failure: { code: "SCHEDULE_REQUIRED", field: "time" } });
      expect(calls()).toHaveLength(0);
    });
  });

  describe("while a save is in progress", () => {
    it("does not send a second request for a second press, and lets the first one finish", async () => {
      let answer!: (response: Response) => void;
      vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { answer = resolve; })));
      const inFlight = { current: false };
      const plan = { date: "2026-10-16", time: "09:00" };

      const first = attempt(plan, { inFlight });
      expect(inFlight.current).toBe(true);
      const second = await attempt(plan, { inFlight }); // pressed again in the same instant
      const third = await attempt(plan, { inFlight });

      expect(second).toEqual({ status: "busy" });
      expect(third).toEqual({ status: "busy" });
      expect(calls()).toHaveLength(1);

      answer(new Response(JSON.stringify({ ok: true, scheduledAt: "2026-10-16T07:00:00.000Z" }), {
        status: 200, headers: { "content-type": "application/json" },
      }));
      expect(await first).toEqual({ status: "saved", scheduledAt: "2026-10-16T07:00:00.000Z" });
      expect(inFlight.current).toBe(false);
    });

    it("can be pressed again once the request has failed", async () => {
      respond(500, { error: "Unexpected error" });
      const inFlight = { current: false };
      const plan = { date: "2026-10-16", time: "09:00" };

      expect(await attempt(plan, { inFlight })).toMatchObject({ status: "failed" });
      expect(inFlight.current).toBe(false);

      respond(200, { ok: true, scheduledAt: "2026-10-16T07:00:00.000Z" });
      expect(await attempt(plan, { inFlight })).toMatchObject({ status: "saved" });
    });

    it("lets a rejected attempt (bad time) be corrected and pressed again straight away", async () => {
      respond(200, { ok: true, scheduledAt: "2026-10-16T07:00:00.000Z" });
      const inFlight = { current: false };

      expect(await attempt({ date: "2026-09-01", time: "09:00" }, { inFlight })).toMatchObject({ status: "invalid" });
      expect(inFlight.current).toBe(false);
      expect(await attempt({ date: "2026-10-16", time: "09:00" }, { inFlight })).toMatchObject({ status: "saved" });
    });
  });

  describe("when the server says no", () => {
    it("passes its message on, asks for a refresh, and does not treat it as a fault in the typed time (409: it has started)", async () => {
      respond(409, { error: "This campaign is already due to start, so its time can no longer be changed" });

      expect(await attempt({ date: "2026-10-16", time: "09:00" })).toEqual({
        status: "failed", stale: true, scheduleRule: false,
        message: "This campaign is already due to start, so its time can no longer be changed",
      });
    });

    it("treats 404 (it is gone) like a stale page too", async () => {
      respond(404, { error: "Campaign not found" });
      expect(await attempt({ date: "2026-10-16", time: "09:00" })).toMatchObject({ stale: true, message: "Campaign not found" });
    });

    it("puts a schedule rule the server enforced (by its own clock) next to the fields, so the person can fix it", async () => {
      respond(400, { code: "SCHEDULE_PAST", field: "scheduledAt", error: "The scheduled time must be in the future." });

      expect(await attempt({ date: "2026-10-16", time: "09:00" })).toEqual({
        status: "failed", stale: false, scheduleRule: true, message: "The scheduled time must be in the future.",
      });
    });

    it("reports any other failure as a message, without a refresh", async () => {
      respond(500, { error: "Unexpected error" });
      expect(await attempt({ date: "2026-10-16", time: "09:00" })).toEqual({
        status: "failed", stale: false, scheduleRule: false, message: "Unexpected error",
      });
    });

    it("reports a network failure as a message rather than throwing", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
      expect(await attempt({ date: "2026-10-16", time: "09:00" })).toEqual({
        status: "failed", stale: false, scheduleRule: false, message: "Failed to fetch",
      });
    });

    it("never touches what the person typed, so it is all still there to correct and send again", async () => {
      respond(409, { error: "Nope" });
      const plan = Object.freeze({ date: "2026-10-16", time: "09:00", occurrence: undefined });

      await attempt(plan);

      expect(plan).toEqual({ date: "2026-10-16", time: "09:00", occurrence: undefined });
    });
  });
});

describe("requestReschedule", () => {
  it("returns the time the server saved, which is the one to show", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, scheduledAt: "2026-10-16T07:00:00.000Z" }), {
        status: 200, headers: { "content-type": "application/json" },
      })));

    expect(await requestReschedule("c9", new Date("2026-10-16T07:00:00.000Z"))).toEqual({
      ok: true, scheduledAt: "2026-10-16T07:00:00.000Z",
    });
  });
});
