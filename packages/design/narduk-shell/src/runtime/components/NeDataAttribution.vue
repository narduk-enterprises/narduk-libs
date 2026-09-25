<script setup lang="ts">
/**
 * NeDataAttribution — one consistent "Data from <source>, updated <time>"
 * credit for an app that shows third-party data (narduk-libs#388).
 *
 * Times go through `./format` and inherit its rules: the zone is a required
 * prop, and a relative time is only ever measured against the caller's `now`,
 * so the server and the browser render the same string. A bare `YYYY-MM-DD`
 * is a calendar date and prints as one; an instant prints with its time. A
 * missing or unparseable time drops the "updated" clause rather than printing
 * a dash after it — "updated —" reads as a claim about freshness.
 *
 * Every `<time>` carries a machine-readable `datetime`, and a relative one
 * carries the absolute reading as its `title`.
 *
 * Links: only an absolute http(s) href becomes an `<a>`, always with
 * `rel="noopener noreferrer"`; `target="_blank"` only when `newTab` is set.
 */
import { computed } from 'vue'

import { formatDate, formatDateTime, formatRelative } from '../../format'

import { safeAttributionHref } from './ne-data-attribution-types'

import type { NeDateInput } from '../../format'
import type { NeDataAttributionProps, NeDataSource } from './ne-data-attribution-types'

const props = withDefaults(defineProps<NeDataAttributionProps>(), {
  label: 'Data from',
  newTab: false,
  now: undefined,
  updatedAt: undefined,
})

interface Stamp {
  /** `datetime` attribute: ISO instant, or the calendar date as given. */
  datetime: string
  text: string
  /** The absolute reading, set only when `text` is relative. */
  title?: string
}

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/

function instantOf(value: NeDateInput): number | undefined {
  if (value === null || value === undefined) return undefined
  const instant =
    value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(instant) ? instant : undefined
}

function stamp(value: NeDateInput): Stamp | null {
  if (typeof value === 'string' && CALENDAR_DATE.test(value)) {
    if (instantOf(value) === undefined) return null
    const absolute = formatDate(value, { timeZone: props.timeZone })
    return { datetime: value, text: absolute }
  }
  const instant = instantOf(value)
  if (instant === undefined) return null
  const absolute = formatDateTime(instant, { timeZone: props.timeZone })
  const datetime = new Date(instant).toISOString()
  if (instantOf(props.now) === undefined) return { datetime, text: absolute }
  return {
    datetime,
    text: formatRelative(instant, { now: props.now, timeZone: props.timeZone }),
    title: absolute,
  }
}

const entries = computed(() => {
  const list: readonly NeDataSource[] = Array.isArray(props.sources)
    ? props.sources
    : [props.sources as NeDataSource]
  return list.map((source, index) => {
    const license =
      source.license === undefined
        ? null
        : typeof source.license === 'string'
          ? { href: undefined, name: source.license }
          : { href: safeAttributionHref(source.license.href), name: source.license.name }
    return {
      href: safeAttributionHref(source.href),
      key: `${index}:${source.name}`,
      license,
      name: source.name,
      separator: index === list.length - 1 ? '' : index === list.length - 2 ? ' and ' : ', ',
      updated: stamp(source.updatedAt),
    }
  })
})

const shared = computed(() => stamp(props.updatedAt))

const target = computed(() => (props.newTab ? '_blank' : undefined))
</script>

<template>
  <p data-ne-data-attribution class="ne-data-attribution text-xs text-muted">
    {{ label }}
    <template v-for="entry in entries" :key="entry.key">
      <span data-ne-attribution-source
        ><a
          v-if="entry.href"
          :href="entry.href"
          rel="noopener noreferrer"
          :target="target"
          class="underline underline-offset-2 hover:text-highlighted"
          >{{ entry.name }}</a
        ><template v-else>{{ entry.name }}</template
        ><template v-if="entry.license || entry.updated">
          (<span v-if="entry.license" data-ne-attribution-license
            ><a
              v-if="entry.license.href"
              :href="entry.license.href"
              rel="noopener noreferrer"
              :target="target"
              class="underline underline-offset-2 hover:text-highlighted"
              >{{ entry.license.name }}</a
            ><template v-else>{{ entry.license.name }}</template></span
          ><template v-if="entry.license && entry.updated">, </template
          ><template v-if="entry.updated"
            >updated
            <time :datetime="entry.updated.datetime" :title="entry.updated.title">{{
              entry.updated.text
            }}</time></template
          >)</template
        ></span
      >{{ entry.separator }}
    </template>
    <template v-if="shared"
      >, updated <time :datetime="shared.datetime" :title="shared.title">{{ shared.text }}</time>
    </template>
  </p>
</template>
