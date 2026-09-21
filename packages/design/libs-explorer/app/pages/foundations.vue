<script setup lang="ts">
import type { DesignToken, TokenGroup, TokenPreview } from '../../inventory/tokens.mts'

const { tokens } = useInventory()

const GROUPS: TokenGroup[] = [
  'Color',
  'Typography',
  'Spacing',
  'Radius',
  'Elevation',
  'Layout',
  'Nuxt UI bridge',
]
const filter = ref('')

const grouped = computed(() =>
  GROUPS.map((group) => ({
    group,
    tokens: tokens.filter(
      (token) => token.group === group && token.name.includes(filter.value.trim().toLowerCase()),
    ),
  })).filter((entry) => entry.tokens.length > 0),
)

/*
 * Each preview applies the token through the CSS property it is for, inside a
 * wrapper pinned to one scheme, so the browser resolves `var()` exactly as an
 * app would. A token whose value has no visual form (`none`) shows its value
 * only: a fake swatch would claim something the token does not do.
 */
const SAMPLES: Partial<Record<TokenPreview, string>> = {
  'font-family': 'Sabine Pass 29.94 inHg',
  'font-size': 'Sabine Pass',
  'line-height': 'Gusts to 27 kt at Sabine Pass; seas building to 4.6 ft by morning.',
  tracking: 'STATION READINGS',
  'font-weight': 'Sabine Pass 27 kt',
}

function previewStyle(token: DesignToken): Record<string, string> {
  const value = `var(${token.name})`
  switch (token.preview) {
    case 'color':
      return { background: value }
    case 'channels':
      return { background: `rgb(${value})` }
    case 'shadow':
      return { boxShadow: value }
    case 'radius':
      return { borderRadius: value }
    case 'font-family':
      return { fontFamily: value }
    case 'font-size':
      return { fontSize: value, lineHeight: '1.1' }
    case 'line-height':
      return { lineHeight: value }
    case 'tracking':
      return { letterSpacing: value }
    case 'font-weight':
      return { fontWeight: value }
    case 'length':
      return { width: value }
    default:
      return {}
  }
}

useSeoMeta({ title: 'Foundations — Narduk Libs Explorer' })
</script>

<template>
  <div class="space-y-8">
    <NePageHeader
      eyebrow="Foundations"
      title="Design tokens"
      description="Read from narduk-ui/tokens.css and narduk-shell/theme.css at build time, grouped by what each token is for. Each preview applies the token through its own CSS property and pins one scheme with the .light / .dark class Nuxt UI switches on."
    />
    <UInput
      v-model="filter"
      icon="i-lucide-filter"
      placeholder="Filter tokens, e.g. accent or ink"
      aria-label="Filter tokens"
      class="max-w-sm"
    />
    <section v-for="{ group, tokens: rows } in grouped" :key="group" class="space-y-3">
      <NeSectionHeader :title="group" :count="rows.length" />
      <div class="overflow-x-auto rounded-lg border border-default bg-default">
        <table class="w-full text-sm">
          <thead class="text-left text-xs text-muted">
            <tr>
              <th class="p-3 font-medium">Token</th>
              <th class="p-3 font-medium">Light</th>
              <th class="p-3 font-medium">Dark</th>
              <th class="p-3 font-medium">Source</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="token in rows" :key="token.name" class="border-t border-default">
              <td class="p-3 font-mono whitespace-nowrap">
                {{ token.name }}
                <CopyButton :text="`var(${token.name})`" :label="token.name" />
              </td>
              <td v-for="scheme in ['light', 'dark'] as const" :key="scheme" class="min-w-56 p-3">
                <div
                  :class="scheme"
                  class="space-y-2 rounded-md bg-(--ne-surface) p-2 text-(--ne-ink)"
                  :data-token="token.name"
                  :data-scheme="scheme"
                >
                  <span
                    v-if="token.preview === 'color' || token.preview === 'channels'"
                    class="block h-8 w-16 rounded border border-(--ne-hairline)"
                    :style="previewStyle(token)"
                    data-preview
                    aria-hidden="true"
                  />
                  <span
                    v-else-if="token.preview === 'shadow' || token.preview === 'radius'"
                    class="block h-12 w-20 bg-(--ne-surface-elevated)"
                    :class="token.preview === 'radius' ? 'border-2 border-(--ne-accent)' : 'm-2'"
                    :style="previewStyle(token)"
                    data-preview
                    aria-hidden="true"
                  />
                  <span
                    v-else-if="token.preview === 'length'"
                    class="block h-2 max-w-full rounded-sm bg-(--ne-accent)"
                    :style="previewStyle(token)"
                    data-preview
                    aria-hidden="true"
                  />
                  <p
                    v-else-if="SAMPLES[token.preview]"
                    class="max-w-72 overflow-hidden"
                    :class="
                      token.preview === 'line-height'
                        ? 'bg-(--ne-surface-muted) text-sm'
                        : 'text-ellipsis whitespace-nowrap'
                    "
                    :style="previewStyle(token)"
                    data-preview
                  >
                    {{ SAMPLES[token.preview] }}
                  </p>
                  <code class="block text-xs break-words text-(--ne-ink-body)">{{
                    token[scheme] ?? token.light ?? '—'
                  }}</code>
                  <span
                    v-if="scheme === 'dark' && token.dark === null"
                    class="block text-xs text-(--ne-ink-muted)"
                    data-inherited
                    >inherits the light value</span
                  >
                </div>
              </td>
              <td class="p-3 font-mono text-xs text-muted">{{ token.source }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
