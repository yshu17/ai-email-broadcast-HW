import { intlTag, type Locale } from "./locale";
import { messages, type MessageKey, type TKey } from "./messages";

export type Params = Record<string, string | number>;

const dictionary = messages as Record<string, { en: string; ru: string }>;
const pluralRules = new Map<Locale, Intl.PluralRules>();

function pluralForm(locale: Locale, count: number): Intl.LDMLPluralRule {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(intlTag(locale));
    pluralRules.set(locale, rules);
  }
  return rules.select(count);
}

/**
 * The text for `key` in `locale`, with `{placeholders}` filled from `params`.
 *
 * If `params.count` is a number and the key names a plural set, the form is chosen
 * by the language's own rules, and `{count}` is written the way the language writes
 * numbers (4,850 / 4 850). A key that does not exist comes back as itself, so a
 * missing message shows up on screen instead of crashing the page.
 */
export function translate(locale: Locale, key: MessageKey, params?: Params): string {
  let entry = dictionary[key];
  if (typeof params?.count === "number") {
    entry = dictionary[`${key}.${pluralForm(locale, params.count)}`] ?? dictionary[`${key}.other`] ?? entry;
  }
  if (!entry) return key;

  const values: Params = { ...params };
  if (typeof params?.count === "number") values.count = new Intl.NumberFormat(intlTag(locale)).format(params.count);

  return entry[locale].replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
}

/** Whether the dictionary has this exact key (used where a value may or may not be a known name). */
export function hasMessage(key: string): key is MessageKey {
  return key in dictionary || `${key}.other` in dictionary;
}

export type { MessageKey, TKey };
