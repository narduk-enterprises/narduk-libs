<script setup lang="ts">
/**
 * NeCommandPalette — the shared "find anything" palette.
 *
 * One dialog, opened from a header button (`NeCommandPaletteTrigger`) or from
 * Cmd/Ctrl+K and "/" (`useCommandPaletteShortcuts`), that searches the groups
 * an app hands it: a fixed list (pages, states), a function of the query, or an
 * async provider (a search endpoint). Results are grouped, each row with an
 * icon, a title, a secondary line, a status badge and optional actions; the
 * arrow keys move, Enter goes, Cmd/Ctrl+Enter runs the row's first action.
 *
 * ## It is a native `<dialog>`
 *
 * `showModal()` gives what a hand-built overlay has to rebuild and usually gets
 * wrong: a focus trap, an inert page behind, Escape to close, the top layer
 * (no z-index war), and focus back on the opener. The dialog is named by
 * `title`. Inside, the input is an ARIA combobox that owns a listbox of
 * groups of options, with `aria-activedescendant` so focus never leaves the
 * input, and a polite live region that says how many results arrived.
 *
 * ## Providers
 *
 * A group's `search(query, { signal })` is called after `debounceMs` of quiet
 * and at least `minQuery` characters. Typing again aborts the call before, and
 * an answer for a query that is no longer current is dropped even if the
 * provider ignored the signal. The last answer stays on screen while the next
 * is out. A provider that fails is shown as unavailable, never as an empty
 * group, so a gap is not read as "nothing matched". Several groups answered by
 * one request share it with `createSharedSearch`.
 *
 * ## Phone
 *
 * Under 640px (or a short landscape screen) the dialog is a full-screen sheet:
 * a 16px input so iOS does not zoom, a Cancel button, 48px rows, no keyboard
 * hints, and a height that follows the visual viewport so the on-screen
 * keyboard never covers the last row.
 *
 * ## Styling contract
 *
 * Tokens only (`--ne-*`): an app that loads the shell theme gets the look for
 * free, one that does not defines the few it uses (surface, ink, hairline,
 * accent, radius) on `:root`.
 */
import UIcon from '@nuxt/ui/components/Icon.vue'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, useId, watch } from 'vue'
import { useRouter } from 'vue-router'

import { useCommandPalette } from '../composables/use-command-palette'
import {
  buildSections,
  createSearchRunner,
  flattenRows,
  highlightParts,
  moveActive,
  pageActive,
  rememberRecent,
  resultSummary,
  sanitizeRecents,
  toRecent,
} from '../utils/command-palette'

import type {
  NeCommandAction,
  NeCommandGroupState,
  NeCommandPaletteProps,
  NeCommandRecent,
  NeCommandRow,
  NeCommandSelection,
} from './ne-command-palette-types'

const props = withDefaults(defineProps<NeCommandPaletteProps>(), {
  emptyDescription: 'Check the spelling or try fewer words.',
  emptyTitle: 'No results',
  idleHint: 'Start typing to search.',
  inputLabel: undefined,
  maxRecents: 6,
  navigate: undefined,
  placeholder: 'Search',
  recentLabel: 'Recent',
  recentsKey: 'ne-command-palette:recents',
  title: 'Search',
})

const emit = defineEmits<{
  close: []
  open: []
  select: [selection: NeCommandSelection]
}>()

const palette = useCommandPalette()
const router = useRouter()
const uid = useId()

const dialog = ref<HTMLDialogElement>()
const input = ref<HTMLInputElement>()
const list = ref<HTMLElement>()
const query = ref('')
const activeKey = ref<string | null>(null)
const recents = ref<NeCommandRecent[]>([])
const providers = reactive<Record<string, NeCommandGroupState>>({})
const modKey = ref('Ctrl')

const runner = createSearchRunner({
  groups: () => props.groups,
  onState(groupId, state) {
    providers[groupId] = state
  },
})

const sections = computed(() =>
  buildSections({
    groups: props.groups,
    providers,
    query: query.value,
    recentLabel: props.recentLabel,
    recents: recents.value,
  }),
)
const rows = computed(() => flattenRows(sections.value))
const hasQuery = computed(() => query.value.trim().length > 0)

/** The active row: the one the keys or the pointer chose, else the top hit. */
const activeIndex = computed(() => {
  const at = rows.value.findIndex((row) => row.key === activeKey.value)
  if (at >= 0) return at
  return rows.value.length > 0 ? 0 : -1
})
const activeRow = computed<NeCommandRow | undefined>(() => rows.value[activeIndex.value])
const firstAction = computed(() => activeRow.value?.item.actions?.[0])

/** Sections worth drawing: a provider that is only loading, with nothing yet, draws nothing. */
const visibleSections = computed(() =>
  sections.value.filter((section) => section.rows.length > 0 || section.status === 'error'),
)
const loading = computed(() => sections.value.some((section) => section.status === 'loading'))
const failed = computed(() => sections.value.some((section) => section.status === 'error'))
const showEmpty = computed(
  () => hasQuery.value && rows.value.length === 0 && !loading.value && !failed.value,
)
const showIdle = computed(() => !hasQuery.value && rows.value.length === 0)

const announcement = computed(() =>
  loading.value ? '' : resultSummary(sections.value, query.value),
)

const listboxId = computed(() => `${uid}-listbox`)
const optionId = (row: NeCommandRow) => `${uid}-opt-${row.index}`
const headingId = (sectionId: string) => `${uid}-h-${sectionId}`

function parts(text: string) {
  return highlightParts(text, query.value)
}

// ---------------------------------------------------------------- recents

function readRecents(): NeCommandRecent[] {
  if (props.maxRecents <= 0 || !import.meta.client) return []
  try {
    const raw = window.localStorage.getItem(props.recentsKey)
    return raw ? sanitizeRecents(JSON.parse(raw), props.maxRecents) : []
  } catch {
    return []
  }
}

function writeRecents(next: NeCommandRecent[]) {
  recents.value = next
  if (!import.meta.client) return
  try {
    window.localStorage.setItem(props.recentsKey, JSON.stringify(next))
  } catch {
    // Private mode or a full store: recents are a convenience, not state.
  }
}

// ----------------------------------------------------------------- opening

function prepare() {
  query.value = ''
  activeKey.value = null
  for (const key of Object.keys(providers)) delete providers[key]
  recents.value = readRecents()
  runner.run('')
  const platform = typeof navigator === 'undefined' ? '' : navigator.platform || navigator.userAgent
  modKey.value = /mac|iphone|ipad|ipod/i.test(platform) ? '⌘' : 'Ctrl'
  fitViewport()
}

/** On a phone the sheet is as tall as what the keyboard leaves. */
function fitViewport() {
  const viewport = typeof window === 'undefined' ? undefined : window.visualViewport
  if (!viewport || !dialog.value) return
  dialog.value.style.setProperty('--ne-cmd-vvh', `${Math.round(viewport.height)}px`)
}

function show() {
  const element = dialog.value
  if (!element || element.open) return
  prepare()
  if (typeof element.showModal === 'function') element.showModal()
  else element.setAttribute('open', '')
  emit('open')
  void nextTick(() => input.value?.focus())
}

function hide() {
  const element = dialog.value
  if (!element?.open) return
  if (typeof element.close === 'function') element.close()
  else element.removeAttribute('open')
}

/** The `close` event: Escape, a backdrop click, `hide()` or a form method. */
function onClosed() {
  runner.reset()
  palette.close()
  emit('close')
}

function onDialogClick(event: MouseEvent) {
  // The dialog has no padding, so a click that lands on the dialog itself is
  // a click on its backdrop.
  if (event.target === dialog.value) palette.close()
}

watch(
  () => palette.isOpen.value,
  (open) => (open ? show() : hide()),
  { flush: 'post' },
)

onMounted(() => {
  if (palette.isOpen.value) show()
  window.visualViewport?.addEventListener('resize', fitViewport)
})

onBeforeUnmount(() => {
  runner.reset()
  window.visualViewport?.removeEventListener('resize', fitViewport)
  if (dialog.value?.open) hide()
})

// ------------------------------------------------------------------ typing

function onInput(event: Event) {
  query.value = (event.target as HTMLInputElement).value
  activeKey.value = null
  runner.run(query.value)
}

function setActive(index: number) {
  const row = rows.value[index]
  if (!row) return
  activeKey.value = row.key
  void nextTick(() => {
    const element = list.value?.querySelector<HTMLElement>(`[data-row-index="${index}"]`)
    element?.scrollIntoView({ block: 'nearest' })
  })
}

function onKeydown(event: KeyboardEvent) {
  if (event.isComposing) return
  const total = rows.value.length
  const key = event.key
  if (key === 'ArrowDown' || (event.ctrlKey && key.toLowerCase() === 'n')) {
    event.preventDefault()
    setActive(moveActive(activeIndex.value, 1, total))
  } else if (key === 'ArrowUp' || (event.ctrlKey && key.toLowerCase() === 'p')) {
    event.preventDefault()
    setActive(moveActive(activeIndex.value, -1, total))
  } else if (key === 'PageDown') {
    event.preventDefault()
    setActive(pageActive(activeIndex.value, 5, total))
  } else if (key === 'PageUp') {
    event.preventDefault()
    setActive(pageActive(activeIndex.value, -5, total))
  } else if (key === 'Enter') {
    event.preventDefault()
    const row = activeRow.value
    if (!row) return
    if (event.metaKey || event.ctrlKey) {
      const action = row.item.actions?.[0]
      if (action) void choose(row, action)
    } else {
      void choose(row)
    }
  }
}

// --------------------------------------------------------------- choosing

function isAbsolute(to: string) {
  return /^[a-z][a-z\d+.-]*:/i.test(to) || to.startsWith('//')
}

async function go(to: string) {
  if (props.navigate) {
    await props.navigate(to)
    return
  }
  if (isAbsolute(to)) {
    if (import.meta.client) window.location.assign(to)
    return
  }
  await router.push(to)
}

async function choose(row: NeCommandRow, action?: NeCommandAction) {
  const group = props.groups.find((candidate) => candidate.id === row.groupId)
  if (group?.recent !== false && props.maxRecents > 0) {
    writeRecents(rememberRecent(recents.value, toRecent(row.groupId, row.item), props.maxRecents))
  }
  emit('select', { action, groupId: row.groupId, item: row.item })
  const target = action ? action.to : row.item.to
  palette.close()
  if (target) await go(target)
}

const actionHint = computed(() =>
  firstAction.value
    ? `Press Enter to open. Press ${modKey.value === '⌘' ? 'Command' : 'Control'} Enter to ${firstAction.value.label}.`
    : 'Press Enter to open.',
)
</script>

<template>
  <dialog
    ref="dialog"
    class="ne-cmd"
    data-ne-command-palette
    :aria-label="title"
    @click="onDialogClick"
    @close="onClosed"
  >
    <div class="ne-cmd__panel">
      <div class="ne-cmd__head">
        <UIcon name="i-lucide-search" class="ne-cmd__lead" aria-hidden="true" />
        <input
          ref="input"
          class="ne-cmd__input"
          data-ne-command-input
          type="text"
          role="combobox"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          enterkeyhint="go"
          aria-autocomplete="list"
          aria-expanded="true"
          :aria-label="inputLabel ?? title"
          :aria-controls="listboxId"
          :aria-activedescendant="activeRow ? optionId(activeRow) : undefined"
          :aria-describedby="`${uid}-hint`"
          :placeholder="placeholder"
          :value="query"
          @input="onInput"
          @keydown="onKeydown"
        />
        <span v-if="loading" class="ne-cmd__spinner" aria-hidden="true" />
        <button type="button" class="ne-cmd__close" @click="palette.close()">
          <span class="ne-cmd__close-phone">Cancel</span>
          <kbd class="ne-cmd__close-key" aria-hidden="true">esc</kbd>
          <span class="ne-cmd__sr">Close search</span>
        </button>
      </div>

      <p :id="`${uid}-hint`" class="ne-cmd__sr">{{ actionHint }}</p>
      <p class="ne-cmd__sr" role="status" aria-live="polite">{{ announcement }}</p>

      <div
        :id="listboxId"
        ref="list"
        class="ne-cmd__body"
        role="listbox"
        :aria-label="`${title} results`"
        :aria-busy="loading ? 'true' : undefined"
      >
        <div
          v-for="section in visibleSections"
          :key="section.id"
          class="ne-cmd__section"
          role="group"
          :aria-labelledby="headingId(section.id)"
        >
          <div :id="headingId(section.id)" class="ne-cmd__heading">{{ section.label }}</div>
          <p v-if="section.status === 'error'" class="ne-cmd__note" data-ne-command-error>
            {{ section.label }} could not be loaded just now. This is not the same as no matches.
          </p>
          <div
            v-for="row in section.rows"
            :id="optionId(row)"
            :key="row.key"
            class="ne-cmd__row"
            :class="{ 'is-active': row.index === activeIndex }"
            role="option"
            :aria-selected="row.index === activeIndex"
            data-ne-command-row
            :data-row-index="row.index"
            @mousemove="activeKey !== row.key && (activeKey = row.key)"
            @click="choose(row)"
          >
            <UIcon
              v-if="row.item.icon"
              :name="row.item.icon"
              class="ne-cmd__icon"
              aria-hidden="true"
            />
            <span class="ne-cmd__text">
              <span class="ne-cmd__label">
                <template v-for="(part, i) in parts(row.item.label)" :key="i">
                  <mark v-if="part.hit" class="ne-cmd__hit">{{ part.text }}</mark>
                  <template v-else>{{ part.text }}</template>
                </template>
              </span>
              <span v-if="row.item.description" class="ne-cmd__desc">
                <template v-for="(part, i) in parts(row.item.description)" :key="i">
                  <mark v-if="part.hit" class="ne-cmd__hit">{{ part.text }}</mark>
                  <template v-else>{{ part.text }}</template>
                </template>
              </span>
            </span>
            <span
              v-if="row.item.badge"
              class="ne-cmd__badge"
              :data-tone="row.item.badge.tone ?? 'neutral'"
            >
              <span
                class="ne-cmd__dot"
                aria-hidden="true"
                :style="
                  row.item.badge.color ? { backgroundColor: row.item.badge.color } : undefined
                "
              />
              {{ row.item.badge.label }}
            </span>
            <span v-if="row.item.actions?.length" class="ne-cmd__actions" aria-hidden="true">
              <span
                v-for="action in row.item.actions"
                :key="action.id"
                class="ne-cmd__action"
                data-ne-command-action
                :data-icon="action.icon ? '' : undefined"
                @click.stop="choose(row, action)"
              >
                <UIcon v-if="action.icon" :name="action.icon" aria-hidden="true" />
                <span class="ne-cmd__action-label">{{ action.label }}</span>
              </span>
            </span>
          </div>
        </div>

        <div v-if="showEmpty" class="ne-cmd__empty" data-ne-command-empty>
          <UIcon name="i-lucide-search-x" class="ne-cmd__empty-icon" aria-hidden="true" />
          <slot name="empty" :query="query.trim()">
            <p class="ne-cmd__empty-title">{{ emptyTitle }} for “{{ query.trim() }}”</p>
            <p class="ne-cmd__empty-text">{{ emptyDescription }}</p>
          </slot>
        </div>
        <p v-else-if="showIdle" class="ne-cmd__idle">{{ idleHint }}</p>
      </div>

      <div class="ne-cmd__foot" aria-hidden="true">
        <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
        <span><kbd>↵</kbd> open</span>
        <span v-if="firstAction"
          ><kbd>{{ modKey }}</kbd
          ><kbd>↵</kbd> {{ firstAction.label }}</span
        >
        <span><kbd>esc</kbd> close</span>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
/*
 * Tokens only (README § Styling contract). A dialog sits in the top layer, so
 * it needs no z-index; margin and inset place it, and the backdrop is the
 * dialog's own pseudo-element.
 */
.ne-cmd {
  width: min(40rem, calc(100vw - 2rem));
  max-width: none;
  max-height: none;
  margin: 12vh auto auto;
  padding: 0;
  border: 1px solid var(--ne-hairline);
  --ne-cmd-radius: var(--ne-radius-panel);
  border-radius: var(--ne-cmd-radius);
  background: var(--ne-surface);
  color: var(--ne-ink-body);
  box-shadow: var(--ne-shadow-2);
  font-family: var(--ne-font-sans);
  overflow: hidden;
}

.ne-cmd::backdrop {
  background: color-mix(in srgb, var(--ne-ink) 45%, transparent);
}

.ne-cmd[open] {
  animation: ne-cmd-in 120ms ease-out;
}

@keyframes ne-cmd-in {
  from {
    opacity: 0;
    transform: translateY(-6px) scale(0.99);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ne-cmd[open] {
    animation: none;
  }
}

:global(html:has(dialog.ne-cmd[open])) {
  overflow: hidden;
}

.ne-cmd__panel {
  display: flex;
  max-height: min(34rem, 76vh);
  flex-direction: column;
}

.ne-cmd__head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--ne-divider);
}

.ne-cmd__lead {
  flex: none;
  color: var(--ne-ink-muted);
}

.ne-cmd__input {
  min-width: 0;
  flex: 1;
  border: 0;
  padding: 0.25rem 0;
  background: transparent;
  color: var(--ne-ink);
  font: inherit;
  font-size: 1.0625rem;
  outline: none;
}

.ne-cmd__input::placeholder {
  color: var(--ne-ink-muted);
}

.ne-cmd__input::-webkit-search-cancel-button {
  display: none;
}

.ne-cmd__close {
  flex: none;
  border: 0;
  background: transparent;
  color: var(--ne-ink-muted);
  cursor: pointer;
  font: inherit;
}

.ne-cmd__close-phone {
  display: none;
}

.ne-cmd__close-key,
.ne-cmd__foot kbd {
  padding: 0.0625rem 0.375rem;
  border: 1px solid var(--ne-line-strong);
  border-radius: var(--ne-radius-base);
  background: var(--ne-surface-muted);
  color: var(--ne-ink-muted);
  font-family: var(--ne-font-mono);
  font-size: 0.6875rem;
}

.ne-cmd__spinner {
  width: 1rem;
  height: 1rem;
  flex: none;
  border: 2px solid var(--ne-line-strong);
  border-top-color: var(--ne-accent);
  border-radius: var(--ne-radius-tag);
  animation: ne-cmd-spin 700ms linear infinite;
}

@keyframes ne-cmd-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ne-cmd__spinner {
    animation-duration: 2s;
  }
}

.ne-cmd__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  border: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.ne-cmd__body {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0.25rem 0.5rem 0.5rem;
}

.ne-cmd__heading {
  padding: 0.625rem 0.5rem 0.25rem;
  color: var(--ne-ink-muted);
  font-size: var(--ne-text-label);
  letter-spacing: var(--ne-tracking-label);
  text-transform: uppercase;
}

.ne-cmd__note {
  margin: 0;
  padding: 0.25rem 0.5rem 0.5rem;
  color: var(--ne-ink-secondary);
  font-size: var(--ne-text-small);
}

.ne-cmd__row {
  display: flex;
  min-height: 2.75rem;
  align-items: center;
  gap: 0.75rem;
  padding: 0.375rem 0.5rem;
  border-radius: var(--ne-radius-control);
  cursor: pointer;
}

.ne-cmd__row.is-active {
  background: var(--ne-accent-soft);
}

.ne-cmd__icon {
  flex: none;
  color: var(--ne-ink-muted);
}

.ne-cmd__row.is-active .ne-cmd__icon {
  color: var(--ne-accent);
}

.ne-cmd__text {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}

.ne-cmd__label {
  overflow: hidden;
  color: var(--ne-ink);
  font-size: var(--ne-text-body);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ne-cmd__desc {
  overflow: hidden;
  color: var(--ne-ink-muted);
  font-size: var(--ne-text-small);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ne-cmd__hit {
  background: transparent;
  color: var(--ne-accent);
  font-weight: 600;
}

.ne-cmd__badge {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 0.375rem;
  color: var(--ne-ink-secondary);
  font-size: var(--ne-text-small);
}

.ne-cmd__dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: var(--ne-radius-tag);
  background: var(--ne-ink-dimmed);
}

.ne-cmd__badge[data-tone='success'] .ne-cmd__dot {
  background: var(--ui-success);
}

.ne-cmd__badge[data-tone='warning'] .ne-cmd__dot {
  background: var(--ui-warning);
}

.ne-cmd__badge[data-tone='danger'] .ne-cmd__dot {
  background: var(--ui-error);
}

.ne-cmd__badge[data-tone='info'] .ne-cmd__dot {
  background: var(--ne-accent);
}

.ne-cmd__actions {
  display: inline-flex;
  flex: none;
  gap: 0.375rem;
}

.ne-cmd__action {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.125rem 0.5rem;
  border: 1px solid var(--ne-line-strong);
  border-radius: var(--ne-radius-tag);
  background: var(--ne-surface);
  color: var(--ne-ink-secondary);
  font-size: var(--ne-text-small);
}

.ne-cmd__action:hover {
  border-color: var(--ne-accent);
  color: var(--ne-accent);
}

.ne-cmd__empty,
.ne-cmd__idle {
  margin: 0;
  padding: 2rem 1rem;
  color: var(--ne-ink-muted);
  text-align: center;
}

.ne-cmd__empty-icon {
  margin-bottom: 0.5rem;
}

.ne-cmd__empty-title {
  margin: 0;
  color: var(--ne-ink);
  font-size: var(--ne-text-body);
}

.ne-cmd__empty-text {
  margin: 0.25rem 0 0;
  font-size: var(--ne-text-small);
}

.ne-cmd__foot {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  padding: 0.5rem 1rem;
  border-top: 1px solid var(--ne-divider);
  background: var(--ne-surface-muted);
  color: var(--ne-ink-muted);
  font-size: var(--ne-text-small);
}

.ne-cmd__foot kbd {
  margin-right: 0.25rem;
}

/* Touch: no keyboard hints, since there is no keyboard to hint at. */
@media (hover: none) and (pointer: coarse) {
  .ne-cmd__foot,
  .ne-cmd__close-key {
    display: none;
  }

  .ne-cmd__close-phone {
    display: inline;
  }
}

/* The phone sheet: the whole screen, as tall as the keyboard leaves. */
@media (width < 640px), (height < 480px) {
  .ne-cmd {
    width: 100%;
    height: var(--ne-cmd-vvh, 100dvh);
    margin: 0;
    --ne-cmd-radius: 0;
    border: 0;
    inset: 0 auto auto 0;
  }

  .ne-cmd__panel {
    height: 100%;
    max-height: none;
    padding-bottom: env(safe-area-inset-bottom);
  }

  .ne-cmd__head {
    padding: calc(0.5rem + env(safe-area-inset-top)) 0.75rem 0.5rem;
  }

  .ne-cmd__input {
    font-size: 1rem;
  }

  .ne-cmd__close {
    min-height: 2.75rem;
    padding: 0 0.25rem;
    color: var(--ne-accent);
  }

  .ne-cmd__close-phone {
    display: inline;
  }

  .ne-cmd__close-key,
  .ne-cmd__foot {
    display: none;
  }

  .ne-cmd__row {
    min-height: 3rem;
  }

  /* A row's action is its own tap target, reduced to its icon. */
  .ne-cmd__action {
    min-width: 2.75rem;
    min-height: 2.75rem;
    justify-content: center;
    padding: 0;
  }

  .ne-cmd__action[data-icon] .ne-cmd__action-label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
}
</style>
