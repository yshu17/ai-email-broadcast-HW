import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SendStep, type CampaignDraft } from "@/app/(admin)/campaigns/[id]/CampaignWizard";

/**
 * The last step of the wizard, "When to send?", rendered to markup and read the way a
 * person would. The user's time zone is the process's (`TZ`), which each test sets
 * and the suite restores; the dates are chosen so the outcome does not depend on
 * today's date (far past, far future, and the daylight-saving days of 2099).
 */
const originalTz = process.env.TZ;
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

const draft: CampaignDraft = {
  id: "c1", name: "Autumn sale", subject: "Big discounts", fromName: "Shop", fromEmail: "shop@example.test",
  replyTo: null, contentHtml: "<p>Hi</p>", textBody: null, textBodyIsCustom: false, status: "DRAFT",
  totalRecipients: 0, createdAt: "2026-09-01T10:00:00.000Z", scheduledAt: null, startedAt: null, completedAt: null,
};
const audience = {
  totalMemberships: 5, uniqueContacts: 5, duplicatesRemoved: 0, suppressed: 0, finalRecipients: 5,
  maxEmailsPerHour: 5000, estimatedDuration: "less than a minute",
};

type Plan = { mode: "now" | "schedule"; date: string; time: string; occurrence?: "first" | "second" };
const noop = () => undefined;

function render(plan: Plan) {
  return renderToStaticMarkup(
    <SendStep draft={draft} audience={audience} lists={[{ id: "l1", name: "Subscribers", contactCount: 5 }]}
      plan={plan} onPlanChange={noop} onQueued={noop} onScheduled={noop} onError={noop} />,
  );
}

/** The `input` element with this id, as markup. */
const input = (html: string, id: string) => new RegExp(`<input[^>]*id="${id}"[^>]*>`).exec(html)?.[0] ?? "";
const radio = (html: string, label: string) =>
  new RegExp(`<input[^>]*type="radio"[^>]*name="sendMode"[^>]*>\\s*${label}`).exec(html)?.[0] ?? "";

/** The last Sunday of a month in 2099: the day the clocks change in Europe. */
function lastSunday(month: number): string {
  for (let day = 31; day >= 1; day -= 1) {
    const date = new Date(Date.UTC(2099, month - 1, day));
    if (date.getUTCMonth() === month - 1 && date.getUTCDay() === 0) {
      return `2099-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  throw new Error("no Sunday");
}

describe("choosing how to send", () => {
  it("offers 'Send now' and 'Schedule', with 'Send now' chosen by default", () => {
    const html = render({ mode: "now", date: "", time: "" });

    expect(html).toContain("When to send?");
    expect(radio(html, "Send now")).toContain("checked");
    expect(radio(html, "Schedule")).not.toContain("checked");
    expect(html).toContain("Queue campaign");
    expect(html).not.toContain("Schedule campaign");
  });

  it("shows no date or time fields, and needs no scheduledAt, for 'Send now'", () => {
    const html = render({ mode: "now", date: "", time: "" });

    expect(html).not.toContain('id="scheduleDate"');
    expect(html).not.toContain('id="scheduleTime"');
    expect(html).not.toContain("Time zone:");
    expect(html).toMatch(/Sending starts<\/dt><dd[^>]*>Immediately</);
  });

  it("shows the date and time fields, both required, only once 'Schedule' is chosen", () => {
    const html = render({ mode: "schedule", date: "", time: "" });

    expect(radio(html, "Schedule")).toContain("checked");
    expect(radio(html, "Send now")).not.toContain("checked");
    expect(input(html, "scheduleDate")).toContain('type="date"');
    expect(input(html, "scheduleDate")).toContain("required");
    expect(input(html, "scheduleTime")).toContain('type="time"');
    expect(input(html, "scheduleTime")).toContain("required");
    expect(html).toContain("Schedule campaign");
    expect(html).not.toContain("Queue campaign");
  });

  it("keeps what the wizard holds for the fields, which is what lets it survive a change of step", () => {
    const html = render({ mode: "schedule", date: "2099-01-01", time: "10:00" });

    expect(input(html, "scheduleDate")).toContain('value="2099-01-01"');
    expect(input(html, "scheduleTime")).toContain('value="10:00"');
    expect(radio(html, "Schedule")).toContain("checked");
  });

  it("stops the picker offering days already gone", () => {
    const html = render({ mode: "schedule", date: "", time: "" });

    expect(input(html, "scheduleDate")).toMatch(/min="\d{4}-\d{2}-\d{2}"/);
  });
});

describe("the user's time zone on the form", () => {
  it("is named beside the fields, with its offset, and says what the time means", () => {
    process.env.TZ = "Europe/Madrid";
    const html = render({ mode: "schedule", date: "", time: "" });

    expect(html).toMatch(/Time zone: Europe\/Madrid \(UTC\+0[12]:00\)/);
    expect(html).toMatch(/when sending starts/i);
  });

  it("follows the user's zone, not a fixed one", () => {
    process.env.TZ = "Asia/Tokyo";
    expect(render({ mode: "schedule", date: "", time: "" })).toContain("Time zone: Asia/Tokyo (UTC+09:00)");
    process.env.TZ = "America/New_York";
    expect(render({ mode: "schedule", date: "", time: "" })).toMatch(/Time zone: America\/New_York \(UTC-0[45]:00\)/);
  });

  it("shows the chosen moment in that zone, with the zone named, before the user confirms", () => {
    process.env.TZ = "Europe/Madrid";
    const html = render({ mode: "schedule", date: "2099-07-15", time: "10:30" });

    expect(html).toMatch(/Sending starts<\/dt><dd[^>]*>[^<]*10:30[^<]*(GMT\+2|CEST)/);
  });
});

describe("validation messages on the form", () => {
  it("says nothing while the fields are still empty", () => {
    const html = render({ mode: "schedule", date: "", time: "" });

    expect(html).not.toContain('role="alert"');
    expect(input(html, "scheduleDate")).toContain('aria-invalid="false"');
    expect(html).toMatch(/Sending starts<\/dt><dd[^>]*>Not chosen yet</);
  });

  it("puts the past-date message beside the date field, and marks only that field invalid", () => {
    const html = render({ mode: "schedule", date: "2020-01-01", time: "10:00" });

    expect(html).toContain('id="scheduleDateError"');
    expect(html).toContain("The scheduled time must be in the future.");
    expect(input(html, "scheduleDate")).toContain('aria-invalid="true"');
    expect(input(html, "scheduleDate")).toContain('aria-describedby="scheduleDateError"');
    expect(input(html, "scheduleTime")).toContain('aria-invalid="false"');
    expect(html).toMatch(/Sending starts<\/dt><dd[^>]*>Not chosen yet</);
  });

  it("puts the message beside the time field when the day is fine but the time is not", () => {
    // Time zones make "earlier today" impossible to name without the clock, so use a
    // time that does not exist: the clocks skip it.
    process.env.TZ = "Europe/Madrid";
    const html = render({ mode: "schedule", date: lastSunday(3), time: "02:30" });

    expect(html).toContain('id="scheduleTimeError"');
    expect(html).toMatch(/does not exist/i);
    expect(input(html, "scheduleTime")).toContain('aria-invalid="true"');
    expect(input(html, "scheduleDate")).toContain('aria-invalid="false"');
  });

  it("accepts a future moment without complaint", () => {
    const html = render({ mode: "schedule", date: "2099-01-01", time: "10:00" });

    expect(html).not.toContain('role="alert"');
    expect(input(html, "scheduleDate")).toContain('aria-invalid="false"');
    expect(input(html, "scheduleTime")).toContain('aria-invalid="false"');
  });

  it("asks which of two repeated times is meant when the clocks go back, and shows both", () => {
    process.env.TZ = "Europe/Madrid";
    const html = render({ mode: "schedule", date: lastSunday(10), time: "02:30" });

    expect(html).toMatch(/happens twice/i);
    expect(html).toContain('name="scheduleOccurrence"');
    expect(html.match(/name="scheduleOccurrence"/g)).toHaveLength(2);
    expect(html).toMatch(/GMT\+2|CEST/);
    expect(html).toMatch(/GMT\+1|CET/);
    expect(html).toMatch(/Sending starts<\/dt><dd[^>]*>Not chosen yet</);
  });

  it("stops asking once one is picked, and keeps both on offer so the pick can be changed", () => {
    process.env.TZ = "Europe/Madrid";
    const html = render({ mode: "schedule", date: lastSunday(10), time: "02:30", occurrence: "second" });

    expect(html).not.toContain('role="alert"');
    expect(html.match(/name="scheduleOccurrence"/g)).toHaveLength(2);
    expect(/<input[^>]*value="second"[^>]*>/.exec(html)?.[0]).toContain("checked");
    expect(/<input[^>]*value="first"[^>]*>/.exec(html)?.[0]).not.toContain("checked");
    expect(html).toMatch(/Sending starts<\/dt><dd[^>]*>[^<]*02:30[^<]*(GMT\+1|CET)/);
  });
});
