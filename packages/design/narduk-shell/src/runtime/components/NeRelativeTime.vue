<script setup lang="ts">
/**
 * NeRelativeTime — "3 minutes ago" that stays true, as a real `<time>`.
 *
 * Renders `<time datetime="2026-03-08T20:30:00.000Z" title="Mar 8, 2026, 3:30 PM
 * EST">3 minutes ago</time>`: the machine-readable instant for crawlers and
 * assistive tech, the exact moment on hover, and the relative phrase on screen.
 * Every instance on a page shares one 30-second ticker (`useTimeAgo`), so a feed
 * of 200 rows costs one interval.
 *
 * House rules, from `./format`: relative while the value is live, an absolute
 * date once it is more than a week from now (`absolute-after`); the zone is a
 * required decision, never the browser's.
 *
 * Figures are tabular (`font-variant-numeric: tabular-nums`) so the text does
 * not jitter as digits change. The text of the `<time>` is allowed to differ
 * between the server render and hydration (`data-allow-mismatch="text"`): the
 * clock is the one input the two do not share.
 *
 * Styling contract: inherits the surrounding type; tokens only.
 */
import { computed, toRefs, toValue } from 'vue'

import { useTimeAgo } from '../composables/use-time-ago'

import type { NeRelativeTimeProps } from './ne-relative-time-types'

const props = withDefaults(defineProps<NeRelativeTimeProps>(), {
  locale: undefined,
  now: undefined,
  absoluteAfter: undefined,
  empty: undefined,
  title: undefined,
})

const { now: fixedNow } = toRefs(props)

const ago = useTimeAgo(() => props.value, {
  timeZone: () => props.timeZone,
  locale: () => props.locale,
  // Whether `now` is given is decided once: an instance that starts without
  // one joins the shared ticker and stays on it.
  ...(toValue(fixedNow) === undefined ? {} : { now: () => fixedNow.value }),
  absoluteAfter: () => props.absoluteAfter,
  empty: () => props.empty,
})

const tooltip = computed(() => props.title ?? (ago.iso.value ? ago.absolute.value : undefined))
</script>

<template>
  <time
    class="ne-relative-time"
    :datetime="ago.iso.value"
    :title="tooltip"
    :data-relative="ago.relative.value ? '' : undefined"
    data-allow-mismatch="text"
    >{{ ago.text.value }}</time
  >
</template>

<style scoped>
.ne-relative-time {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
