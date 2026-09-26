<script setup lang="ts">
/*
 * NE Base design card for the `./format` subpath — components backlog item 5
 * (narduk-libs#252).
 *
 * The only card in the gallery that previews something other than a registered
 * component, which is why `src/surface-cards.ts` exists: a card file with no
 * entry in either that list or `src/registry.ts` still fails the build.
 *
 * Every row below is produced by **calling the formatter**, not by
 * transcribing what it once returned, so the card is a live proof that the
 * house date, number, money and unit formats look the way this section says
 * they do. The inputs are fixed constants and the zone and locale are named
 * explicitly, so the rendered HTML is byte-identical on every rebuild —
 * `check:package` re-renders this gallery and compares it byte for byte, and a
 * card whose output moved with the clock would fail that gate on its second
 * run.
 */
import {
  createFormatters,
  formatCompact,
  formatDuration,
  formatMoney,
  formatNumber,
  formatPercent,
  formatQuantity,
} from '../format'

/** A fixed instant and a fixed `now`. No clock is read anywhere on this card. */
const AT = '2026-03-08T08:30:00Z'
const NOW = '2026-03-08T11:30:00Z'

const chicago = createFormatters({ timeZone: 'America/Chicago', locale: 'en-US' })
const en = { locale: 'en-US' } as const

const dates = [
  { call: 'formatDate(at)', output: chicago.formatDate(AT) },
  { call: 'formatDateTime(at)', output: chicago.formatDateTime(AT) },
  // The same instant in another zone. One value, two readers, two strings --
  // which is the whole reason `timeZone` is required rather than defaulted.
  {
    call: "formatDateTime(at, { timeZone: 'Asia/Tokyo' })",
    output: chicago.formatDateTime(AT, { timeZone: 'Asia/Tokyo' }),
  },
  {
    call: "formatDateTime(at, { timeZoneName: 'short' })",
    output: chicago.formatDateTime(AT, { timeZoneName: 'short' }),
  },
  { call: 'formatRelative(at, { now })', output: chicago.formatRelative(AT, { now: NOW }) },
  { call: 'formatDate(null)', output: chicago.formatDate(null) },
  // The day key: 04:30 UTC on the 8th is still the 7th on a Chicago clock.
  {
    call: "calendarDateIn('2026-03-08T04:30:00Z')",
    output: chicago.calendarDateIn('2026-03-08T04:30:00Z'),
  },
]

const numbers = [
  {
    call: 'formatNumber(1234.5678, { digits: 2 })',
    output: formatNumber(1234.5678, { ...en, digits: 2 }),
  },
  { call: 'formatCompact(1_234_567)', output: formatCompact(1_234_567, en) },
  { call: 'formatPercent(0.055)', output: formatPercent(0.055, en) },
  {
    call: "formatMoney(1234.5, { currency: 'USD' })",
    output: formatMoney(1234.5, { ...en, currency: 'USD' }),
  },
  {
    call: "formatQuantity(5, { unit: 'foot' })",
    output: formatQuantity(5, { ...en, unit: 'foot' }),
  },
  {
    call: "formatQuantity(1234, { unit: 'cfs' })",
    output: formatQuantity(1234, { ...en, unit: 'cfs' }),
  },
  { call: 'formatDuration(5_400_000)', output: formatDuration(5_400_000, en) },
  { call: 'formatDuration(-90_000)', output: formatDuration(-90_000, en) },
  { call: 'formatDuration(0)', output: formatDuration(0, en) },
]
</script>

<template>
  <section
    class="preview-card"
    data-design-card="formatters"
    data-name="Formatters"
    data-group="Shell"
  >
    <h2>Formatters</h2>
    <p>
      The house date, number, money and unit formats, from
      <code>@narduk-enterprises/narduk-shell/format</code>. Every value below is rendered from one
      fixed instant, <code>2026-03-08T08:30:00Z</code>, against a fixed <code>now</code> of
      <code>2026-03-08T11:30:00Z</code>, in <code>America/Chicago</code> and <code>en-US</code>.
      Nothing reads the clock or the host time zone, which is why a value rendered on the server and
      re-rendered in the browser is the same string.
    </p>

    <h3>Dates and times</h3>
    <div v-for="row in dates" :key="row.call" class="preview-row">
      <code class="mono">{{ row.call }}</code>
      <span class="mono">{{ row.output }}</span>
    </div>

    <h3>Numbers, money and spans</h3>
    <div v-for="row in numbers" :key="row.call" class="preview-row">
      <code class="mono">{{ row.call }}</code>
      <span class="mono">{{ row.output }}</span>
    </div>
  </section>
</template>
