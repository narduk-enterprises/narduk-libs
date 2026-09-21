<script setup lang="ts">
const route = useRoute()
const router = useRouter()
const { examples, packages } = useInventory()

const example = examples.find((entry) => entry.id === route.params.id)
if (!example) {
  throw createError({ statusCode: 404, statusMessage: `No demo "${route.params.id}"`, fatal: true })
}
const owner = packages.find((entry) => entry.name === example.package)
const card = example.card ? cardComponent(example.card) : null
const demo = example.interactive ? interactiveComponent(example.id) : null

/*
 * Width presets constrain the demo's frame. Components that switch layout on
 * a media query (NeDataTable's phone column switch) still follow the browser
 * window; resize it, or use device emulation, to see those.
 */
const WIDTHS = { full: '100%', tablet: '768px', phone: '375px' } as const
type Width = keyof typeof WIDTHS
const width = computed<Width>(() => {
  const value = route.query.width
  return typeof value === 'string' && value in WIDTHS ? (value as Width) : 'full'
})
function setWidth(value: Width) {
  router.replace({ query: { ...route.query, width: value === 'full' ? undefined : value } })
}

const LOG_LIMIT = 20
const events = ref<{ at: string; name: string; detail: string }[]>([])
function record(name: string, detail: unknown) {
  const at = new Date().toLocaleTimeString()
  events.value = [{ at, name, detail: JSON.stringify(detail) }, ...events.value].slice(0, LOG_LIMIT)
}

const resetKey = ref(0)
function reset() {
  events.value = []
  resetKey.value += 1
  router.replace({ query: {} })
}

const linkCopied = ref(false)
async function copyLink() {
  await navigator.clipboard.writeText(window.location.href)
  linkCopied.value = true
  setTimeout(() => (linkCopied.value = false), 1500)
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
        <div class="flex flex-wrap items-center gap-2">
          <UFieldGroup>
            <UButton
              v-for="(_, key) in WIDTHS"
              :key="key"
              size="sm"
              color="neutral"
              :variant="width === key ? 'solid' : 'outline'"
              :aria-pressed="width === key"
              @click="setWidth(key)"
            >
              {{ key }}
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
            :icon="linkCopied ? 'i-lucide-check' : 'i-lucide-link'"
            @click="copyLink"
          >
            {{ linkCopied ? 'Copied' : 'Copy link' }}
          </UButton>
        </div>
      </template>
    </NePageHeader>

    <section v-if="demo" class="space-y-3">
      <NeSectionHeader
        title="Interactive demo"
        description="Controls and presets are part of the URL, so any state can be shared."
      />
      <div
        class="mx-auto transition-[max-width]"
        :style="{ maxWidth: WIDTHS[width] }"
        data-testid="demo-frame"
      >
        <component :is="demo" :key="resetKey" @event="record" />
      </div>
      <div class="rounded-lg border border-default bg-default">
        <p class="border-b border-default px-4 py-2 text-xs font-medium text-muted uppercase">
          Event log (last {{ LOG_LIMIT }})
        </p>
        <ol class="max-h-48 overflow-y-auto px-4 py-2 font-mono text-xs" data-testid="event-log">
          <li v-if="events.length === 0" class="text-muted">No events yet.</li>
          <li v-for="(event, index) in events" :key="`${event.at}-${index}`">
            <span class="text-muted">{{ event.at }}</span> {{ event.name }} {{ event.detail }}
          </li>
        </ol>
      </div>
    </section>

    <section class="space-y-3">
      <NeSectionHeader title="Usage" />
      <CodeSnippet :code="example.usage" :label="`${example.title} usage`" />
      <p v-if="owner" class="text-sm text-muted">
        From
        <NuxtLink :to="`/packages/${owner.slug}`" class="underline">{{ owner.name }}</NuxtLink>
        {{ owner.version }}.
      </p>
    </section>

    <section v-if="card" class="space-y-3">
      <NeSectionHeader
        title="Design card"
        description="The package-owned NE Base card, rendered unchanged. It is the same source the static design export uses."
      />
      <div class="mx-auto" :style="{ maxWidth: WIDTHS[width] }">
        <component :is="card" />
      </div>
    </section>
  </div>
</template>
