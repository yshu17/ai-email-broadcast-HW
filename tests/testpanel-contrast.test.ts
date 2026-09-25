import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * "Enough contrast", checked from the colours themselves (a DOM without a screen cannot measure it).
 * Every pair the developer panel draws text or a control in, in the light theme and the dark one, is
 * read from the stylesheet and held to WCAG 2.1: 4.5:1 for text, 3:1 for the outline of a control.
 */
const css = readFileSync("src/app/globals.css", "utf8");

/** The `--token: #hex` declarations of every block that opens with `selector`, later ones winning. */
function tokens(selector: RegExp): Record<string, string> {
  const found: Record<string, string> = {};
  for (const block of css.matchAll(new RegExp(`${selector.source}\\s*\\{([^}]*)\\}`, "g"))) {
    for (const [, name, value] of block[1].matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) found[name] = value;
  }
  return found;
}

const light = { ...tokens(/@theme/), ...tokens(/:root/) };
const dark = { ...light, ...tokens(/html\.dark/) };

const channel = (value: number) => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const themes = { light, dark } as const;

describe("the colour tokens the panel is drawn with", () => {
  it("are found in both themes", () => {
    for (const theme of Object.values(themes)) {
      for (const name of ["--color-surface", "--color-ink", "--color-muted", "--color-accent", "--color-warn-bg", "--color-warn-ink", "--color-warn-border"]) {
        expect(theme[name], name).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });
});

describe.each(Object.entries(themes))("contrast in the %s theme", (_name, t) => {
  it("ordinary text on the panel: ink on the surface", () => {
    expect(contrast(t["--color-ink"], t["--color-surface"])).toBeGreaterThanOrEqual(7);
  });

  it("the muted hints and labels on the surface", () => {
    expect(contrast(t["--color-muted"], t["--color-surface"])).toBeGreaterThanOrEqual(4.5);
  });

  it("the ? glyph of a help icon, in the accent, on the surface", () => {
    expect(contrast(t["--color-accent"], t["--color-surface"])).toBeGreaterThanOrEqual(4.5);
  });

  it("the test-mode banner, the TEST MODE chip and the Important part of a help", () => {
    expect(contrast(t["--color-warn-ink"], t["--color-warn-bg"])).toBeGreaterThanOrEqual(7);
  });

  it("the outline of the banner's chip against the page, so it stays visible", () => {
    expect(contrast(t["--color-warn-border"], t["--color-warn-bg"])).toBeGreaterThanOrEqual(3);
  });

  it("the focus ring (the accent) against the surface, as a control's boundary", () => {
    expect(contrast(t["--color-accent"], t["--color-surface"])).toBeGreaterThanOrEqual(3);
  });
});

describe("the primary buttons the panel uses", () => {
  it("are readable in the light theme: white on the accent", () => {
    expect(contrast("#ffffff", light["--color-accent"])).toBeGreaterThanOrEqual(4.5);
  });

  it("are readable in the dark theme, where the accent is light, because their label is dark there", () => {
    expect(css).toMatch(/html\.dark \.tp-primary\s*\{\s*color:\s*(#[0-9a-fA-F]{6})/);
    const label = /html\.dark \.tp-primary\s*\{\s*color:\s*(#[0-9a-fA-F]{6})/.exec(css)![1];
    expect(contrast(label, dark["--color-accent"])).toBeGreaterThanOrEqual(4.5);
  });
});

describe("the arithmetic", () => {
  it("gives 21:1 for black on white and 1:1 for a colour on itself", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#4f46e5", "#4f46e5")).toBeCloseTo(1, 5);
  });
});
