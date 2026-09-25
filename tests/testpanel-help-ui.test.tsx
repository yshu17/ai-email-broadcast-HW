// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./dom";
import HelpIcon, { helpSummaryId } from "@/components/testpanel/HelpIcon";
import { HelpProvider, useHelpController } from "@/components/testpanel/help-context";
import { LocaleProvider } from "@/i18n/client";
import type { Locale } from "@/i18n/locale";
import { TEST_LIMITS } from "@/lib/testing/limits";

/**
 * The help icon, in a DOM, driven the way a person drives it: with a mouse, with the keyboard, with
 * Escape, and by clicking elsewhere. It opens help, closes it, and hands focus back; it never changes
 * a setting or sends a request, and it never gets in the way of the form it sits in.
 */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Harness({ children }: { children: React.ReactNode }) {
  const controller = useHelpController();
  return <HelpProvider controller={controller}>{children}</HelpProvider>;
}

const renderIcon = (ui: React.ReactNode, locale: Locale = "en") =>
  render(<LocaleProvider locale={locale}><Harness>{ui}</Harness></LocaleProvider>);

const iconFor = (topic: string) => screen.getByRole("button", { name: `More: ${topic}` });

describe("the help button", () => {
  it("is a real button with a name that says what it is about", () => {
    renderIcon(<HelpIcon id="schedInterval" />);

    const button = iconFor("Scheduler interval");
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).not.toHaveAttribute("aria-controls");
  });

  it("is named in the language on screen: «Подробнее: интервал планировщика»", () => {
    renderIcon(<HelpIcon id="schedInterval" />, "ru");
    expect(screen.getByRole("button", { name: "Подробнее: Интервал планировщика" })).toBeInTheDocument();
  });

  it("writes its summary, hidden, next to the button, so a control can point at it", () => {
    renderIcon(<HelpIcon id="schedInterval" />);

    const summary = document.getElementById(helpSummaryId("schedInterval"));
    expect(summary).not.toBeNull();
    expect(summary?.textContent).toContain("looks in the database");
    expect(summary).toHaveClass("sr-only");
  });

  it("gives each of several icons for one id its own summary", () => {
    renderIcon(<><HelpIcon id="guideScenario" instance="a" /><HelpIcon id="guideScenario" instance="b" /></>);
    expect(document.getElementById(helpSummaryId("guideScenario", "a"))).not.toBeNull();
    expect(document.getElementById(helpSummaryId("guideScenario", "b"))).not.toBeNull();
  });
});

describe("opening", () => {
  it("opens a popover on click, with every part of the help", async () => {
    const user = userEvent.setup();
    renderIcon(<HelpIcon id="schedInterval" />);

    await user.click(iconFor("Scheduler interval"));

    const popover = screen.getByRole("dialog", { name: "Scheduler interval" });
    expect(iconFor("Scheduler interval")).toHaveAttribute("aria-expanded", "true");
    expect(iconFor("Scheduler interval")).toHaveAttribute("aria-controls", popover.id);
    for (const heading of ["What it is", "What it affects", "Unit", "Allowed values", "Recommended", "When it applies", "How long it lasts", "Important"]) {
      expect(within(popover).getByText(heading)).toBeInTheDocument();
    }
    expect(popover).toHaveTextContent("1–300 seconds");
    expect(popover).toHaveTextContent("Quick check: 2–5 seconds");
    expect(popover).toHaveTextContent("Leaving it running for a long time: 10–30 seconds");
    expect(popover).toHaveTextContent("Right away.");
    expect(popover).toHaveTextContent("Until the server restarts.");
  });

  it("opens a short tooltip for a simple figure", async () => {
    const user = userEvent.setup();
    renderIcon(<HelpIcon id="queueWaiting" />);

    await user.click(iconFor("Waiting jobs"));

    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("Emails in the queue that have not started yet");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens with the keyboard: Tab to the button, then Enter", async () => {
    const user = userEvent.setup();
    renderIcon(<><input aria-label="before" /><HelpIcon id="schedInterval" /></>);

    await user.tab();
    await user.tab();
    expect(iconFor("Scheduler interval")).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("dialog", { name: "Scheduler interval" })).toBeInTheDocument();
  });

  it("opens with the space bar as well", async () => {
    const user = userEvent.setup();
    renderIcon(<HelpIcon id="schedInterval" />);

    await user.tab();
    await user.keyboard(" ");

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("opens on hover with a mouse, and closes when the pointer leaves", async () => {
    const user = userEvent.setup();
    renderIcon(<><HelpIcon id="schedInterval" /><p>elsewhere</p></>);

    await user.hover(iconFor("Scheduler interval"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    await user.unhover(iconFor("Scheduler interval"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("stays open, once clicked, when the pointer leaves (it is pinned)", async () => {
    const user = userEvent.setup();
    renderIcon(<HelpIcon id="schedInterval" />);

    await user.click(iconFor("Scheduler interval"));
    await user.unhover(iconFor("Scheduler interval"));
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes when the button is pressed again", async () => {
    const user = userEvent.setup();
    renderIcon(<HelpIcon id="schedInterval" />);

    await user.click(iconFor("Scheduler interval"));
    await user.click(iconFor("Scheduler interval"));

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("has at most one open at a time", async () => {
    const user = userEvent.setup();
    renderIcon(<><HelpIcon id="schedInterval" /><HelpIcon id="rateMaxEmails" /></>);

    await user.click(iconFor("Scheduler interval"));
    await user.click(iconFor("Max emails"));

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Max emails" })).toBeInTheDocument();
    expect(iconFor("Scheduler interval")).toHaveAttribute("aria-expanded", "false");
  });
});

describe("closing", () => {
  it("closes on Escape and gives the focus back to the button", async () => {
    const user = userEvent.setup();
    renderIcon(<HelpIcon id="schedInterval" />);
    await user.click(iconFor("Scheduler interval"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(iconFor("Scheduler interval")).toHaveFocus();
  });

  it("closes on Escape when it was opened with the keyboard, and the focus is on the button", async () => {
    const user = userEvent.setup();
    renderIcon(<HelpIcon id="schedInterval" />);
    await user.tab();
    await user.keyboard("{Enter}");
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(iconFor("Scheduler interval")).toHaveFocus();
  });

  it("closes on a click outside, and leaves the focus where the click put it", async () => {
    const user = userEvent.setup();
    renderIcon(<><HelpIcon id="schedInterval" /><input aria-label="elsewhere" /></>);
    await user.click(iconFor("Scheduler interval"));

    await user.click(screen.getByLabelText("elsewhere"));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("elsewhere")).toHaveFocus();
  });

  it("does not close on a click inside the help", async () => {
    const user = userEvent.setup();
    renderIcon(<HelpIcon id="schedInterval" />);
    await user.click(iconFor("Scheduler interval"));

    await user.click(within(screen.getByRole("dialog")).getByText("What it is"));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes with its own close button, and returns focus to the icon", async () => {
    const user = userEvent.setup();
    renderIcon(<HelpIcon id="schedInterval" />);
    await user.click(iconFor("Scheduler interval"));

    await user.click(screen.getByRole("button", { name: "Close help" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(iconFor("Scheduler interval")).toHaveFocus();
  });

  it("returns the focus to the button that opened it, even if focus wandered into the help", async () => {
    const user = userEvent.setup();
    renderIcon(<HelpIcon id="schedInterval" />);
    await user.click(iconFor("Scheduler interval"));
    await user.tab(); // to the close button inside the popover
    expect(screen.getByRole("button", { name: "Close help" })).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(iconFor("Scheduler interval")).toHaveFocus();
  });
});

describe("opening help changes nothing", () => {
  it("does not change what is typed in the field beside it, and sends no request", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderIcon(<><label htmlFor="x">Interval</label><input id="x" defaultValue="7" /><HelpIcon id="schedInterval" /></>);
    await user.clear(screen.getByLabelText("Interval"));
    await user.type(screen.getByLabelText("Interval"), "42");

    await user.click(iconFor("Scheduler interval"));
    await user.keyboard("{Escape}");

    expect(screen.getByLabelText("Interval")).toHaveValue("42");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not move the form: the popover is fixed-positioned, out of the layout", async () => {
    const user = userEvent.setup();
    const view = renderIcon(<div data-testid="form"><label>Interval<input /></label><HelpIcon id="schedInterval" /><button>After</button></div>);
    const before = view.getByTestId("form").children.length;

    await user.click(iconFor("Scheduler interval"));

    const popover = screen.getByRole("dialog");
    expect(popover.style.position).toBe("fixed");
    // The form's own children are the same: the help is inside the icon's own wrapper, not among them.
    expect(view.getByTestId("form").children.length).toBe(before);
    expect(screen.getByRole("button", { name: "After" })).toBeInTheDocument();
  });

  it("gets a z-index above the panel it is used in", async () => {
    const user = userEvent.setup();
    renderIcon(<HelpIcon id="schedInterval" />);
    await user.click(iconFor("Scheduler interval"));
    expect(screen.getByRole("dialog")).toHaveClass("help-popover");
  });
});

describe("its words", () => {
  it("are in Russian on a Russian screen, with the range in Russian units", async () => {
    const user = userEvent.setup();
    renderIcon(<HelpIcon id="schedInterval" />, "ru");

    await user.click(screen.getByRole("button", { name: /Подробнее/ }));

    const popover = screen.getByRole("dialog", { name: "Интервал планировщика" });
    expect(popover).toHaveTextContent("Что это");
    expect(popover).toHaveTextContent("Допустимые значения");
    expect(popover).toHaveTextContent("1–300 секунд");
    expect(popover).toHaveTextContent("Срок действия");
    expect(popover).not.toHaveTextContent("What it is");
  });

  it("show the limits the code enforces", async () => {
    const user = userEvent.setup();
    renderIcon(<HelpIcon id="rateMaxEmails" />);
    await user.click(iconFor("Max emails"));

    const { min, max } = TEST_LIMITS.rateMaxEmails;
    expect(screen.getByRole("dialog")).toHaveTextContent(`${min}–${max} emails`);
  });
});
