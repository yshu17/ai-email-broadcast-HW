import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TestPanel from "@/components/testpanel/TestPanel";
import { LocaleProvider } from "@/i18n/client";

/**
 * The panel sits in the admin layout, which the server renders first. No DOM exists there (no
 * `window`, no `document`, no `localStorage`), so anything that reaches for one while rendering
 * would break every admin page the moment the flag is on. This runs the panel the way the server does.
 */
describe("the test panel on the server", () => {
  it("has no DOM here, as on the server", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
    expect(typeof localStorage).toBe("undefined");
  });

  for (const locale of ["ru", "en"] as const) {
    it(`renders to HTML without touching the browser (${locale})`, () => {
      const html = renderToString(
        <LocaleProvider locale={locale}>
          <TestPanel />
        </LocaleProvider>,
      );

      // The toggle and the test-mode notice are there from the first byte, so nothing jumps when it hydrates.
      expect(html).toContain(locale === "ru" ? "Тестовая панель" : "Test Panel");
      expect(html).toContain(locale === "ru" ? "ТЕСТОВЫЙ РЕЖИМ" : "TEST MODE");
      // The drawer starts closed, and no dialog or tour is drawn before anyone asks for one.
      expect(html).not.toContain('role="dialog"');
      expect(html).not.toContain('aria-modal="true"');
    });
  }

  it("draws the same thing twice, so hydration has nothing to disagree about", () => {
    const render = () =>
      renderToString(
        <LocaleProvider locale="en">
          <TestPanel />
        </LocaleProvider>,
      );
    expect(render()).toBe(render());
  });
});
