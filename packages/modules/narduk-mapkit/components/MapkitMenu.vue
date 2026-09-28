<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef } from 'vue'
/**
 * Generic popover menu for the map chrome: a single-select list of
 * `menuitemradio` options with arrow-key navigation. Positioning is the
 * caller's job — pass `class`/`style` to place this absolutely-positioned
 * root against a `position: relative` anchor.
 */
interface MenuItem {
  checked: boolean
  count?: number | null
  key: string
  label: string
}

const props = defineProps<{
  items: MenuItem[]
  label: string
  note?: string
}>()

const emit = defineEmits<{
  close: []
  select: [key: string]
}>()

const rootRef = shallowRef<HTMLElement | null>(null)
const itemRefs = shallowRef<HTMLElement[]>([])

/** Unwraps a template ref to its DOM element, whether it targets a plain tag or a component. */
function elementOf(ref: unknown): HTMLElement | null {
  if (ref instanceof HTMLElement) return ref
  if (ref && typeof ref === 'object' && '$el' in ref) {
    const el = (ref as { $el: unknown }).$el
    return el instanceof HTMLElement ? el : null
  }
  return null
}

function setItemRef(el: unknown, index: number) {
  const node = elementOf(el)
  if (node) itemRefs.value[index] = node
}

function focusIndex(index: number) {
  const count = itemRefs.value.length
  if (count === 0) return
  const next = ((index % count) + count) % count
  itemRefs.value[next]?.focus()
}

function currentIndex(): number {
  if (typeof document === 'undefined') return -1
  return itemRefs.value.findIndex((el) => el === document.activeElement)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    focusIndex(currentIndex() + 1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    focusIndex(currentIndex() - 1)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
  }
}

function onPointerDown(event: PointerEvent) {
  if (rootRef.value && !rootRef.value.contains(event.target as Node)) emit('close')
}

let outsideTimer: ReturnType<typeof setTimeout> | undefined

onMounted(() => {
  const checkedIndex = props.items.findIndex((item) => item.checked)
  focusIndex(checkedIndex >= 0 ? checkedIndex : 0)
  // Defer so the pointerdown that opened this menu doesn't also close it.
  outsideTimer = setTimeout(() => {
    document.addEventListener('pointerdown', onPointerDown)
  }, 0)
})

onBeforeUnmount(() => {
  if (outsideTimer !== undefined) clearTimeout(outsideTimer)
  document.removeEventListener('pointerdown', onPointerDown)
})
</script>

<template>
  <div
    ref="rootRef"
    role="menu"
    :aria-label="label"
    tabindex="-1"
    class="menu"
    @keydown="onKeydown"
  >
    <span v-if="note" class="menu-note">{{ note }}</span>
    <button
      v-for="(item, index) in items"
      :key="item.key"
      :ref="(el) => setItemRef(el, index)"
      type="button"
      role="menuitemradio"
      :aria-checked="item.checked"
      class="menu-item"
      @click="emit('select', item.key)"
    >
      <span class="menu-item-check">
        <svg v-if="item.checked" aria-hidden="true" viewBox="0 0 24 24" class="check-icon">
          <path
            d="m20 6-11 11-5-5"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </span>
      <span class="menu-item-label">{{ item.label }}</span>
      <span v-if="typeof item.count === 'number'" class="menu-item-count">{{ item.count }}</span>
    </button>
  </div>
</template>

<style scoped>
.menu {
  position: absolute;
  z-index: var(--mk-z-popover, 50);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  padding: 6px;
  border-radius: var(--mk-radius-panel);
  background: var(--mk-surface);
  box-shadow: var(--mk-elev-3);
}

.menu-note {
  padding: 6px 10px 4px;
  font-size: 13px;
  line-height: 18px;
  color: var(--mk-ink-3);
}

.menu-item {
  display: flex;
  min-height: 44px;
  align-items: center;
  gap: 10px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--mk-radius-control);
  background: transparent;
  font-family: inherit;
  font-size: 15px;
  font-weight: 400;
  color: var(--mk-ink-strong);
  text-align: left;
  cursor: pointer;
}

.menu-item:hover {
  background: var(--mk-surface-hover);
}

.menu-item-check {
  display: flex;
  width: 18px;
  height: 18px;
  flex: none;
  color: var(--mk-accent);
}

.check-icon {
  width: 100%;
  height: 100%;
  display: block;
}

.menu-item-label {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.menu-item-count {
  margin-left: auto;
  padding-left: 16px;
  font-family: var(--mk-font-mono);
  font-size: 13px;
  color: var(--mk-ink-3);
}
</style>
