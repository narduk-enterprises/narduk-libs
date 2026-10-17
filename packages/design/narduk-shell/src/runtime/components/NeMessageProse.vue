<script setup lang="ts">
/**
 * NeMessageProse — what an agent or a bot wrote, formatted: bold, code, lists
 * and `https:` links instead of `**`, backticks and markers showing.
 *
 * Block mode is `NeProse` (no `v-html`; every source character reaches the DOM
 * as a text node) on the blocks `messageProseBlocks()` makes, in a compact skin
 * that takes its type, leading and ink from the place it sits in. With `clamp`,
 * a message past that many lines is cut with a Show more / Show less button.
 * The clamp is a height, not a hover rule, so nothing about it moves when the
 * pointer does; the button exists only once the text is measured to overflow,
 * and a message that fits has none.
 *
 * Inline mode is one line: `messageProseInline()` runs rendered as `strong`,
 * `em`, `code` and links, never a block element, with a line break as a space.
 * It is an inline `span`: the caller's ellipsis or line-clamp (on this element
 * or its parent) still applies, and `title` reads the text without markers.
 *
 * Links are `https:` only, in a new tab; every other link is its text
 * (`../utils/message-prose.ts` has the rules).
 */
import UButton from '@nuxt/ui/components/Button.vue'
import { computed, h, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'

import {
  isMessageHref,
  messageProseBlocks,
  messageProseInline,
  messageProseText,
} from '../utils/message-prose'
import { safeProseHref } from '../utils/prose'

import NeProse from './NeProse.vue'

import type { NeMessageProseProps } from './ne-message-prose-types'
import type { NeProseInline } from './ne-prose-types'
import type { FunctionalComponent, VNodeChild } from 'vue'

const props = withDefaults(defineProps<NeMessageProseProps>(), {
  clamp: undefined,
  mode: 'block',
  text: undefined,
})

const inline = computed(() => props.mode === 'inline')
const blocks = computed(() => (inline.value ? [] : messageProseBlocks(props.text)))
const runs = computed(() => (inline.value ? messageProseInline(props.text) : []))
const plain = computed(() => (inline.value ? messageProseText(props.text) : ''))
const lines = computed(() =>
  !inline.value && Number.isFinite(props.clamp) && (props.clamp ?? 0) > 0 ? props.clamp : undefined,
)

const boxId = useId()
const box = ref<HTMLElement | null>(null)
const expanded = ref(false)
const overflowing = ref(false)

/** Measured only while clamped: an expanded message has no clamp to overflow, and its button stays so it can be closed again. */
function measure() {
  const el = box.value
  if (el && lines.value !== undefined && !expanded.value) {
    overflowing.value = el.scrollHeight > el.clientHeight + 1
  } else if (lines.value === undefined) {
    overflowing.value = false
  }
}

let resize: ResizeObserver | undefined
onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') resize = new ResizeObserver(measure)
  measure()
})
onBeforeUnmount(() => resize?.disconnect())
watch(
  box,
  (el) => {
    resize?.disconnect()
    if (el) resize?.observe(el)
  },
  { flush: 'post' },
)
watch(
  () => [props.text, props.mode, props.clamp],
  () => {
    expanded.value = false
    void nextTick(measure)
  },
)
watch(expanded, () => void nextTick(measure))

function renderRuns(list: readonly NeProseInline[]): VNodeChild[] {
  return list.map((run) => renderRun(run))
}

function renderRun(run: NeProseInline): VNodeChild {
  switch (run.type) {
    case 'text': {
      return run.value
    }
    case 'break': {
      return ' '
    }
    case 'code': {
      return h('code', run.value)
    }
    case 'strong': {
      return h('strong', renderRuns(run.children))
    }
    case 'em': {
      return h('em', renderRuns(run.children))
    }
    case 'link': {
      // Checked again here, as NeProse does: `runs` could be built by hand one day.
      const href = safeProseHref(run.href)
      if (href === null || !isMessageHref(href)) return renderRuns(run.children)
      return h('a', { href, target: '_blank', rel: 'noopener' }, renderRuns(run.children))
    }
  }
}

const InlineRuns: FunctionalComponent<{ runs: readonly NeProseInline[] }> = (nodeProps) =>
  renderRuns(nodeProps.runs)
InlineRuns.props = ['runs']
</script>

<template>
  <span
    v-if="inline"
    class="ne-message-prose ne-message-prose--inline"
    data-testid="ne-message-prose"
    :title="plain || undefined"
    ><InlineRuns :runs="runs"
  /></span>
  <div v-else class="ne-message-prose" data-testid="ne-message-prose">
    <div
      :id="boxId"
      ref="box"
      class="ne-message-prose__box"
      :class="{
        'ne-message-prose__box--clamped': lines !== undefined && !expanded,
        'ne-message-prose__box--cut': lines !== undefined && !expanded && overflowing,
      }"
      :style="lines !== undefined && !expanded ? { maxHeight: `${lines}lh` } : undefined"
    >
      <NeProse :blocks="blocks" class="ne-message-prose__prose" external-links-new-tab />
    </div>
    <UButton
      v-if="overflowing"
      class="ne-message-prose__more"
      type="button"
      color="neutral"
      variant="link"
      size="xs"
      :label="expanded ? 'Show less' : 'Show more'"
      :aria-expanded="expanded ? 'true' : 'false'"
      :aria-controls="boxId"
      data-testid="ne-message-prose-toggle"
      @click="expanded = !expanded"
    />
  </div>
</template>

<style scoped>
/*
 * Token reads only (README § Styling contract). A message keeps the type,
 * leading and ink of the place it sits in; NeProse's own document type steps
 * are reset here, and a message has no heading to draw one for.
 */
.ne-message-prose {
  min-width: 0;
  overflow-wrap: anywhere;
}

/* The height is the box's `max-height`, `clamp` line-heights, bound inline. */
.ne-message-prose__box--clamped {
  overflow: hidden;
}

/* A cut message fades out over its last line rather than slicing it. */
.ne-message-prose__box--cut {
  mask-image: linear-gradient(to bottom, black calc(100% - 1.5lh), transparent);
}

.ne-message-prose__prose.ne-prose {
  font-size: inherit;
  line-height: inherit;
  color: inherit;
}

.ne-message-prose__prose.ne-prose :deep(:is(p, ul, ol, pre, blockquote, .ne-prose__table)) {
  margin: 0 0 0.35em;
}

/* A single newline in a message is the writer's line break (markdown would fold it into a space). */
.ne-message-prose__prose.ne-prose :deep(:is(p, li)) {
  white-space: pre-line;
}

/* The last block's margin would count as overflow and show a Show more button that reveals nothing. */
.ne-message-prose__prose.ne-prose > :deep(:last-child) {
  margin-bottom: 0;
}

.ne-message-prose__prose.ne-prose :deep(li > :is(p, ul, ol, pre, blockquote)) {
  margin: 0;
}

.ne-message-prose__prose.ne-prose :deep(:is(ul, ol)) {
  padding-inline-start: 1.25em;
}

.ne-message-prose__prose.ne-prose :deep(strong) {
  color: inherit;
}

.ne-message-prose__prose.ne-prose :deep(hr) {
  margin: 0.5em 0;
}

.ne-message-prose__prose.ne-prose :deep(code),
.ne-message-prose--inline :deep(code) {
  padding: 0 0.3em;
  font-family: var(--ne-font-mono);
  font-size: 0.9em;
  background-color: var(--ne-surface-muted);
  color: inherit;
}

.ne-message-prose__prose.ne-prose :deep(pre) {
  padding: 0.4em 0.6em;
  font-size: var(--ne-text-small);
}

.ne-message-prose__prose.ne-prose :deep(pre code) {
  padding: 0;
  background: none;
}

.ne-message-prose--inline :deep(strong) {
  font-weight: 600;
}

.ne-message-prose--inline :deep(a) {
  color: var(--ne-accent);
  text-decoration: underline;
  text-underline-offset: 0.15em;
}

.ne-message-prose__more {
  min-height: 1.75rem;
  padding: 0;
  font-weight: 600;
  color: var(--ne-accent);
}

/* The one tap target on a touch screen; a pointer keeps the denser row. */
@media (pointer: coarse) {
  .ne-message-prose__more {
    min-height: 2.75rem;
  }
}

@media (forced-colors: active) {
  .ne-message-prose :deep(:is(code, pre)) {
    border: 1px solid CanvasText;
  }
}
</style>
