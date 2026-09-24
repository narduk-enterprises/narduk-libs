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
 * THAT REACHABILITY CLAIM HOLDS FOR `chips` AND `facets` ONLY. APG omits
 * disabled tabs from a tablist's roving model and `nextEnabled` duly skips
 * them, so under `kind: 'tabs'` no arrow key ever lands on one and `title` is
 * mouse-only there — the paragraph above would otherwise be quietly false for
 * a third of this component's surface. A disabled tab is pointed at the row's
 * own `note` with `aria-describedby` instead, which a screen reader announces
 * in browse mode whether or not focus can arrive. A tabs row with no `note`
 * gives a disabled tab no reason at all, so write one.
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
 * of #261.
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
 *
 * A DISABLED ITEM CAN STILL BE THE SELECTED ONE. A URL-synced page can arrive
 * with `modelValue` on a key whose producer is missing, and the chip then
 * paints as selected while being unpressable. That is honest — it is the
 * current filter — so `aria-pressed` is kept for exactly that case in the
 * template rather than suppressed with the rest of the disabled set; otherwise
 * a sighted user would see a selected chip and a screen reader would hear a
 * disabled button with no pressed state, which is two different answers to
 * "what is this list filtered by". An unselected disabled chip still carries
 * no `aria-pressed`: it is a filter nothing can answer, not an untoggled one.
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
 * The row note, named so a disabled tab can point at it. Shares `idPrefix`
 * with the tab and panel ids for the same reason they share it: two bars on
 * one page collide unless the caller distinguishes them, and the README says
 * so once rather than this file saying it three times.
 */
const noteId = computed(() => `${props.idPrefix}-note`)

/**
 * One tab in the page's tab order at a time: the selected one, or the first
 * when nothing is selected. Arrow keys move within the row from there.
 */
function tabIndexOf(item: NeFilterBarItem, index: number): number | undefined {
  if (!isTabs.value) return undefined
  const selectedIndex = props.items.findIndex((candidate) => selected(candidate))
  return (selectedIndex === -1 ? index === 0 : selected(item)) ? 0 : -1
}

/**
 * The next enabled tab in `step` direction, wrapping, or `null` when the row
 * holds none. APG omits disabled tabs from the roving model entirely: an arrow
 * key that lands on one would move focus without moving selection, because
 * `choose` refuses a disabled item — so `aria-selected` would stay behind on
 * the tab the user left, and the next Tab key would exit the list from a
 * control the tablist does not consider current.
 *
 * `count` bounds the walk at one lap, which is what makes an all-disabled row
 * terminate rather than spin.
 */
function nextEnabled(from: number, step: number): number | null {
  const count = props.items.length
  for (let moved = 1; moved <= count; moved += 1) {
    const candidate = (((from + step * moved) % count) + count) % count
    if (!props.items[candidate]?.disabled) return candidate
  }
  return null
}

/**
 * The first enabled tab at or after `from`, walking in `step` direction. The
 * end itself is the answer whenever it is enabled — `disabled` is optional, so
 * the test is its falsiness, never `=== false`, which would read every item
 * that simply omits the key as disabled.
 */
function firstEnabled(from: number, step: number): number | null {
  const item = props.items[from]
  return item && !item.disabled ? from : nextEnabled(from, step)
}

function onTabKey(event: KeyboardEvent, index: number): void {
  if (!isTabs.value) return
  const last = props.items.length - 1
  let next: number | null = null
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = nextEnabled(index, 1)
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = nextEnabled(index, -1)
  else if (event.key === 'Home') next = firstEnabled(0, 1)
  else if (event.key === 'End') next = firstEnabled(last, -1)
  else return
  // The key is one this tablist owns, so the page must not also scroll on it —
  // including when every tab is disabled and selection stays where it is.
  event.preventDefault()
  if (next === null) return
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
  >
    <!--
      THE ROLE SITS ON THE CONTROL ROW, NOT ON THE OUTER WRAPPER. A tablist's
      required owned elements are tabs; `note` is a caption and the `after`
      slot is an action — this component's own header says a refresh is not a
      member of the row — so neither may be owned by the tablist. Both are
      siblings of it. `group` moves with it so one selector, one assertion and
      one mental model cover all three kinds.
    -->
    <div
      data-ne-filter-controls
      class="flex flex-wrap items-center gap-2"
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
        :aria-pressed="isTabs || (item.disabled && !selected(item)) ? undefined : selected(item)"
        :aria-selected="isTabs ? selected(item) : undefined"
        :aria-controls="isTabs ? panelId(item) : undefined"
        :aria-disabled="item.disabled ? 'true' : undefined"
        :aria-describedby="item.disabled && note ? noteId : undefined"
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
    </div>
    <span v-if="note" :id="noteId" data-ne-filter-note class="text-xs text-muted">{{ note }}</span>
    <slot name="after" />
  </div>
</template>
