<script setup lang="ts">
/**
 * NeTruncate — a long URL, path or id on one line, cut in the middle
 * (narduk-libs#1855).
 *
 * CSS cannot truncate the middle of a string, so the string is split once, in
 * script, by `splitTruncate` (`../../format`): the head shrinks with an
 * ellipsis and the tail stays whole. There is no measurement, so the server
 * and the browser render the same markup.
 *
 * The text content is the whole value (head and tail are adjacent spans with
 * no whitespace between them), so it copies, searches and reads out in full,
 * and the same value is the `title`. A `title` alone does nothing on touch or
 * from the keyboard, so the root is a focusable button: Enter, Space or a tap
 * toggles it open, wrapping the full value in place.
 *
 * Styling contract: tokens only; the rest is layout.
 */
import { computed, ref } from 'vue'

import { splitTruncate } from '../../format'

import type { NeTruncateKind } from '../../format'

const props = withDefaults(
  defineProps<{
    /** `url` keeps the last path segment, `path` the filename, `id` the last `tail` characters. */
    kind?: NeTruncateKind
    /** `middle` keeps the tail whole; `end` is a plain trailing ellipsis. */
    mode?: 'end' | 'middle'
    /** Characters kept whole at the end (`middle` only). */
    tail?: number
    /** The full value. It is always the text content and the tooltip. */
    text: string
  }>(),
  { mode: 'middle', tail: 14, kind: undefined },
)

const expanded = ref(false)

const split = computed(() =>
  props.mode === 'end'
    ? { head: props.text, tail: '' }
    : splitTruncate(props.text, { tail: props.tail, kind: props.kind }),
)

function toggle() {
  expanded.value = !expanded.value
}
</script>

<template>
  <span
    class="ne-truncate"
    :class="{ 'ne-truncate--expanded': expanded }"
    :data-kind="kind"
    role="button"
    tabindex="0"
    :title="text"
    :aria-expanded="expanded"
    @click="toggle"
    @keydown.enter.prevent="toggle"
    @keydown.space.prevent="toggle"
    ><span class="ne-truncate__head">{{ split.head }}</span
    ><span v-if="split.tail" class="ne-truncate__tail">{{ split.tail }}</span></span
  >
</template>

<style scoped>
.ne-truncate {
  display: inline-flex;
  max-width: 100%;
  min-width: 0;
  vertical-align: bottom;
  white-space: nowrap;
  cursor: pointer;
  border-radius: var(--ne-radius-control);
}

.ne-truncate:focus-visible {
  outline: 2px solid var(--ne-accent);
  outline-offset: 2px;
}

.ne-truncate__head {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ne-truncate__tail {
  flex: none;
}

/* An id keeps something of its start even when the row is narrow. */
.ne-truncate[data-kind='id'] .ne-truncate__head {
  min-width: 4ch;
}

.ne-truncate--expanded {
  display: inline;
  white-space: normal;
  overflow-wrap: anywhere;
}

.ne-truncate--expanded .ne-truncate__head {
  overflow: visible;
}
</style>
