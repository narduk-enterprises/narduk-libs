<script setup lang="ts">
/*
 * One preview surface, alone in its own document: the interactive demo, the
 * package-owned design card, or the live usage example. The component page
 * embeds this route in a same-origin iframe sized to the viewport preset, so
 * the preset is this document's real viewport and media queries follow it.
 *
 * The frame owns only what it draws. It never navigates or rewrites its own
 * URL (an iframe navigation would join the page's history); state arrives as
 * `explorer:query` and leaves as `explorer:state`, and the page owns the URL.
 * Opened directly, the frame applies its own query, so a frame link works.
 */
import {
  demoPart,
  parseSurface,
  readToFrame,
  type ColorScheme,
  type FromFrame,
  type Surface,
} from '../../../../demo/frame.mts'

definePageMeta({ layout: 'frame' })

const route = useRoute()
const { examples } = useInventory()
const example = examples.find((entry) => entry.id === route.params.id)
const surface = parseSurface(typeof route.params.surface === 'string' ? route.params.surface : null)
const component = !example
  ? null
  : surface === 'demo' && example.interactive
    ? interactiveComponent(example.id)
    : surface === 'card' && example.card
      ? cardComponent(example.card)
      : surface === 'usage'
        ? usageComponent(example.id)
        : null
if (!example || !surface || !component) {
  throw createError({ statusCode: 404, statusMessage: 'No such preview', fatal: true })
}
const shown: Surface = surface

useSeoMeta({ title: `${example.title} (${shown}) — preview frame` })
useHead({ meta: [{ name: 'robots', content: 'noindex' }] })

// Applied after mount only: the prerendered HTML is the default state, and a
// deep-link query must not make the hydrated DOM disagree with it.
const query = ref<Record<string, string>>({})
const embedded = ref(false)
/*
 * Ready once the frame shows what the page asked for: opened directly, on
 * mount; embedded, when the page's first message (the demo's query, or the
 * theme for the other surfaces) has been applied. Before that a control change
 * could be overwritten by the page's first query.
 */
const ready = ref(false)

function post(message: FromFrame) {
  if (embedded.value) window.parent.postMessage(message, window.location.origin)
}

function applyScheme(scheme: ColorScheme) {
  // The class only: the page's stored colour preference is never rewritten.
  const root = document.documentElement
  root.classList.toggle('dark', scheme === 'dark')
  root.classList.toggle('light', scheme === 'light')
  root.style.colorScheme = scheme
}

function onState(next: Record<string, string>) {
  query.value = next
  post({ type: 'explorer:state', surface: shown, cause: 'user', query: next })
}

function onEvent(name: string, detail: unknown) {
  post({
    type: 'explorer:event',
    surface: shown,
    name,
    detail: JSON.parse(JSON.stringify(detail ?? null)),
  })
}

/*
 * A demo reports the canonical form of every query it is given (`canonical`),
 * because only the demo knows its parameters. A query from the page is owed
 * one `sync` answer, sent when the demo has rendered it; that also covers a
 * demo that is still loading when the page's first query arrives.
 */
let owesSync = false
function onCanonical(next: Record<string, string>) {
  if (!owesSync) return
  owesSync = false
  post({ type: 'explorer:state', surface: shown, cause: 'sync', query: next })
}

function onMessage(event: MessageEvent) {
  if (event.origin !== window.location.origin || event.source !== window.parent) return
  const message = readToFrame(event.data)
  if (!message) return
  if (message.type === 'explorer:theme') {
    applyScheme(message.scheme)
    if (shown !== 'demo') ready.value = true
  } else if (shown === 'demo') {
    owesSync = true
    // A fresh object even for an equal query, so the demo always answers.
    query.value = { ...message.query }
    ready.value = true
  }
}

/*
 * The page sizes the iframe to this height. An open overlay (the confirm
 * dialog, a select's listbox) lives outside the content box, so it counts
 * too: otherwise the frame would clip it.
 */
const content = ref<HTMLElement | null>(null)
let lastHeight = -1
let frame = 0
function measure() {
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(() => {
    let height = content.value ? Math.ceil(content.value.getBoundingClientRect().bottom) : 0
    for (const overlay of document.querySelectorAll('[role="dialog"], [role="alertdialog"]')) {
      height = Math.max(height, Math.ceil(overlay.getBoundingClientRect().height) + 48)
    }
    for (const overlay of document.querySelectorAll('[role="listbox"], [role="menu"]')) {
      height = Math.max(height, Math.ceil(overlay.getBoundingClientRect().bottom) + 16)
    }
    if (height === lastHeight) return
    lastHeight = height
    post({ type: 'explorer:height', surface: shown, height })
  })
}

let resized: ResizeObserver | null = null
let mutated: MutationObserver | null = null
onMounted(() => {
  embedded.value = window.parent !== window
  query.value = demoPart(route.query, [])
  ready.value = !embedded.value
  window.addEventListener('message', onMessage)
  window.addEventListener('resize', measure)
  resized = new ResizeObserver(measure)
  if (content.value) resized.observe(content.value)
  mutated = new MutationObserver(measure)
  mutated.observe(document.body, { childList: true, subtree: true, attributes: true })
  post({ type: 'explorer:ready', surface: shown })
  measure()
})
onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage)
  window.removeEventListener('resize', measure)
  resized?.disconnect()
  mutated?.disconnect()
  cancelAnimationFrame(frame)
})
</script>

<template>
  <div
    ref="content"
    class="p-1"
    :data-testid="`frame-${shown}`"
    :data-surface="shown"
    :data-ready="ready ? 'true' : undefined"
  >
    <component
      :is="component"
      v-if="shown === 'demo'"
      :query="query"
      @state="onState"
      @canonical="onCanonical"
      @event="onEvent"
    />
    <component :is="component" v-else />
  </div>
</template>
