import * as domains from "./domains";
import { testguide } from "./testguide";
import { testhelp } from "./testhelp";
import { testpanel } from "./testpanel";

/**
 * The words of the developer test panel. They are only needed where the panel can exist, so a
 * production build leaves them out (`NODE_ENV` is a build-time constant) instead of shipping tens of
 * kilobytes of text nobody can reach. The type still lists them: code that uses them is only ever run
 * where they are present.
 */
type DevelopmentTools = typeof testhelp & typeof testpanel & typeof testguide;

/** The whole dictionary: every key with its English and Russian text. */
export const messages = {
  ...domains.app,
  ...domains.campaigns,
  ...domains.common,
  ...domains.contacts,
  ...domains.dashboard,
  ...domains.email,
  ...domains.editor,
  ...domains.errors,
  ...domains.pages,
  ...domains.settings,
  ...domains.wizard,
  ...domains.labels,
  ...domains.status,
  // Written out here, not in a constant of its own, so that a production build can drop the three dictionaries.
  ...(process.env.NODE_ENV === "production" ? ({} as DevelopmentTools) : { ...testhelp, ...testpanel, ...testguide }),
};

export type TKey = keyof typeof messages;

/** Keys that are plural sets are used by their base name, e.g. `common.recipients`. */
type PluralBase<K extends string> = K extends `${infer Base}.other` ? Base : never;

/** What `t()` accepts: a plain key, or the base name of a plural set. */
export type MessageKey = TKey | PluralBase<TKey>;
