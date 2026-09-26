/**
 * The whole `./format` surface, run against fixed inputs, printed as one JSON
 * object per line.
 *
 * `test/format.ssr.test.ts` runs this file in a child process under several
 * `TZ` and `LC_ALL`/`LANG` settings and requires byte-identical stdout. Node
 * reads both at process start, so a child process is the only honest way to
 * prove that neither reaches the output — mutating `process.env.TZ` inside the
 * test process would prove something weaker about a different mechanism.
 *
 * Deliberately plain `.mjs`, run by Node with nothing but native type
 * stripping in play: that is also the standing proof that this module is
 * importable from a plain Node script and from `nuxt.config.ts`, with no
 * bundler, no Vue and no Nuxt.
 *
 * The specifier below carries its `.ts` extension because Node's ESM resolver
 * does no extension guessing. Nothing under `src/` may do the same — a
 * consuming app's own `tsc` reads `src/format.ts` and rejects an explicit
 * `.ts` extension with TS5097. `test/format.ssr.test.ts` asserts that.
 */
import {
  calendarDateIn,
  createFormatters,
  formatCompact,
  formatDate,
  formatDateTime,
  formatDuration,
  formatMoney,
  formatNumber,
  formatPercent,
  formatQuantity,
  formatRelative,
  isSameCalendarDay,
} from '../../src/format.ts'

const CHICAGO = 'America/Chicago'
const TOKYO = 'Asia/Tokyo'
const en = { locale: 'en-US' }

/** One fixed instant, and one fixed `now`. No clock is read anywhere here. */
const AT = '2026-03-08T08:30:00Z'
const NOW = '2026-03-09T08:00:00Z'

const cases = [
  ['date.chicago', formatDate(AT, { ...en, timeZone: CHICAGO })],
  ['date.tokyo', formatDate(AT, { ...en, timeZone: TOKYO })],
  ['date.utc', formatDate(AT, { ...en, timeZone: 'UTC' })],
  ['date.calendarOnly', formatDate('2026-03-08', { ...en, timeZone: CHICAGO })],
  ['date.default-locale', formatDate(AT, { timeZone: CHICAGO })],
  ['date.empty', formatDate(undefined, { ...en, timeZone: CHICAGO })],
  ['dateTime.chicago', formatDateTime(AT, { ...en, timeZone: CHICAGO })],
  ['dateTime.tokyo', formatDateTime(AT, { ...en, timeZone: TOKYO })],
  ['dateTime.zoneName', formatDateTime(AT, { ...en, timeZone: CHICAGO, timeZoneName: 'short' })],
  [
    'dateTime.zoneName.standard',
    formatDateTime('2026-01-08T08:30:00Z', { ...en, timeZone: CHICAGO, timeZoneName: 'short' }),
  ],
  ['dateTime.default-locale', formatDateTime(AT, { timeZone: CHICAGO })],
  ['calendarDate.chicago', calendarDateIn('2026-03-08T04:30:00Z', { timeZone: CHICAGO })],
  ['calendarDate.tokyo', calendarDateIn('2026-03-08T04:30:00Z', { timeZone: TOKYO })],
  ['calendarDate.floating', calendarDateIn('2026-03-08', { timeZone: TOKYO })],
  ['calendarDate.empty', calendarDateIn(null, { timeZone: CHICAGO })],
  [
    'calendarDate.sameDay',
    String(isSameCalendarDay('2026-03-08T04:30:00Z', '2026-03-07', { timeZone: CHICAGO })),
  ],
  ['relative.chicago', formatRelative(AT, { ...en, now: NOW, timeZone: CHICAGO })],
  ['relative.tokyo', formatRelative(AT, { ...en, now: NOW, timeZone: TOKYO })],
  ['relative.hours', formatRelative(AT, { ...en, now: '2026-03-08T11:30:00Z', timeZone: CHICAGO })],
  ['relative.default-locale', formatRelative(AT, { now: NOW, timeZone: CHICAGO })],
  ['duration.hoursMinutes', formatDuration(5_400_000, en)],
  ['duration.zero', formatDuration(0, en)],
  ['duration.negative', formatDuration(-90_000, en)],
  ['duration.default-locale', formatDuration(5_400_000)],
  ['number.plain', formatNumber(1234.5678, en)],
  ['number.default-locale', formatNumber(1234.5678)],
  ['compact.millions', formatCompact(1_234_567, en)],
  ['compact.default-locale', formatCompact(1_234_567)],
  ['percent.fraction', formatPercent(0.055, en)],
  ['percent.points', formatPercent(5.5, { ...en, input: 'percent' })],
  ['percent.default-locale', formatPercent(0.055)],
  ['money.usd', formatMoney(1234.5, { ...en, currency: 'USD' })],
  ['money.default-locale', formatMoney(1234.5, { currency: 'USD' })],
  ['quantity.intlUnit', formatQuantity(5, { ...en, unit: 'foot' })],
  ['quantity.unknownUnit', formatQuantity(1234, { ...en, unit: 'cfs' })],
  ['quantity.default-locale', formatQuantity(5, { unit: 'foot' })],
]

const bound = createFormatters({ timeZone: CHICAGO })
cases.push(
  ['bound.date', bound.formatDate(AT)],
  ['bound.dateTime', bound.formatDateTime(AT)],
  ['bound.relative', bound.formatRelative(AT, { now: NOW })],
  ['bound.money', bound.formatMoney(1234.5, { currency: 'USD' })],
)

// A per-call option that is explicitly `undefined` -- what a caller gets for
// free from any optional field, e.g. `{ timeZone: row.zone }` -- must fall back
// to the bound zone. A plain spread would keep the own property, and `Intl`
// reads an own `undefined` `timeZone` as the host's, so these three lines would
// differ under each TZ below. narduk-libs#283 review.
const absent = undefined
cases.push(
  ['bound.date.undefinedZone', bound.formatDate(AT, { timeZone: absent })],
  ['bound.dateTime.undefinedZone', bound.formatDateTime(AT, { timeZone: absent })],
  ['bound.relative.undefinedZone', bound.formatRelative(AT, { now: NOW, timeZone: absent })],
  ['bound.number.undefinedLocale', bound.formatNumber(1234.5678, { locale: absent })],
)

for (const [name, output] of cases) {
  process.stdout.write(`${JSON.stringify({ name, output })}\n`)
}
