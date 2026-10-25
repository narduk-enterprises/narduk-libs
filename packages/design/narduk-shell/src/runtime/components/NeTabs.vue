<script setup lang="ts">
/**
 * NeTabs — a tab strip whose state can live in the URL.
 *
 * Two ways to hold the selection, chosen once:
 *
 * - `v-model` — local state, like any tab control.
 * - `route-param="tab"` — the selection is `?tab=trades`, written with
 *   `router.replace` (no history entry per click), other query keys and the hash
 *   kept, the default tab leaving the URL clean. A tab becomes linkable,
 *   reloadable and shareable. See `useRouteTab`, which it is built on.
 *
 * Behaviour a tab strip owes its users, all here:
 *
 * - `role="tablist"` / `role="tab"` / `role="tabpanel"`, `aria-selected`,
 *   `aria-controls` and `aria-labelledby` wired with SSR-stable ids.
 * - **Roving focus.** One tab is in the Tab order; ArrowLeft / ArrowRight move
 *   (and select) among the enabled tabs, wrapping; Home and End jump to the
 *   ends. Disabled tabs are skipped.
 * - **The active tab is scrolled into view** inside the strip, so on a phone
 *   where the strip overflows, the selected tab is never off-screen after a
 *   reload or a deep link. Only the strip scrolls, never the page, and
 *   `useReducedMotion()` turns the glide into a jump.
 * - A 2.75rem tap target and an indicator that reserves its space (the selected
 *   tab's underline is a border on every tab), so selecting never moves a tab.
 *
 * The default slot is the panel for the selected tab (`{ value }`); leave it out
 * when the tabs only switch what the page below shows and the page owns that.
 *
 * Styling contract: tokens only.
 */
import UIcon from '@nuxt/ui/components/Icon.vue'
import { computed, nextTick, onBeforeUpdate, onMounted, ref, toRefs, toValue, useId, watch } from 'vue'

import { useReducedMotion } from '../composables/use-reduced-motion'
import { useRouteTab } from '../composables/use-route-tab'

import type { NeTabItem, NeTabsProps } from './ne-tabs-types'

const props = withDefaults(defineProps<NeTabsProps>(), {
  modelValue: undefined,
  routeParam: undefined,
  defaultValue: undefined,
  label: 'Tabs',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

defineSlots<{
  /** The selected tab's panel. Omit it when the page below owns the content. */
  default?(scope: { value: string }): unknown
}>()

const enabled = computed(() => props.items.filter((item) => !item.disabled))
const firstEnabled = computed(() => enabled.value[0]?.value ?? '')

// Route mode is decided once, at setup: the composable needs the router, and a
// strip that starts without `routeParam` never asks for one.
const { routeParam, defaultValue } = toRefs(props)
const startParam = toValue(routeParam)
const routed = startParam
  ? useRouteTab({
      tabs: () => enabled.value.map((item) => item.value),
      defaultTab: () => defaultValue.value,
      param: startParam,
    })
  : undefined

const local = ref<string | undefined>(toValue(defaultValue))

const active = computed<string>(() => {
  if (routed) return routed.tab.value
  const wanted = props.modelValue ?? local.value
  return enabled.value.some((item) => item.value === wanted)
    ? (wanted as string)
    : firstEnabled.value
})

function select(item: NeTabItem) {
  if (item.disabled || item.value === active.value) return
  if (routed) routed.tab.value = item.value
  else local.value = item.value
  emit('update:modelValue', item.value)
}

const base = useId()
const tabId = (index: number) => `${base}-tab-${index}`
const panelId = `${base}-panel`

const activeIndex = computed(() => props.items.findIndex((item) => item.value === active.value))

const list = ref<HTMLElement | null>(null)
const buttons = ref<HTMLElement[]>([])

// Refs for tabs that left `items` would linger; re-collect on each render.
onBeforeUpdate(() => {
  buttons.value.length = 0
})

function focusTab(index: number) {
  buttons.value[index]?.focus()
}

function onKeydown(event: KeyboardEvent, index: number) {
  const items = props.items
  if (!items.length) return
  let target = -1
  const step = (direction: 1 | -1) => {
    for (let hop = 1; hop <= items.length; hop += 1) {
      const candidate = (index + direction * hop + items.length * hop) % items.length
      if (!items[candidate]?.disabled) return candidate
    }
    return -1
  }
  if (event.key === 'ArrowRight') target = step(1)
  else if (event.key === 'ArrowLeft') target = step(-1)
  else if (event.key === 'Home') target = items.findIndex((item) => !item.disabled)
  else if (event.key === 'End') target = items.map((item) => !item.disabled).lastIndexOf(true)
  else return
  event.preventDefault()
  const item = items[target]
  if (!item || target === index) return
  select(item)
  focusTab(target)
}

const reduced = useReducedMotion()

/** Scroll the strip (not the page) so the active tab is centred where it overflows. */
function revealActive(smooth: boolean) {
  const strip = list.value
  const button = buttons.value[activeIndex.value]
  if (!strip || !button || strip.scrollWidth <= strip.clientWidth) return
  const left = button.offsetLeft - (strip.clientWidth - button.offsetWidth) / 2
  const behavior = smooth && !reduced.value ? 'smooth' : 'auto'
  if (typeof strip.scrollTo === 'function') strip.scrollTo({ left, behavior })
  else strip.scrollLeft = left
}

onMounted(() => revealActive(false))
watch(active, async () => {
  await nextTick()
  revealActive(true)
})
</script>

<template>
  <div class="ne-tabs">
    <div ref="list" class="ne-tabs__list" role="tablist" :aria-label="label">
      <button
        v-for="(item, index) in items"
        :id="tabId(index)"
        :key="item.value"
        :ref="
          (el) => {
            if (el) buttons[index] = el as HTMLElement
          }
        "
        type="button"
        role="tab"
        class="ne-tabs__tab ne-press"
        :aria-selected="item.value === active"
        :aria-controls="$slots.default && item.value === active ? panelId : undefined"
        :aria-disabled="item.disabled || undefined"
        :disabled="item.disabled"
        :tabindex="item.value === active ? 0 : -1"
        :data-state="item.value === active ? 'active' : 'inactive'"
        @click="select(item)"
        @keydown="onKeydown($event, index)"
      >
        <UIcon v-if="item.icon" :name="item.icon" class="ne-tabs__icon" aria-hidden="true" />
        <span class="ne-tabs__label">{{ item.label }}</span>
        <span v-if="item.badge !== undefined" class="ne-tabs__badge">{{ item.badge }}</span>
      </button>
    </div>
    <div
      v-if="$slots.default"
      :id="panelId"
      class="ne-tabs__panel"
      role="tabpanel"
      tabindex="0"
      :aria-labelledby="activeIndex >= 0 ? tabId(activeIndex) : undefined"
    >
      <slot :value="active" />
    </div>
  </div>
</template>

<style scoped>
.ne-tabs__list {
  position: relative;
  display: flex;
  gap: 0.25rem;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scrollbar-width: none;
  border-bottom: 1px solid var(--ne-hairline);
}

.ne-tabs__list::-webkit-scrollbar {
  display: none;
}

.ne-tabs__tab {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 0.375rem;
  min-height: 2.75rem;
  padding: 0 0.75rem;
  margin-bottom: -1px;
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  color: var(--ne-ink-muted);
  font: inherit;
  font-size: var(--ne-text-body);
  white-space: nowrap;
  cursor: pointer;
  transition:
    color var(--ne-feel-fast) var(--ne-ease-out),
    border-color var(--ne-feel-fast) var(--ne-ease-out);
}

.ne-tabs__tab:hover:not(:disabled) {
  color: var(--ne-ink);
}

.ne-tabs__tab[aria-selected='true'] {
  color: var(--ne-ink);
  border-bottom-color: var(--ne-accent);
}

.ne-tabs__tab:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.ne-tabs__tab:focus-visible,
.ne-tabs__panel:focus-visible {
  outline: 2px solid var(--ne-accent);
  outline-offset: 2px;
}

.ne-tabs__badge {
  min-width: 1.25rem;
  padding: 0 0.375rem;
  border-radius: var(--ne-radius-tag);
  background: var(--ne-surface-accented);
  color: var(--ne-ink-secondary);
  font-size: var(--ne-text-small);
  font-variant-numeric: tabular-nums;
  line-height: 1.25rem;
  text-align: center;
}

.ne-tabs__panel {
  padding-top: 1rem;
}
</style>
