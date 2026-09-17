/**
 * Units / time zone / locale preferences — the cookie codec and the resolution
 * rules (narduk-libs#386).
 *
 * ## One cookie, versioned, validated on read
 *
 * Every preference lives in a single cookie (`ne_prefs`) whose value is a
 * URL-encoded parameter string:
 *
 * ```text
 * v=1&u=imperial&tz=America%2FChicago&l=en-US
 * ```
 *
 * The leading `v` is the schema version. A cookie written by a future version
 * of this module is *not* guessed at: {@link decodePreferencesCookie} returns
 * an empty selection and the caller falls back to the documented defaults. The
 * same is true of a truncated cookie, a cookie a user hand-edited, one carrying
 * a time zone the runtime does not know, and one that is not a parameter string
 * at all. **Garbage in means defaults out, never a thrown error** — this value
 * is read on every SSR render, so a decoder that throws is a 500 on a page
 * whose only fault is a stale cookie jar.
 *
 * ## Why a parameter string and not JSON
 *
 * `useCookie` serialises an object as JSON and then percent-encodes it, which
 * roughly doubles the byte count for a value that is sent on every request to
 * the origin, and makes the cookie unreadable in devtools. Three short keys
 * cost about 45 bytes and stay legible.
 *
 * ## Defaults when the cookie is unset
 *
 * | Preference  | Default                                                       |
 * | ----------- | ------------------------------------------------------------- |
 * | `locale`    | the best supported tag in `Accept-Language`, else `en-US`      |
 * | `units`     | `imperial` when the resolved locale's region is `US`, else `metric` |
 * | `timeZone`  | `UTC` — see below                                              |
 *
 * `timeZone` deliberately does **not** default to the host zone. The server has
 * no way to know the browser's zone on a first request, so any default derived
 * from the server's own clock renders one string during SSR and a different one
 * in the browser: a hydration mismatch, and the exact defect
 * `narduk-shell/format` was built to remove. `UTC` is rendered on both sides,
 * and {@link createPreferencesState} adopts the browser's real zone *after*
 * mount, which is an ordinary reactive update rather than a mismatch.
 *
 * ## No framework imports
 *
 * Nothing here imports Vue, Nuxt or h3: the same functions resolve preferences
 * inside a Nitro route, inside a composable, and inside a plain unit test.
 */

import { z } from 'zod'

/** The two unit systems the estate supports. */
export type NeUnitSystem = 'imperial' | 'metric'

/** A fully resolved preference set. Every field is always present. */
export interface NePreferences {
  /** BCP-47 tag, canonicalised, e.g. `en-US`. */
  locale: string
  /** IANA zone name, e.g. `America/Chicago`. */
  timeZone: string
  /** Which unit system display values are converted into. */
  units: NeUnitSystem
}

/** The subset of {@link NePreferences} a cookie actually carries. */
export type NePreferenceSelection = Partial<NePreferences>

/** The cookie name. One cookie holds the whole selection. */
export const NE_PREFERENCES_COOKIE = 'ne_prefs'

/** The cookie schema version. Bumping it retires every cookie in the wild. */
export const NE_PREFERENCES_COOKIE_VERSION = 1

/** One year, in seconds. A display preference is not session state. */
export const NE_PREFERENCES_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/**
 * The `useState` key the SSR-resolved defaults travel under. The server puts
 * its answer in the payload so the client's first render reproduces it exactly
 * rather than re-deriving it from `navigator.language`, which can differ from
 * the `Accept-Language` the request carried.
 */
export const NE_PREFERENCES_STATE_KEY = 'narduk-core:preference-defaults'

/** Locale used when `Accept-Language` is absent, empty or unusable. */
export const NE_DEFAULT_LOCALE = 'en-US'

/** Time zone used until the browser reports its own. See this module's header. */
export const NE_DEFAULT_TIME_ZONE = 'UTC'

/**
 * Longest cookie value this module will even attempt to parse. A legitimate
 * selection is around 45 bytes; anything past this is not ours.
 */
const MAX_COOKIE_LENGTH = 512

/** Longest `Accept-Language` header parsed, for the same reason. */
const MAX_ACCEPT_LANGUAGE_LENGTH = 512

/**
 * Whether the runtime can canonicalise this tag. `Intl.getCanonicalLocales`
 * throws `RangeError` on a structurally invalid tag, which is the check —
 * there is no list to hard-code and no reason to invent one.
 */
function canonicalLocale(value: string): string | undefined {
  try {
    const [canonical] = Intl.getCanonicalLocales(value)
    return canonical
  } catch {
    return undefined
  }
}

/**
 * Whether the runtime knows this IANA zone. `Intl.DateTimeFormat` throws
 * `RangeError` for an unknown zone, so constructing one is the validation.
 */
function isSupportedTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

const unitSystemSchema = z.enum(['imperial', 'metric'])

const localeSchema = z
  .string()
  .min(2)
  .max(35)
  .transform((value) => canonicalLocale(value))
  .refine((value): value is string => typeof value === 'string')

const timeZoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => isSupportedTimeZone(value))

/** Validate a unit system, returning `undefined` rather than throwing. */
export function parseUnitSystem(value: unknown): NeUnitSystem | undefined {
  const parsed = unitSystemSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

/** Validate and canonicalise a locale tag, returning `undefined` rather than throwing. */
export function parseLocale(value: unknown): string | undefined {
  const parsed = localeSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

/** Validate an IANA time zone, returning `undefined` rather than throwing. */
export function parseTimeZone(value: unknown): string | undefined {
  const parsed = timeZoneSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

/**
 * The estate's unit default for a locale: imperial when the tag names the
 * United States as its region (`en-US`, `es-US`), metric everywhere else.
 *
 * The region is read as written, never maximised. `Intl.Locale('en').maximize()`
 * answers `en-Latn-US`, which would quietly make every region-less English
 * speaker in the world imperial; a tag that does not say where it is gets the
 * world's default instead. Liberia and Myanmar are the other two countries that
 * have not adopted SI for everyday measurement; neither is an estate market, so
 * they are metric here on purpose rather than by omission.
 */
export function unitSystemForLocale(locale: string): NeUnitSystem {
  try {
    return new Intl.Locale(locale).region === 'US' ? 'imperial' : 'metric'
  } catch {
    return 'metric'
  }
}

/**
 * Pick the highest-quality locale in an `Accept-Language` header that this
 * runtime can canonicalise. `*` is skipped: it means "anything", which is not
 * a preference. Returns `undefined` when nothing usable is present.
 */
export function localeFromAcceptLanguage(header: string | null | undefined): string | undefined {
  if (typeof header !== 'string' || header.length === 0) return undefined
  if (header.length > MAX_ACCEPT_LANGUAGE_LENGTH) return undefined

  const candidates = header
    .split(',')
    .map((part) => {
      const [tag = '', ...parameters] = part.split(';').map((piece) => piece.trim())
      const quality = parameters
        .map((parameter) => /^q=(?<value>[\d.]+)$/i.exec(parameter)?.groups?.value)
        .find((value) => value !== undefined)
      const weight = quality === undefined ? 1 : Number.parseFloat(quality)
      return { tag, weight: Number.isFinite(weight) ? weight : 0 }
    })
    .filter((candidate) => candidate.tag.length > 0 && candidate.tag !== '*' && candidate.weight > 0)
    .sort((left, right) => right.weight - left.weight)

  for (const candidate of candidates) {
    const locale = parseLocale(candidate.tag)
    if (locale) return locale
  }
  return undefined
}

/** What {@link resolvePreferenceDefaults} needs from the request. */
export interface ResolvePreferenceDefaultsInput {
  /** The request's `Accept-Language` header, when there is one. */
  acceptLanguage?: string | null
}

/**
 * The preference set used when the cookie says nothing. Derived from the
 * request alone, so the server and the client agree as long as the client uses
 * the value the server put in the payload.
 */
export function resolvePreferenceDefaults(
  input: ResolvePreferenceDefaultsInput = {},
): NePreferences {
  const locale = localeFromAcceptLanguage(input.acceptLanguage) ?? NE_DEFAULT_LOCALE
  return { locale, timeZone: NE_DEFAULT_TIME_ZONE, units: unitSystemForLocale(locale) }
}

/**
 * Serialise a selection. Only fields that are present and valid are written, so
 * a user who set units but never touched the time zone keeps following the
 * defaults for the time zone.
 */
export function encodePreferencesCookie(selection: NePreferenceSelection): string {
  const parameters = new URLSearchParams()
  parameters.set('v', String(NE_PREFERENCES_COOKIE_VERSION))

  const units = parseUnitSystem(selection.units)
  if (units) parameters.set('u', units)

  const timeZone = parseTimeZone(selection.timeZone)
  if (timeZone) parameters.set('tz', timeZone)

  const locale = parseLocale(selection.locale)
  if (locale) parameters.set('l', locale)

  return parameters.toString()
}

/**
 * Read a selection back. Never throws: an unparseable, oversized, wrong-version
 * or hand-edited cookie yields `{}`, and a cookie with one bad field keeps its
 * good ones.
 */
export function decodePreferencesCookie(raw: string | null | undefined): NePreferenceSelection {
  if (typeof raw !== 'string') return {}
  if (raw.length === 0 || raw.length > MAX_COOKIE_LENGTH) return {}

  const parameters = new URLSearchParams(raw)
  if (parameters.get('v') !== String(NE_PREFERENCES_COOKIE_VERSION)) return {}

  const selection: NePreferenceSelection = {}
  const units = parseUnitSystem(parameters.get('u') ?? undefined)
  if (units) selection.units = units
  const timeZone = parseTimeZone(parameters.get('tz') ?? undefined)
  if (timeZone) selection.timeZone = timeZone
  const locale = parseLocale(parameters.get('l') ?? undefined)
  if (locale) selection.locale = locale
  return selection
}

/** What {@link resolvePreferences} needs. */
export interface ResolvePreferencesInput {
  /** The raw cookie value, however it was obtained. */
  cookie?: string | null
  /** The request-derived fallbacks. Defaults to {@link resolvePreferenceDefaults}. */
  defaults?: NePreferences
}

/** Merge a cookie selection over the request-derived defaults. */
export function resolvePreferences(input: ResolvePreferencesInput = {}): NePreferences {
  const defaults = input.defaults ?? resolvePreferenceDefaults()
  const selection = decodePreferencesCookie(input.cookie)
  return {
    locale: selection.locale ?? defaults.locale,
    timeZone: selection.timeZone ?? defaults.timeZone,
    units: selection.units ?? defaults.units,
  }
}

/**
 * The browser's own IANA zone, or `undefined` where it cannot be read. Only
 * ever called after mount — calling it during SSR is the hydration bug this
 * module exists to avoid.
 */
export function detectClientTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined
  } catch {
    return undefined
  }
}

/* -------------------------------------------------------------------------- */
/* Cache safety                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The `event.context` flag meaning "this response's body depends on the
 * preferences cookie". Set by {@link markPreferencesInfluenced}; read by
 * `setCacheProfile` and by the `preferences-cache` Nitro plugin.
 */
export const NE_PREFERENCES_INFLUENCED_CONTEXT_KEY = 'nardukPreferencesInfluenced'

/** The minimal shape of an H3 event this module touches, so it imports no h3. */
interface PreferenceAwareEvent {
  context?: Record<string, unknown>
}

/**
 * Record that this response varies by preference cookie.
 *
 * A page rendered with somebody's units must never be handed to somebody else
 * out of a shared cache. Calling `usePreferences()` or `readPreferences()`
 * during SSR sets this flag, and the response is then forced to
 * `Cache-Control: private, no-store` with `Vary: Cookie` — by `setCacheProfile`
 * for a route that uses it, and by the `preferences-cache` Nitro plugin for the
 * rendered HTML of an SSR page. Nothing downgrades a response that never
 * touched preferences, so an app's existing cache profiles are unaffected.
 */
export function markPreferencesInfluenced(event: PreferenceAwareEvent | null | undefined): void {
  if (!event || typeof event !== 'object') return
  if (!event.context) return
  event.context[NE_PREFERENCES_INFLUENCED_CONTEXT_KEY] = true
}

/** Whether {@link markPreferencesInfluenced} ran for this event. */
export function isPreferencesInfluenced(event: PreferenceAwareEvent | null | undefined): boolean {
  return event?.context?.[NE_PREFERENCES_INFLUENCED_CONTEXT_KEY] === true
}

/**
 * Merge `Cookie` into an existing `Vary` header value, case-insensitively and
 * without duplicating it. `*` is left alone: it already varies on everything.
 */
export function varyWithCookie(existing: string | null | undefined): string {
  const names = (existing ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
  if (names.includes('*')) return '*'
  if (names.some((name) => name.toLowerCase() === 'cookie')) return names.join(', ')
  return [...names, 'Cookie'].join(', ')
}
