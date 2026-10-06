<script setup lang="ts">
import { computed } from 'vue'

import { ADMIN_TRAFFIC_CLASS_ORDER, adminFormatCount } from '../../utils/analyticsAdminRange'

const props = defineProps<{
  classes: Array<{ class: string; events: number }>
  includeClasses: string[]
  loading: boolean
  mode: 'external' | 'internal'
  unavailable: string
}>()

const emit = defineEmits<{ toggle: [name: string] }>()

const INFO: Record<string, { color: string; label: string; note: string }> = {
  unmarked: {
    label: 'Unknown',
    note: 'No marker: before activation, or a browser that is not enrolled. Kept in External.',
    color: 'var(--an-accent)',
  },
  external: {
    label: 'External',
    note: 'Marked as a visitor by the module.',
    color: 'var(--an-accent)',
  },
  owner: { label: 'Owner', note: 'A browser enrolled by ops sign-in.', color: 'var(--an-warn)' },
  automation: {
    label: 'Automation',
    note: 'Agents, Lighthouse, visual QA and CI.',
    color: 'var(--an-ink-3)',
  },
}

const rows = computed(() => {
  const order = (name: string) => {
    const at = (ADMIN_TRAFFIC_CLASS_ORDER as readonly string[]).indexOf(name)
    return at === -1 ? 99 : at
  }
  return [...props.classes]
    .sort((a, b) => order(a.class) - order(b.class) || b.events - a.events)
    .map((row) => {
      const info = INFO[row.class] ?? {
        label: row.class,
        note: 'Counted only when every class is included.',
        color: 'var(--an-ink-3)',
      }
      const external = row.class === 'unmarked' || row.class === 'external'
      const toggleable = row.class === 'owner' || row.class === 'automation'
      const all =
        props.includeClasses.includes('owner') && props.includeClasses.includes('automation')
      return {
        ...row,
        ...info,
        counted:
          external ||
          (props.mode === 'internal' &&
            (toggleable ? props.includeClasses.includes(row.class) : all)),
        toggleable: toggleable && props.mode === 'internal',
      }
    })
})
const total = computed(() => rows.value.reduce((sum, row) => sum + row.events, 0))
</script>

<template>
  <section class="ne-an-panel" aria-label="Whose traffic">
    <div class="ne-an-panel-head">
      <h2>Whose traffic</h2>
      <span class="ne-an-note">pageviews in range</span>
    </div>
    <div class="ne-an-panel-body">
      <p v-if="unavailable" class="ne-an-empty">{{ unavailable }}</p>
      <div v-else-if="loading && !classes.length" aria-hidden="true">
        <div class="ne-an-skel" />
        <div class="ne-an-skel" />
      </div>
      <p v-else-if="!classes.length" class="ne-an-empty">No pageviews in this range.</p>
      <template v-else>
        <div class="ne-an-stack" role="img" :aria-label="`${total} pageviews by traffic class`">
          <i
            v-for="row in rows"
            :key="row.class"
            :style="{
              width: `${total ? (row.events / total) * 100 : 0}%`,
              background: row.color,
              opacity: row.counted ? 1 : 0.35,
            }"
          />
        </div>
        <div v-for="row in rows" :key="row.class" class="ne-an-class">
          <UCheckbox
            :model-value="row.counted"
            :disabled="!row.toggleable"
            :aria-label="`Count ${row.label}`"
            @update:model-value="emit('toggle', row.class)"
          />
          <div>
            <b><span class="ne-an-swatch" :style="{ background: row.color }" />{{ row.label }}</b>
            <p class="ne-an-note">{{ row.note }}</p>
          </div>
          <span class="ne-an-row-value">{{ adminFormatCount(row.events) }}</span>
        </div>
        <p class="ne-an-note" style="margin-top: 8px">
          {{
            mode === 'external'
              ? 'External counts unknown and external traffic. Choose Include internal to add owner and automation back.'
              : 'Tick the classes to add to External.'
          }}
        </p>
      </template>
    </div>
  </section>
</template>
