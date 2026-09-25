/** One piece of interface text in both languages, kept side by side so neither can be forgotten. */
export type Message = { en: string; ru: string };

/** A group of messages; the type checker rejects an entry with only one language. */
export type Messages = Record<string, Message>;

/**
 * A count-dependent phrase. English needs `one`/`other`; Russian needs `one`
 * (1, 21, 101…), `few` (2–4, 22–24…), `many` (0, 5–20, 25…) and `other` (fractions).
 * The result is spread into a domain file and read back with `t("name", { count })`.
 *
 * English has no `few`/`many` form, so those slots repeat `other`; they are never
 * selected for English, but keeping them lets every key carry both languages.
 */
export function plural<Name extends string>(
  name: Name,
  en: { one: string; other: string },
  ru: { one: string; few: string; many: string; other: string },
): Record<`${Name}.one` | `${Name}.few` | `${Name}.many` | `${Name}.other`, Message> {
  return {
    [`${name}.one`]: { en: en.one, ru: ru.one },
    [`${name}.few`]: { en: en.other, ru: ru.few },
    [`${name}.many`]: { en: en.other, ru: ru.many },
    [`${name}.other`]: { en: en.other, ru: ru.other },
  } as Record<`${Name}.one` | `${Name}.few` | `${Name}.many` | `${Name}.other`, Message>;
}
