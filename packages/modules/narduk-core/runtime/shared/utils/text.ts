/**
 * Small text helpers the estate kept re-writing: slugs, plurals, ordinals,
 * initials and regex escaping. Nine apps carried a `slugify`, ten a `plural`.
 *
 * Pure, dependency-free and locale-explicit. Import from
 * `@narduk-enterprises/narduk-core/shared/utils/text`; nothing here is
 * auto-imported, so an app's own same-named helper keeps working until it
 * switches.
 */

export interface SlugifyOptions {
  /** Longest slug returned; trailing hyphens left by the cut are dropped. */
  readonly maxLength?: number
}

/**
 * A URL slug from a display name: lowercase ASCII letters, digits and single
 * hyphens, never a leading or trailing hyphen. Diacritics are decomposed and
 * dropped (`Rêve` → `reve`), `&` reads as "and", and anything else collapses to
 * one hyphen. Returns `''` when nothing usable is left, so the caller decides
 * the fallback.
 *
 * A slug is a suggestion, not a validated identifier: routes that accept one
 * still validate it against their own pattern.
 */
// Letters NFKD does not decompose into a base letter plus a mark.
const FOLDS: Readonly<Record<string, string>> = {
  æ: 'ae',
  ð: 'd',
  đ: 'd',
  ħ: 'h',
  ı: 'i',
  ł: 'l',
  œ: 'oe',
  ø: 'o',
  ß: 'ss',
  þ: 'th',
}

export function slugify(value: string, options: SlugifyOptions = {}): string {
  const slug = value
    .toLowerCase()
    .replaceAll(/[æðđħıłœøßþ]/gu, (letter) => FOLDS[letter] ?? letter)
    .normalize('NFKD')
    .replaceAll(/\p{M}/gu, '')
    .toLowerCase()
    .replaceAll('&', ' and ')
    .replaceAll(/[^a-z0-9]+/gu, '-')
    .replaceAll(/^-+|-+$/gu, '')
  const max = options.maxLength
  if (max === undefined || !Number.isFinite(max) || slug.length <= max) return slug
  return slug.slice(0, Math.max(0, max)).replace(/-+$/u, '')
}

/**
 * `1 lake`, `2 lakes`. The plural form defaults to `singular + 's'`; pass it
 * for irregular words (`plural(n, 'person', 'people')`). The count is printed
 * as given; format it first if it needs grouping.
 */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

/** The word alone, without the count: `pluralWord(3, 'gauge')` → `gauges`. */
export function pluralWord(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm
}

const ORDINAL_SUFFIX: Readonly<Record<Intl.LDMLPluralRule, string>> = {
  few: 'rd',
  many: 'th',
  one: 'st',
  other: 'th',
  two: 'nd',
  zero: 'th',
}
const ordinalRules = new Intl.PluralRules('en-US', { type: 'ordinal' })

/** English ordinal: `1st`, `2nd`, `11th`, `23rd`. Non-integers return as is. */
export function ordinal(value: number): string {
  if (!Number.isInteger(value)) return String(value)
  return `${value}${ORDINAL_SUFFIX[ordinalRules.select(value)]}`
}

/**
 * Up to `max` uppercase initials from a name, for avatars: `Ada Lovelace` →
 * `AL`, `cher` → `C`. Words are split on whitespace and hyphens; the first
 * letter or digit of each counts. Returns `''` for a name with none.
 */
export function initials(name: string, max = 2): string {
  const letters: string[] = []
  for (const word of name.split(/[\s-]+/u)) {
    const first = /[\p{L}\p{N}]/u.exec(word)?.[0]
    if (first) letters.push(first.toLocaleUpperCase('en-US'))
    if (letters.length >= max) break
  }
  return letters.join('')
}

/** Escape a string for literal use inside a `RegExp` source. */
export function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)
}
