<script setup lang="ts">
/**
 * NeBottomTabBar — the phone's bottom navigation: three to five top-level
 * sections, an icon over a label, pinned to the bottom edge.
 *
 * Six apps hand-rolled this (buoys, float-forecast, music, mybo-at-v2,
 * riverstatus, operator-portal). What they each had to get right, here once:
 *
 * 1. **Which tab is lit.** An exact path wins, then the longest matching
 *    prefix, then an optional `fallback` (a "More" tab). `match` adds prefixes
 *    a tab owns. See `resolveBottomTabs`.
 * 2. **Honest `aria-current`.** `page` only on the tab's own path; `true` when
 *    the page is inside the tab's section; nothing on a fallback tab, which is
 *    lit for orientation but is not where you are.
 * 3. **Safe area and reserved space.** Bottom padding includes
 *    `env(safe-area-inset-bottom)`, a spacer in the flow keeps the last row
 *    clear, and `--ne-bottom-bar-h` is published so focus and anchor jumps
 *    land above the bar. With a NeStickyActionBar on the same page the token
 *    is the two heights summed, and the action bar sits above the tab bar
 *    (`--ne-bottom-nav-h`), so neither covers the other.
 * 4. **Tap targets.** Each tab is the full height of the bar and at least
 *    2.75rem wide.
 *
 * Put it once, in the layout. By default it exists only below `md`.
 *
 * Styling contract: tokens only. The `#item` slot replaces a tab's content
 * (icon and label) and gets `{ item, state }`; the link, its `aria-current`
 * and its tap target stay the component's.
 */
import UIcon from '@nuxt/ui/components/Icon.vue'
import ULink from '@nuxt/ui/components/Link.vue'
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { routeLocationKey } from 'vue-router'

import { resolveBottomTabs } from './ne-bottom-tab-bar-types'
import { claimBottomBarToken, releaseBottomBarToken } from './ne-sticky-action-bar-token'

import type {
  NeBottomTabBarProps,
  NeBottomTabItem,
  NeBottomTabState,
} from './ne-bottom-tab-bar-types'

const props = withDefaults(defineProps<NeBottomTabBarProps>(), {
  label: 'Primary',
  fallback: undefined,
  path: undefined,
  phoneOnly: true,
})

defineSlots<{
  /** A tab's content, in place of the icon and label. */
  item?(props: { item: NeBottomTabItem; state: NeBottomTabState }): unknown
}>()

const route = inject(routeLocationKey, null)
// With neither a router nor a `path`, nothing is lit rather than guessing `/`.
const currentPath = computed(() => props.path ?? route?.path)
function ariaCurrent(state: NeBottomTabState): 'page' | 'true' | undefined {
  if (state === 'page') return 'page'
  if (state === 'section') return 'true'
  return undefined
}

const tabs = computed(() => {
  const path = currentPath.value
  const states =
    path === undefined
      ? props.items.map((): NeBottomTabState => 'none')
      : resolveBottomTabs(props.items, path, props.fallback)
  return props.items.map((item, index) => {
    const state = states[index] ?? 'none'
    return { item, state, current: ariaCurrent(state) }
  })
})

const bar = ref<HTMLElement | null>(null)
const height = ref<number | null>(null)
let observer: ResizeObserver | undefined
const entry = { kind: 'nav' as const, px: 0 }

function publish(px: number) {
  height.value = px
  entry.px = px
  claimBottomBarToken(entry)
}

onMounted(() => {
  const element = bar.value
  if (!element) return
  // A phone-only bar hidden on a wide screen measures 0, which is what the
  // token should be there.
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
    class="ne-bottom-tab-bar"
    :data-phone-only="phoneOnly ? '' : undefined"
    :style="{ '--ne-bottom-tab-bar-h': height === null ? undefined : `${height}px` }"
  >
    <div class="ne-bottom-tab-bar__spacer" aria-hidden="true" />
    <nav ref="bar" class="ne-bottom-tab-bar__bar" :aria-label="label">
      <ULink
        v-for="tab in tabs"
        :key="tab.item.to"
        :to="tab.item.to"
        raw
        class="ne-bottom-tab-bar__tab"
        :data-state="tab.state"
        :aria-current="tab.current"
        :data-testid="tab.item.testid"
      >
        <slot name="item" :item="tab.item" :state="tab.state">
          <UIcon
            v-if="tab.item.icon"
            :name="tab.item.icon"
            class="ne-bottom-tab-bar__icon"
            aria-hidden="true"
          />
          <span class="ne-bottom-tab-bar__label">{{ tab.item.label }}</span>
        </slot>
      </ULink>
    </nav>
  </div>
</template>

<style scoped>
.ne-bottom-tab-bar__spacer {
  height: var(--ne-bottom-tab-bar-h, calc(3.5rem + env(safe-area-inset-bottom)));
}

.ne-bottom-tab-bar__bar {
  position: fixed;
  inset-inline: 0;
  bottom: 0;
  z-index: 30;
  display: flex;
  min-height: 3.5rem;
  padding: 0 0.5rem env(safe-area-inset-bottom);
  background: var(--ne-surface);
  border-top: 1px solid var(--ne-hairline);
}

.ne-bottom-tab-bar__tab {
  display: flex;
  flex: 1 1 0;
  min-width: 2.75rem;
  min-height: 3.5rem;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.1875rem;
  color: var(--ne-ink-muted);
  font-size: var(--ne-text-label);
  font-weight: 600;
  line-height: 1.1;
  text-align: center;
  text-decoration: none;
}

.ne-bottom-tab-bar__tab[data-state='page'],
.ne-bottom-tab-bar__tab[data-state='section'],
.ne-bottom-tab-bar__tab[data-state='fallback'] {
  color: var(--ne-ink);
}

.ne-bottom-tab-bar__tab:focus-visible {
  outline: 2px solid var(--ne-accent);
  outline-offset: -2px;
}

.ne-bottom-tab-bar__icon {
  width: 1.375rem;
  height: 1.375rem;
}

@media (min-width: 48rem) {
  .ne-bottom-tab-bar[data-phone-only] .ne-bottom-tab-bar__spacer,
  .ne-bottom-tab-bar[data-phone-only] .ne-bottom-tab-bar__bar {
    display: none;
  }
}
</style>
