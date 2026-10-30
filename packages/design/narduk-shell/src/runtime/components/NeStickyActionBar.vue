<script setup lang="ts">
/**
 * NeStickyActionBar — the phone's bottom call-to-action bar: "Buy", "Save
 * picks", "Continue". A page action, not navigation.
 *
 * It does three things a hand-rolled `fixed bottom-0` bar gets wrong:
 *
 * 1. **Safe area.** The bar's bottom padding includes
 *    `env(safe-area-inset-bottom)`, so its buttons clear the home indicator
 *    (`narduk-core` already sets `viewport-fit=cover`, which is what makes the
 *    inset non-zero).
 * 2. **It never covers the last row.** The component renders a spacer in the
 *    page's flow, exactly as tall as the bar, so the end of the content can
 *    always scroll clear of it. The height is measured (the bar wraps when its
 *    content does), with a CSS fallback for the first paint.
 * 3. **Focus and anchors land clear.** While mounted and visible it sets
 *    `--ne-bottom-bar-h` on the document, the token `theme.css` turns into
 *    `scroll-padding-bottom`, so a focused field or an anchor jump scrolls above
 *    the bar. It puts the old value back when the last bar leaves.
 *
 * Put it where the page's content ends, once per page. By default it exists
 * only below `md`; on a wider screen it and its spacer are `display: none`.
 *
 * Styling contract: tokens only. The default slot is the bar's content, laid
 * out as a flex row (give a button `class="flex-1"` to share the width).
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

import { claimBottomBarToken, releaseBottomBarToken } from './ne-sticky-action-bar-token'

import type { NeStickyActionBarProps } from './ne-sticky-action-bar-types'

withDefaults(defineProps<NeStickyActionBarProps>(), {
  label: 'Actions',
  phoneOnly: true,
})

defineSlots<{
  /** The bar's content: the page's primary action, and at most one secondary. */
  default?(): unknown
}>()

const bar = ref<HTMLElement | null>(null)
/** The measured height in px; `null` until mounted. */
const height = ref<number | null>(null)

let observer: ResizeObserver | undefined
const entry = { kind: 'action' as const, px: 0 }

function publish(px: number) {
  height.value = px
  entry.px = px
  claimBottomBarToken(entry)
}

onMounted(() => {
  const element = bar.value
  if (!element) return
  claimBottomBarToken(entry, element.ownerDocument.documentElement)
  publish(element.offsetHeight)
  if (typeof ResizeObserver === 'undefined') return
  observer = new ResizeObserver(() => publish(element.offsetHeight))
  observer.observe(element)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  releaseBottomBarToken(entry)
})
</script>

<template>
  <div
    class="ne-sticky-action-bar"
    :data-phone-only="phoneOnly ? '' : undefined"
    :style="{ '--ne-sticky-action-bar-h': height === null ? undefined : `${height}px` }"
  >
    <div class="ne-sticky-action-bar__spacer" aria-hidden="true" />
    <div ref="bar" class="ne-sticky-action-bar__bar" role="group" :aria-label="label">
      <slot />
    </div>
  </div>
</template>

<style scoped>
/* Before the bar is measured the spacer is a 3.5rem row plus the inset. */
.ne-sticky-action-bar__spacer {
  height: var(--ne-sticky-action-bar-h, calc(3.5rem + env(safe-area-inset-bottom)));
}

.ne-sticky-action-bar__bar {
  position: fixed;
  inset-inline: 0;
  /* Above a NeBottomTabBar when the layout has one. */
  bottom: var(--ne-bottom-nav-h, 0px);
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.625rem 1rem calc(0.625rem + env(safe-area-inset-bottom));
  background: var(--ne-surface);
  border-top: 1px solid var(--ne-hairline);
  box-shadow: var(--ne-shadow-2);
}

/* md and up: a desktop page keeps its actions in the page. */
@media (min-width: 48rem) {
  .ne-sticky-action-bar[data-phone-only] .ne-sticky-action-bar__spacer,
  .ne-sticky-action-bar[data-phone-only] .ne-sticky-action-bar__bar {
    display: none;
  }
}
</style>
