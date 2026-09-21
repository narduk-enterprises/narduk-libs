<script setup lang="ts">
import type { DesignToken, TokenGroup } from '../../inventory/tokens.mts'

const { tokens } = useInventory()

const GROUPS: TokenGroup[] = ['Color', 'Type', 'Radius', 'Elevation', 'Layout', 'Nuxt UI bridge']
const filter = ref('')

const grouped = computed(() =>
  GROUPS.map((group) => ({
    group,
    tokens: tokens.filter(
      (token) => token.group === group && token.name.includes(filter.value.trim().toLowerCase()),
    ),
  })).filter((entry) => entry.tokens.length > 0),
)

function previewStyle(token: DesignToken): Record<string, string> {
  const value = `var(${token.name})`
  switch (token.group) {
    case 'Color':
      return { background: value }
    case 'Radius':
      return { borderRadius: value }
    case 'Elevation':
      return { boxShadow: value }
    case 'Type':
      return token.name.includes('font')
        ? { fontFamily: value }
        : token.name.includes('text')
          ? { fontSize: value }
          : {}
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
      description="Read from narduk-ui/tokens.css and narduk-shell/theme.css at build time. Each preview pins one scheme with the same .light / .dark class Nuxt UI switches on."
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
                  class="flex items-center gap-3 rounded-md bg-(--ne-surface) p-2"
                >
                  <span
                    v-if="group !== 'Layout' && group !== 'Nuxt UI bridge'"
                    class="inline-flex size-10 shrink-0 items-center justify-center border border-(--ne-hairline) bg-(--ne-surface-elevated) text-(--ne-ink)"
                    :style="previewStyle(token)"
                    aria-hidden="true"
                    >{{ group === 'Type' ? 'Aa' : '' }}</span
                  >
                  <code class="text-xs break-words text-(--ne-ink-body)">{{
                    token[scheme] ?? token.light ?? '—'
                  }}</code>
                  <span
                    v-if="scheme === 'dark' && token.dark === null"
                    class="text-xs text-(--ne-ink-muted)"
                    >(no dark value)</span
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
