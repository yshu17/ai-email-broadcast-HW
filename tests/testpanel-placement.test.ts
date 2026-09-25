import { describe, expect, it } from "vitest";
import { fitsInside, placePopover, type Box } from "@/components/testpanel/placement";

/**
 * Where a help popover goes: under its button when there is room, over it when there is not, always
 * inside the window, and never on top of its own button.
 */
const viewport = { width: 1000, height: 700 };
const popover = { width: 352, height: 200 };
const button = (left: number, top: number, size = 20): Box => ({ left, top, right: left + size, bottom: top + size });
const box = (placed: { top: number; left: number; maxHeight: number | null }, size = popover): Box => ({
  left: placed.left, top: placed.top, right: placed.left + size.width, bottom: placed.top + (placed.maxHeight ?? size.height),
});
const overlaps = (a: Box, b: Box) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

describe("placePopover", () => {
  it("goes just under the button, starting at its left edge, when there is room", () => {
    const anchor = button(100, 100);

    const placed = placePopover(anchor, popover, viewport);

    expect(placed).toMatchObject({ placement: "below", left: 100, top: 126, maxHeight: null });
  });

  it("goes over the button when the bottom of the window is too close", () => {
    const anchor = button(100, 600);

    const placed = placePopover(anchor, popover, viewport);

    expect(placed.placement).toBe("above");
    expect(placed.top + popover.height).toBeLessThanOrEqual(anchor.top);
    expect(fitsInside(box(placed), viewport, 8)).toBe(true);
  });

  it("is pulled back inside the window from the right edge", () => {
    const anchor = button(980, 100);

    const placed = placePopover(anchor, popover, viewport);

    expect(placed.left).toBe(viewport.width - 8 - popover.width);
    expect(fitsInside(box(placed), viewport, 8)).toBe(true);
  });

  it("keeps a margin from the left edge", () => {
    const placed = placePopover(button(0, 100), popover, viewport);
    expect(placed.left).toBe(8);
  });

  it("never covers its own button, wherever the button is", () => {
    for (let x = 0; x <= 980; x += 70) {
      for (let y = 0; y <= 680; y += 60) {
        const anchor = button(x, y);
        const placed = placePopover(anchor, popover, viewport);
        expect(overlaps(box(placed), anchor), `button at ${x},${y}`).toBe(false);
      }
    }
  });

  it("stays inside the window for every button position in a normal window", () => {
    for (let x = 0; x <= 980; x += 70) {
      for (let y = 0; y <= 680; y += 60) {
        const placed = placePopover(button(x, y), popover, viewport);
        expect(fitsInside(box(placed), viewport, 8), `button at ${x},${y}`).toBe(true);
      }
    }
  });

  it("shortens itself, to scroll inside, when it fits neither above nor below", () => {
    const tall = { width: 352, height: 900 };
    const placed = placePopover(button(100, 300), tall, viewport);

    expect(placed.maxHeight).not.toBeNull();
    expect(placed.maxHeight).toBeLessThan(tall.height);
    expect(fitsInside(box(placed, tall), viewport, 8)).toBe(true);
  });

  it("takes the roomier side when it must be shortened", () => {
    const tall = { width: 352, height: 900 };
    expect(placePopover(button(100, 600), tall, viewport).placement).toBe("above");
    expect(placePopover(button(100, 20), tall, viewport).placement).toBe("below");
  });

  it("is narrowed to the window in a window narrower than the popover (a phone)", () => {
    const phone = { width: 320, height: 640 };
    const placed = placePopover(button(290, 200), popover, phone);

    expect(placed.left).toBeGreaterThanOrEqual(8);
    expect(placed.left + Math.min(popover.width, phone.width - 16)).toBeLessThanOrEqual(phone.width - 8);
  });

  it("gives the same answer for the same inputs", () => {
    const first = placePopover(button(400, 400), popover, viewport);
    expect(placePopover(button(400, 400), popover, viewport)).toEqual(first);
  });
});
