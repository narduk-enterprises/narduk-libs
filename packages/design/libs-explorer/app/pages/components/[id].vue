<script setup lang="ts">
/*
 * A component page. Every preview (the interactive demo, the design card, the
 * live usage example) renders in a same-origin iframe of /frame/<id>/<surface>,
 * so a viewport preset is the preview document's real width and components
 * that switch layout on a media query (NeDataTable's phone column sets) do.
 *
 * This page owns the URL: `width` is the page's own parameter, everything else
 * is the demo's state. A control change inside the demo frame arrives as an
 * `explorer:state` message with cause `user` (a history entry) or `sync` (the
 * demo's canonical form of a query we sent, which replaces the URL in place).
 * Back/forward change the URL first, and the page forwards the demo part to
 * the frame. Nothing navigates when the two already agree, so there is no loop.
 */
import {
  demoPart,
  plainQuery,
  readFromFrame,
  sameQuery,
  VIEWPORTS,
  parseViewport,
  type Surface,
  type ToFrame,
  type Viewport,
} from '../../../demo/frame.mts'

const route = useRoute()
const router = useRouter()
const colorMode = useColorMode()
const { examples, packages } = useInventory()

const example = examples.find((entry) => entry.id === route.params.id)
if (!example) {
  throw createError({ statusCode: 404, statusMessage: `No demo "${route.params.id}"`, fatal: true })
}
const owner = packages.find((entry) => entry.name === example.package)
const source = usageSource(example.id) ?? ''

const surfaces: Surface[] = [
  ...(example.interactive ? (['demo'] as const) : []),
  'usage',
  ...(example.card ? (['card'] as const) : []),
]
const SURFACE_TITLES: Record<Surface, { title: string; description: string }> = {
  demo: {
    title: 'Interactive demo',
    description:
      'Controls and the viewport preset are part of the URL, so any state can be shared, reloaded, or walked with back and forward.',
  },
  usage: {
    title: 'Usage',
    description: 'The example below, rendered live from the same file.',
  },
  card: {
    title: 'Design card',
    description:
      'The package-owned NE Base card, rendered unchanged. It is the same source the static design export uses.',
  },
}

// The prerendered page has no query: query-dependent state is applied after
// mount, so a deep link hydrates against the same DOM the server rendered.
const mounted = ref(false)
const viewport = computed<Viewport>(() =>
  mounted.value
    ? parseViewport(typeof route.query.width === 'string' ? route.query.width : null)
    : 'full',
)
const frameWidth = computed(() => {
  const width = VIEWPORTS[viewport.value]
  return width === null ? '100%' : `${width}px`
})

/*
 * Frames are created once per mount (and again on Reset). Their `src` never
 * changes afterwards: moving an iframe's src would add an entry to the
 * page's joint session history and break back/forward.
 */
const generation = ref(0)
const sources = ref<Partial<Record<Surface, string>>>({})
const heights = ref<Partial<Record<Surface, number>>>({})
const frames = new Map<Surface, HTMLIFrameElement>()
/** The demo state the demo frame last reported: what it is showing. */
let shownState: Record<string, string> | null = null

function frameUrl(surface: Surface, query: Record<string, string>): string {
  const search = surface === 'demo' ? new URLSearchParams(query).toString() : ''
  return `/frame/${example!.id}/${surface}${search ? `?${search}` : ''}`
}

function createFrames(query: Record<string, string>) {
  generation.value += 1
  shownState = null
  heights.value = {}
  sources.value = Object.fromEntries(surfaces.map((surface) => [surface, frameUrl(surface, query)]))
}

function bindFrame(surface: Surface, element: unknown) {
  if (element instanceof HTMLIFrameElement) frames.set(surface, element)
  else frames.delete(surface)
}

function send(surface: Surface, message: ToFrame) {
  frames.get(surface)?.contentWindow?.postMessage(message, window.location.origin)
}

const scheme = computed(() => (colorMode.value === 'dark' ? 'dark' : 'light'))
watch(scheme, (next) => {
  for (const surface of frames.keys()) send(surface, { type: 'explorer:theme', scheme: next })
})

/** The page's canonical query: the demo's canonical part plus a valid, non-default width. */
function pageQuery(demo: Record<string, string>): Record<string, string> {
  const width = parseViewport(typeof route.query.width === 'string' ? route.query.width : null)
  return width === 'full' ? demo : { ...demo, width }
}

function surfaceOf(sender: MessageEventSource | null): Surface | null {
  for (const [surface, element] of frames) if (element.contentWindow === sender) return surface
  return null
}

function onMessage(event: MessageEvent) {
  if (event.origin !== window.location.origin) return
  const message = readFromFrame(event.data)
  // The message must come from the frame it claims to be.
  if (!message || surfaceOf(event.source) !== message.surface) return
  switch (message.type) {
    case 'explorer:ready':
      send(message.surface, { type: 'explorer:theme', scheme: scheme.value })
      if (message.surface === 'demo') {
        send('demo', { type: 'explorer:query', query: demoPart(route.query) })
      }
      return
    case 'explorer:height':
      heights.value = { ...heights.value, [message.surface]: message.height }
      return
    case 'explorer:event':
      record(message.surface, message.name, message.detail)
      return
    case 'explorer:state': {
      if (message.surface !== 'demo') return
      shownState = message.query
      // Compare the whole URL, not its first values: `?sort=a&sort=b` or an
      // unknown parameter reads the same to the demo but is not canonical.
      const target = pageQuery(message.query)
      const current = plainQuery(route.query)
      if (current && sameQuery(current, target)) return
      const to = { query: target }
      if (message.cause === 'user') void router.push(to)
      else void router.replace(to)
    }
  }
}

// Back, forward, or any other URL change: tell the demo, unless it already shows it.
watch(
  () => route.query,
  (query) => {
    if (!mounted.value || !example.interactive || shownState === null) return
    const demo = demoPart(query)
    if (!sameQuery(demo, shownState)) send('demo', { type: 'explorer:query', query: demo })
  },
)

onMounted(() => {
  window.addEventListener('message', onMessage)
  createFrames(demoPart(route.query))
  mounted.value = true
})
onBeforeUnmount(() => window.removeEventListener('message', onMessage))

function setViewport(next: Viewport) {
  if (next === viewport.value) return
  const query = { ...route.query }
  if (next === 'full') delete query.width
  else query.width = next
  void router.push({ query })
}

const LOG_LIMIT = 20
const events = ref<{ id: number; surface: Surface; name: string; detail: string }[]>([])
let eventId = 0
function record(surface: Surface, name: string, detail: unknown) {
  eventId += 1
  const entry = { id: eventId, surface, name, detail: JSON.stringify(detail) }
  events.value = [entry, ...events.value].slice(0, LOG_LIMIT)
}

/*
 * Reset returns every surface to its first render: fresh frames (so stateful
 * design cards and usage examples start over too), the default query, full
 * width, and an empty log. The colour preference is the reader's, not the
 * demo's, and stays as it is.
 */
async function reset() {
  events.value = []
  if (Object.keys(route.query).length > 0) await router.push({ query: {} })
  createFrames({})
}

const copyState = ref<'idle' | 'copied' | 'failed'>('idle')
let copyTimer: ReturnType<typeof setTimeout> | undefined
async function copyLink() {
  clearTimeout(copyTimer)
  try {
    await navigator.clipboard.writeText(window.location.href)
    copyState.value = 'copied'
  } catch {
    copyState.value = 'failed'
  }
  copyTimer = setTimeout(() => (copyState.value = 'idle'), 2000)
}

useSeoMeta({
  title: `${example.title} — Narduk Libs Explorer`,
  description: example.summary,
})
</script>

<template>
  <div v-if="example" class="space-y-8">
    <NePageHeader
      :eyebrow="owner?.slug ?? example.package"
      :title="example.title"
      :description="example.summary"
    >
      <template #actions>
        <div class="flex flex-wrap items-center gap-2" data-testid="page-controls">
          <UFieldGroup aria-label="Viewport">
            <UButton
              v-for="(_, key) in VIEWPORTS"
              :key="key"
              size="sm"
              color="neutral"
              :variant="viewport === key ? 'solid' : 'outline'"
              :aria-pressed="viewport === key"
              :data-testid="`viewport-${key}`"
              @click="setViewport(key)"
            >
              {{ key }}{{ VIEWPORTS[key] ? ` · ${VIEWPORTS[key]}px` : '' }}
            </UButton>
          </UFieldGroup>
          <UButton
            size="sm"
            color="neutral"
            variant="outline"
            icon="i-lucide-rotate-ccw"
            data-testid="demo-reset"
            @click="reset"
          >
            Reset
          </UButton>
          <UButton
            size="sm"
            color="neutral"
            variant="outline"
            :icon="
              copyState === 'copied'
                ? 'i-lucide-check'
                : copyState === 'failed'
                  ? 'i-lucide-circle-alert'
                  : 'i-lucide-link'
            "
            data-testid="copy-link"
            @click="copyLink"
          >
            {{
              copyState === 'copied'
                ? 'Copied'
                : copyState === 'failed'
                  ? 'Copy failed: use the address bar'
                  : 'Copy link'
            }}
          </UButton>
          <span class="sr-only" aria-live="polite">{{
            copyState === 'copied' ? 'Link copied' : copyState === 'failed' ? 'Copy failed' : ''
          }}</span>
        </div>
      </template>
    </NePageHeader>

    <section
      v-for="surface in surfaces"
      :key="surface"
      class="space-y-3"
      :data-testid="`section-${surface}`"
    >
      <NeSectionHeader
        :title="SURFACE_TITLES[surface].title"
        :description="SURFACE_TITLES[surface].description"
      />
      <!-- A preset wider than the window scrolls rather than shrinking: the
           frame is the preset's real width or the preset means nothing. -->
      <div class="overflow-x-auto">
        <div
          class="mx-auto"
          :style="{ width: frameWidth }"
          :data-testid="`viewport-box-${surface}`"
          :data-viewport="viewport"
        >
          <iframe
            v-if="mounted && sources[surface]"
            :key="`${surface}-${generation}`"
            :ref="(element) => bindFrame(surface, element)"
            :src="sources[surface]"
            :title="`${example.title}: ${SURFACE_TITLES[surface].title}`"
            :data-testid="`frame-${surface}`"
            class="block w-full rounded-lg bg-default ring ring-default"
            :style="{ height: `${heights[surface] ?? 160}px` }"
          />
          <div
            v-else
            class="h-40 rounded-lg border border-dashed border-default"
            aria-hidden="true"
            data-testid="frame-pending"
          />
        </div>
      </div>

      <template v-if="surface === 'demo'">
        <div class="rounded-lg border border-default bg-default">
          <p class="border-b border-default px-4 py-2 text-xs font-medium text-muted uppercase">
            Event log (latest {{ LOG_LIMIT }}, newest first)
          </p>
          <ol class="max-h-48 overflow-y-auto px-4 py-2 font-mono text-xs" data-testid="event-log">
            <li v-if="events.length === 0" class="text-muted">No events yet.</li>
            <li v-for="event in events" :key="event.id" data-testid="event-entry">
              <span class="text-muted">#{{ event.id }}</span> {{ event.name }} {{ event.detail }}
            </li>
          </ol>
        </div>
      </template>

      <template v-if="surface === 'usage'">
        <CodeSnippet :code="source" :label="`${example.title} usage`" data-testid="usage-source" />
        <p class="text-sm text-muted">
          Setup (the package install, <code>nuxt.config</code> module and stylesheet) is done once
          per app; see
          <NuxtLink v-if="owner" :to="`/packages/${owner.slug}`" class="underline"
            >{{ owner.name }} setup</NuxtLink
          ><template v-else>{{ example.package }}</template
          >.
        </p>
      </template>
    </section>
  </div>
</template>
