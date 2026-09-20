<script setup lang="ts">
/**
 * NeFilterBar — the filter row above a collection (narduk-libs#261), promoted
 * from operator-portal's `app/components/shared/FilterBar.vue`, where nine
 * pages had each hand-assembled the row with its own pressed logic, its own
 * count and its own disabled treatment. The pressed-chip count inversion was
 * carried nine times and fixed nine times. It is carried once, here.
 *
 * Three kinds, one DOM shape — a wrapping row of buttons in the order the
 * caller gives them, nothing sorted and nothing hidden:
 *
 *   - `chips`  — a toggle row. `aria-pressed` carries the selection.
 *   - `facets` — the same row, read as scopes rather than toggles.
 *   - `tabs`   — a real `tablist`: `aria-selected`, roving tabindex, arrows
 *     that wrap, Home and End to the ends (WAI-ARIA APG). The caller's panels
 *     name the tab that controls them through `idPrefix`
 *     (`<prefix>-tab-<key>` / `<prefix>-panel-<key>`).
 *
 * ## A filter with no producer stays in the row
 *
 * `item.disabled` renders `aria-disabled` and keeps the control visible. That
 * is deliberate and it is the whole reason this component has an opinion:
 * dropping a filter whose rows do not exist yet makes the product look
 * finished and silently narrower than it claims. The control stays, the row's
 * `note` says when it lands, and nobody has to guess whether a missing filter
 * is missing or merely unbuilt.
 *
 * `aria-disabled` rather than the `disabled` attribute, on purpose: a disabled
 * button leaves the tab order, so a keyboard user cannot reach it to read the
 * reason in its `title`. The click handler refuses instead.
 *
 * ## A count is the caller's figure
 *
 * `item.count` is rendered, never derived. The component cannot know what the
 * control filters, and a count computed here would eventually disagree with
 * the group heading computed where the rows are. Omit the count rather than
 * passing `0` for "not counted" — see `NeFilterBarItem`.
 *
 * ## What this does not own
 *
 * The search field, and the refresh or close controls that borrow a chip's
 * shape. A search is a text control beside the row, not a member of it, and a
 * refresh is an action rather than a filter. `NeSearchInput` is the other half
 * of #261 and ships separately.
 */
import UButton from '@nuxt/ui/components/Button.vue'
import { computed, nextTick, ref } from 'vue'

import type { NeFilterBarItem, NeFilterBarProps } from './ne-filter-bar-types'

const props = withDefaults(defineProps<NeFilterBarProps>(), {
  flush: false,
  idPrefix: 'filter',
  kind: 'chips',
  modelValue: null,
  note: undefined,
})

const emit = defineEmits<{ 'update:modelValue': [key: string] }>()

defineSlots<{ after?: () => unknown }>()

const isTabs = computed(() => props.kind === 'tabs')

function selected(item: NeFilterBarItem): boolean {
  return props.modelValue === item.key
}

function attrsOf(item: NeFilterBarItem): Record<string, string> {
  const resolved: Record<string, string> = {}
  for (const [name, value] of Object.entries(item.attrs ?? {})) {
    if (value !== undefined) resolved[name] = value
  }
  return resolved
}

/**
 * Selection is a colour change, never a size change: a row whose controls
 * resize as you click them reflows the ones beside it.
 */
function colorOf(item: NeFilterBarItem) {
  return selected(item) ? 'primary' : 'neutral'
}

function variantOf(item: NeFilterBarItem) {
  if (selected(item)) return 'solid'
  return props.kind === 'facets' ? 'subtle' : 'outline'
}

function choose(item: NeFilterBarItem): void {
  if (item.disabled) return
  emit('update:modelValue', item.key)
}

/* ── tabs: the APG tablist keyboard model ─────────────────────────────────── */

const controls = ref<HTMLButtonElement[]>([])

/**
 * `UButton` is a component, so a template ref yields its instance; the roving
 * focus needs the element under it. A plain element is passed through for the
 * case where the wrapped primitive stops being a component.
 */
function setControl(index: number) {
  return (element: unknown) => {
    if (!element) return
    const instance = element as { $el?: HTMLButtonElement }
    controls.value[index] = (instance.$el ?? element) as HTMLButtonElement
  }
}

function tabId(item: NeFilterBarItem): string {
  return `${props.idPrefix}-tab-${item.key}`
}

function panelId(item: NeFilterBarItem): string {
  return `${props.idPrefix}-panel-${item.key}`
}

/**
 * One tab in the page's tab order at a time: the selected one, or the first
 * when nothing is selected. Arrow keys move within the row from there.
 */
function tabIndexOf(item: NeFilterBarItem, index: number): number | undefined {
  if (!isTabs.value) return undefined
  const selectedIndex = props.items.findIndex((candidate) => selected(candidate))
  return (selectedIndex === -1 ? index === 0 : selected(item)) ? 0 : -1
}

function onTabKey(event: KeyboardEvent, index: number): void {
  if (!isTabs.value) return
  const last = props.items.length - 1
  let next: number | null = null
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = index === last ? 0 : index + 1
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
    next = index === 0 ? last : index - 1
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = last
  if (next === null) return
  event.preventDefault()
  const item = props.items[next]
  if (!item) return
  choose(item)
  const target = next
  void nextTick(() => controls.value[target]?.focus())
}
</script>

<template>
  <div
    data-ne-filter-bar
    :data-ne-filter-kind="kind"
    class="flex flex-wrap items-center gap-2"
    :class="flush ? undefined : 'mt-2'"
    :role="isTabs ? 'tablist' : 'group'"
    :aria-label="label"
  >
    <UButton
      v-for="(item, index) in items"
      :id="isTabs ? tabId(item) : undefined"
      :key="item.key"
      :ref="setControl(index)"
      type="button"
      size="xs"
      :color="colorOf(item)"
      :variant="variantOf(item)"
      :class="item.disabled ? 'opacity-50' : undefined"
      data-ne-filter-control
      :data-ne-filter-key="item.key"
      :role="isTabs ? 'tab' : undefined"
      :aria-pressed="isTabs || item.disabled ? undefined : selected(item)"
      :aria-selected="isTabs ? selected(item) : undefined"
      :aria-controls="isTabs ? panelId(item) : undefined"
      :aria-disabled="item.disabled ? 'true' : undefined"
      :tabindex="tabIndexOf(item, index)"
      :title="item.title"
      :data-testid="item.testid"
      v-bind="attrsOf(item)"
      @click="choose(item)"
      @keydown="onTabKey($event, index)"
    >
      <span>{{ item.label }}</span>
      <span
        v-if="item.count !== undefined"
        data-ne-filter-count
        class="text-xs font-medium opacity-70"
        >{{ item.count }}</span
      >
    </UButton>
    <span v-if="note" data-ne-filter-note class="text-xs text-muted">{{ note }}</span>
    <slot name="after" />
  </div>
</template>
