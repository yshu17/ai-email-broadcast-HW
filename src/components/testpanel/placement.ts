/**
 * Where a help popover goes, given the button it belongs to and the size of the window.
 *
 * Pure, so the edge cases (a button at the right edge, at the bottom, in a window smaller than the
 * popover) are settled by arithmetic that can be tested, not by trying it on a screen.
 *
 * The popover is placed under its button when there is room, over it when there is not, and
 * always kept `margin` away from every edge of the window. If it fits in neither place it takes
 * the side with more room and is given a `maxHeight`, so it scrolls inside instead of running off
 * the screen. It never covers its own button.
 */
export type Box = { left: number; top: number; right: number; bottom: number };
export type Size = { width: number; height: number };

export type Placement = {
  top: number;
  left: number;
  placement: "below" | "above";
  /** Set when the popover had to be shortened to fit; the popover scrolls inside. */
  maxHeight: number | null;
};

export function placePopover(
  anchor: Box,
  popover: Size,
  viewport: Size,
  options: { gap?: number; margin?: number } = {},
): Placement {
  const gap = options.gap ?? 6;
  const margin = options.margin ?? 8;

  const roomBelow = viewport.height - margin - (anchor.bottom + gap);
  const roomAbove = anchor.top - gap - margin;

  let placement: "below" | "above";
  if (popover.height <= roomBelow) placement = "below";
  else if (popover.height <= roomAbove) placement = "above";
  else placement = roomBelow >= roomAbove ? "below" : "above";

  const available = Math.max(0, placement === "below" ? roomBelow : roomAbove);
  const height = Math.min(popover.height, available);
  const maxHeight = popover.height > available ? available : null;

  const top = placement === "below" ? anchor.bottom + gap : anchor.top - gap - height;

  // Horizontally: start under the button, then pull it back inside the window.
  const width = Math.min(popover.width, Math.max(0, viewport.width - 2 * margin));
  const left = Math.min(Math.max(margin, anchor.left), Math.max(margin, viewport.width - margin - width));

  return { top, left, placement, maxHeight };
}

/** Whether a rectangle lies fully inside the window, `margin` from its edges. For tests and assertions. */
export function fitsInside(box: Box, viewport: Size, margin = 0): boolean {
  return box.left >= margin && box.top >= margin && box.right <= viewport.width - margin && box.bottom <= viewport.height - margin;
}
