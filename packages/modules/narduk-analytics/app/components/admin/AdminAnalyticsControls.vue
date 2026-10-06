<script setup lang="ts">
import { computed } from 'vue'

import {
  ADMIN_RANGE_PRESETS,
  adminRangeIsSubDay,
  adminTimeZoneName,
} from '../../utils/analyticsAdminRange'

import type { AdminRangeChoice, AdminRangeState } from '../../utils/analyticsAdminRange'
import type { AdminSourceChip } from '../../utils/analyticsAdminTiles'

const props = defineProps<{
  chips: AdminSourceChip[]
  customDraft: { end: string; start: string }
  customError: string | null
  customOpen: boolean
  customReady: boolean
  range: AdminRangeState
  /** "8 Sep 00:00 → 6 Oct 00:00" or empty while nothing has loaded. */
  rangeLine: string
  refreshing: boolean
  zone: string
}>()

const emit = defineEmits<{
  apply: []
  cancel: []
  choose: [preset: AdminRangeChoice]
  refresh: []
  'update:end': [value: string]
  'update:start': [value: string]
  'update:traffic': [value: 'external' | 'internal']
  'update:tz': [value: 'local' | 'utc']
}>()

const presets = computed(() => [
  ...ADMIN_RANGE_PRESETS.map((preset) => ({
    id: preset as AdminRangeChoice,
    label: preset.replace(/^(\d+)([hd])$/u, '$1 $2'),
  })),
  { id: 'custom' as AdminRangeChoice, label: 'Custom' },
])
const zones = computed(() => [
  {
    id: 'local' as const,
    label: props.range.tz === 'local' ? adminTimeZoneName(props.zone) : 'Local',
  },
  { id: 'utc' as const, label: 'UTC' },
])
const traffic = [
  { id: 'external' as const, label: 'External' },
  { id: 'internal' as const, label: 'Include internal' },
]
const setStart = (value: number | string | null | undefined) =>
  emit('update:start', String(value ?? ''))
const setEnd = (value: number | string | null | undefined) =>
  emit('update:end', String(value ?? ''))
const subDay = computed(() => adminRangeIsSubDay(props.range.preset))
const bucketNote = computed(
  () =>
    `${props.rangeLine ? ' · ' : ''}${subDay.value ? 'Finer' : 'Daily'} buckets · last bucket in progress`,
)
</script>

<template>
  <section class="ne-an-panel ne-an-panel-pad ne-an-controls" aria-label="Range and filters">
    <div class="ne-an-controls-row">
      <div class="ne-an-controls-left">
        <div class="ne-an-seg ne-an-presets" role="group" aria-label="Range">
          <UButton
            v-for="item in presets"
            :key="item.id"
            color="neutral"
            variant="ghost"
            :aria-pressed="range.preset === item.id"
            :aria-expanded="item.id === 'custom' ? customOpen : undefined"
            :label="item.label"
            @click="emit('choose', item.id)"
          />
        </div>
        <div class="ne-an-seg" role="group" aria-label="Time zone">
          <UButton
            v-for="item in zones"
            :key="item.id"
            color="neutral"
            variant="ghost"
            :aria-pressed="range.tz === item.id"
            :label="item.label"
            @click="emit('update:tz', item.id)"
          />
        </div>
      </div>
      <div class="ne-an-seg" role="group" aria-label="Traffic">
        <UButton
          v-for="item in traffic"
          :key="item.id"
          color="neutral"
          variant="ghost"
          :aria-pressed="range.traffic === item.id"
          :label="item.label"
          @click="emit('update:traffic', item.id)"
        />
      </div>
    </div>

    <UForm
      v-if="customOpen"
      class="ne-an-custom"
      :state="customDraft"
      @submit="emit('apply')"
      @keydown.esc="emit('cancel')"
    >
      <UFormField label="Start (included)" name="start">
        <UInput
          type="date"
          :model-value="customDraft.start"
          :color="customError ? 'error' : undefined"
          :aria-invalid="Boolean(customError)"
          @update:model-value="setStart"
        />
      </UFormField>
      <UFormField label="End (excluded)" name="end">
        <UInput
          type="date"
          :model-value="customDraft.end"
          :color="customError ? 'error' : undefined"
          :aria-invalid="Boolean(customError)"
          @update:model-value="setEnd"
        />
      </UFormField>
      <UButton type="submit" :disabled="!customReady" label="Apply" />
      <UButton color="neutral" variant="outline" label="Cancel" @click="emit('cancel')" />
      <p v-if="customError" class="ne-an-error" role="alert">{{ customError }}</p>
    </UForm>

    <p class="ne-an-range-line">
      <span v-if="rangeLine" class="ne-an-mono">{{ rangeLine }}</span>
      <span class="ne-an-note">{{ bucketNote }}</span>
    </p>

    <div class="ne-an-controls-row">
      <div class="ne-an-chips" aria-label="Data sources">
        <span v-for="chip in chips" :key="chip.id" class="ne-an-chip" :data-state="chip.state">
          <b>{{ chip.label }}</b>
          <span class="ne-an-note">{{ chip.text }}</span>
        </span>
      </div>
      <UButton
        color="neutral"
        variant="outline"
        :disabled="refreshing"
        :label="refreshing ? 'Refreshing' : 'Refresh'"
        @click="emit('refresh')"
      />
    </div>
  </section>
</template>
