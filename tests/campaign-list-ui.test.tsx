import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import CampaignsTable, { type CampaignRow } from "@/app/(admin)/campaigns/CampaignsTable";
import CancelScheduledDialog, { requestCancelScheduled } from "@/components/CancelScheduledDialog";
import { StatusBadge } from "@/components/ui";

/**
 * The campaign list and the cancel dialog, rendered to static markup so the text
 * a person would read can be asserted on. The locale and time zone are pinned by
 * props: nothing here depends on the machine the tests run on, or on the clock.
 */
afterEach(() => vi.unstubAllGlobals());

const noop = () => undefined;
const MADRID = { locale: "en-GB", timeZone: "Europe/Madrid" };

function row(overrides: Partial<CampaignRow> = {}): CampaignRow {
  return {
    id: "c1", name: "Autumn sale", subject: "Big discounts", status: "DRAFT",
    createdAt: "2026-09-01T10:00:00.000Z", scheduledAt: null, startedAt: null, completedAt: null,
    totalRecipients: 0, estimatedRecipients: null, queued: 0, sending: 0, sent: 0, failed: 0, uniqueOpens: 0,
    ...overrides,
  };
}

function render(rows: CampaignRow[], display: { locale?: string; timeZone?: string } = MADRID) {
  return renderToStaticMarkup(
    <CampaignsTable rows={rows} onDuplicate={noop} onCancelScheduled={noop} onReschedule={noop} {...display} />,
  );
}

const scheduled = (overrides: Partial<CampaignRow> = {}) =>
  row({ status: "SCHEDULED", scheduledAt: "2026-10-15T08:30:00.000Z", estimatedRecipients: 4850, ...overrides });

describe("a SCHEDULED campaign in the list", () => {
  it("is shown with its status and the time it starts", () => {
    const html = render([scheduled()]);

    expect(html).toContain("Autumn sale");
    expect(html).toContain("SCHEDULED");
    expect(html).toContain("Scheduled for");
  });

  it("gives the time in the viewer's locale and zone, with the zone named", () => {
    const html = render([scheduled()]);

    // 08:30 UTC is 10:30 in Madrid in October (summer time, UTC+2).
    expect(html).toMatch(/15 Oct 2026, 10:30 (GMT\+2|CEST)/);
  });

  it("puts the same instant in a different wall-clock time for a viewer in another zone", () => {
    expect(render([scheduled()], { locale: "en-GB", timeZone: "Asia/Tokyo" })).toMatch(/15 Oct 2026, 17:30 (GMT\+9|JST)/);
    expect(render([scheduled()], { locale: "en-GB", timeZone: "America/New_York" })).toMatch(/15 Oct 2026, 04:30 (GMT-4|EDT)/);
    expect(render([scheduled()], { locale: "en-GB", timeZone: "UTC" })).toMatch(/15 Oct 2026, 08:30 (UTC|GMT)/);
  });

  it("follows the viewer's locale", () => {
    expect(render([scheduled()], { locale: "en-US", timeZone: "Europe/Madrid" })).toMatch(/Oct 15, 2026/);
    expect(render([scheduled()], { locale: "de-DE", timeZone: "Europe/Madrid" })).toMatch(/15\. Okt\.? 2026/);
  });

  it("carries the exact UTC instant for machines and in the tooltip", () => {
    const html = render([scheduled()]);

    expect(html).toContain('dateTime="2026-10-15T08:30:00.000Z"');
    expect(html).toContain("Europe/Madrid");
    expect(html).toContain("2026-10-15T08:30:00.000Z (UTC)");
  });

  it("shows the right local time either side of a daylight saving change", () => {
    // Clocks in Madrid jump from 02:00 to 03:00 at 01:00 UTC on 29 March 2026.
    expect(render([scheduled({ scheduledAt: "2026-03-29T00:59:00.000Z" })])).toMatch(/29 Mar 2026, 01:59 (GMT\+1|CET)/);
    expect(render([scheduled({ scheduledAt: "2026-03-29T01:00:00.000Z" })])).toMatch(/29 Mar 2026, 03:00 (GMT\+2|CEST)/);
  });

  it("shows the recipients it expects, marked as an estimate, and not the stored zero", () => {
    const html = render([scheduled({ totalRecipients: 0, estimatedRecipients: 4850 })]);

    expect(html).toContain("≈");
    expect(html).toContain("4,850");
    expect(html).toMatch(/title="[^"]*estimate[^"]*"/i);
  });

  it("offers the cancel action, labelled with the campaign's name", () => {
    const html = render([scheduled()]);

    expect(html).toContain('aria-label="Cancel scheduled campaign: Autumn sale"');
    expect(html).toContain(">Cancel<");
  });

  it("leaves the schedule line out if, defensively, the time is missing or unreadable", () => {
    expect(render([scheduled({ scheduledAt: null })])).not.toContain("Scheduled for");
    expect(render([scheduled({ scheduledAt: "garbage" })])).not.toContain("Scheduled for");
  });
});

describe("campaigns that are not scheduled", () => {
  it.each(["DRAFT", "QUEUED", "SENDING", "PAUSED", "COMPLETED", "CANCELLED"])(
    "%s shows no scheduled-time line and no cancel action",
    (status) => {
      const html = render([row({ status, totalRecipients: 12 })]);

      expect(html).toContain(status);
      expect(html).not.toContain("Scheduled for");
      expect(html).not.toContain("Cancel scheduled campaign");
      expect(html).not.toContain("≈");
    },
  );

  it("does not offer to cancel a campaign that has already started, even one that was once scheduled", () => {
    for (const status of ["QUEUED", "SENDING", "COMPLETED"]) {
      const html = render([row({ status, scheduledAt: "2026-10-15T08:30:00.000Z", startedAt: "2026-10-15T08:30:05.000Z" })]);
      expect(html).not.toContain("Cancel scheduled campaign");
      expect(html).not.toContain("Scheduled for");
    }
  });

  it("still shows the stored recipient count", () => {
    const html = render([row({ status: "SENDING", totalRecipients: 1234 })]);
    expect(html).toContain("1234");
  });

  it("keeps Duplicate on every row", () => {
    const html = render([row({ id: "a", name: "One" }), scheduled({ id: "b", name: "Two" })]);
    expect(html).toContain('aria-label="Duplicate campaign: One"');
    expect(html).toContain('aria-label="Duplicate campaign: Two"');
  });
});

describe("the table's layout", () => {
  // jsdom does no layout, so these check the classes that make it hold: what a real browser did with
  // them was checked by eye (a Russian page at several widths).
  it("puts a row's actions one under another, so three buttons do not push the column out of the card", () => {
    const html = render([scheduled({ name: "Autumn sale" })]);
    const cell = /<td class="px-3 py-2 align-top"><div class="([^"]*)">/.exec(html);
    expect(cell?.[1]).toContain("flex-col");
    expect(cell?.[1]).toContain("whitespace-nowrap");
    // Reschedule, cancel and duplicate: all three sit inside that one stack.
    const stack = html.slice(html.indexOf(cell?.[0] ?? "\0"));
    expect(stack.indexOf("Change time")).toBeGreaterThan(-1);
    expect(stack.indexOf("Cancel")).toBeGreaterThan(stack.indexOf("Change time"));
    expect(stack.indexOf("Duplicate")).toBeGreaterThan(stack.indexOf("Cancel"));
  });

  it("keeps the created and completed dates for wide screens only", () => {
    const html = render([scheduled()]);
    expect(html.match(/hidden px-3 py-2[^"]*xl:table-cell/g)).toHaveLength(4); // two headings, two cells
  });

  it("holds the scroll area's positioned box, so the visually hidden header cannot widen the page", () => {
    // `.sr-only` is absolutely positioned; without a positioned ancestor it escapes the card's clipping.
    const html = render([row()]);
    expect(html).toMatch(/^<div class="card relative overflow-x-auto">/);
    expect(html).toContain('<span class="sr-only">Actions</span>');
  });
});

describe("status badges", () => {
  it.each(["DRAFT", "SCHEDULED", "QUEUED", "SENDING", "PAUSED", "COMPLETED", "CANCELLED"])(
    "renders %s with its own colour",
    (status) => {
      const html = renderToStaticMarkup(<StatusBadge status={status} />);
      expect(html).toContain(status);
      expect(html).toMatch(/class="badge text-/);
    },
  );

  it("gives SCHEDULED a colour of its own, apart from QUEUED and CANCELLED", () => {
    const colour = (status: string) => /class="badge (.*?)"/.exec(renderToStaticMarkup(<StatusBadge status={status} />))?.[1];
    expect(colour("SCHEDULED")).not.toBe(colour("QUEUED"));
    expect(colour("SCHEDULED")).not.toBe(colour("CANCELLED"));
  });
});

describe("the cancel confirmation", () => {
  const target = { id: "c1", name: "Autumn sale", scheduledAt: "2026-10-15T08:30:00.000Z" };
  const dialog = (overrides: Partial<Parameters<typeof CancelScheduledDialog>[0]> = {}) =>
    renderToStaticMarkup(
      <CancelScheduledDialog campaign={target} onClose={noop} onCancelled={noop} onStale={noop} {...MADRID} {...overrides} />,
    );

  it("names the campaign and says when it was due to start, in the viewer's zone", () => {
    const html = dialog();

    expect(html).toContain("Autumn sale");
    expect(html).toMatch(/15 Oct 2026, 10:30 (GMT\+2|CEST)/);
    expect(html).toContain("Europe/Madrid");
  });

  it("is an accessible dialog with a title and a clearly labelled pair of choices", () => {
    const html = dialog();

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toMatch(/aria-labelledby="[^"]+"/);
    expect(html).toContain("Cancel scheduled campaign?");
    expect(html).toContain("Keep scheduled");
    expect(html).toContain("Cancel campaign");
    // Focus starts on the safe choice, not on the destructive one.
    expect(html).toMatch(/<button[^>]*data-autofocus[^>]*>Keep scheduled/);
  });

  it("says plainly what cancelling means", () => {
    const html = dialog();
    expect(html).toMatch(/will not be sent/i);
    expect(html).toMatch(/cannot be undone|can.t be undone/i);
  });
});

describe("requestCancelScheduled", () => {
  const respond = (status: number, body: unknown) =>
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })));

  it("posts to the cancel endpoint for that campaign and reports success", async () => {
    respond(200, { ok: true, alreadyCancelled: false, campaign: { id: "c1", status: "CANCELLED" } });

    const outcome = await requestCancelScheduled("c1");

    expect(outcome).toEqual({ ok: true, alreadyCancelled: false });
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/campaigns/c1/cancel-scheduled");
    expect(init.method).toBe("POST");
  });

  it("treats a repeat as success too", async () => {
    respond(200, { ok: true, alreadyCancelled: true, campaign: { id: "c1", status: "CANCELLED" } });
    expect(await requestCancelScheduled("c1")).toEqual({ ok: true, alreadyCancelled: true });
  });

  it("passes the server's own message through when it is too late, and asks for a refresh", async () => {
    respond(409, { error: "Only a scheduled campaign can be cancelled here; this one is QUEUED" });

    expect(await requestCancelScheduled("c1")).toEqual({
      ok: false, stale: true, message: "Only a scheduled campaign can be cancelled here; this one is QUEUED",
    });
  });

  it("reports other failures with the server's message, without asking for a refresh", async () => {
    respond(500, { error: "Unexpected error" });
    expect(await requestCancelScheduled("c1")).toEqual({ ok: false, stale: false, message: "Unexpected error" });
  });

  it("reports a network failure as a message rather than throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    expect(await requestCancelScheduled("c1")).toEqual({ ok: false, stale: false, message: "Failed to fetch" });
  });
});
