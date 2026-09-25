"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

/**
 * Which help popover is open. There is at most one at a time, and the panel needs to know:
 * pressing Escape closes the popover first, and only when none is open does it close the drawer.
 *
 * `close({ restoreFocus })` gives the focus back to the button that opened the popover: that is
 * what a keyboard user expects after Escape, whereas a click elsewhere should leave focus where the
 * click put it.
 */
export type HelpController = {
  openKey: string | null;
  pinned: boolean;
  open: (key: string, trigger: HTMLElement | null, pinned: boolean) => void;
  close: (options?: { restoreFocus?: boolean }) => void;
};

const HelpContext = createContext<HelpController | null>(null);

/** Owns the open/closed state. Used by the panel, and by anything that wants help icons to behave as a set. */
export function useHelpController(): HelpController {
  const [state, setState] = useState<{ key: string | null; pinned: boolean }>({ key: null, pinned: false });
  const trigger = useRef<HTMLElement | null>(null);

  const open = useCallback((key: string, element: HTMLElement | null, pinned: boolean) => {
    trigger.current = element;
    setState({ key, pinned });
  }, []);

  const close = useCallback((options: { restoreFocus?: boolean } = {}) => {
    const element = trigger.current;
    setState({ key: null, pinned: false });
    if (options.restoreFocus) element?.focus();
    trigger.current = null;
  }, []);

  return useMemo(() => ({ openKey: state.key, pinned: state.pinned, open, close }), [state, open, close]);
}

export function HelpProvider({ controller, children }: { controller: HelpController; children: React.ReactNode }) {
  return <HelpContext.Provider value={controller}>{children}</HelpContext.Provider>;
}

/** The surrounding controller, or a private one when a help icon is used on its own. */
export function useHelp(): HelpController {
  const shared = useContext(HelpContext);
  const local = useHelpController();
  return shared ?? local;
}
