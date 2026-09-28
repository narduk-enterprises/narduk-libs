<script setup lang="ts">
import { onBeforeUnmount, onMounted, useId, useTemplateRef } from 'vue'

export interface MapkitBasemapOption {
  key: string
  label: string
  note?: string
}

export interface MapkitUnitOption {
  key: string
  label: string
}

withDefaults(
  defineProps<{
    basemaps: MapkitBasemapOption[]
    title?: string
    unitOptions: MapkitUnitOption[]
    unitsTitle?: string
  }>(),
  {
    title: 'Map style',
    unitsTitle: 'Units',
  },
)

const emit = defineEmits<{
  close: []
}>()

const basemap = defineModel<string>('basemap', { required: true })
const units = defineModel<string>('units', { required: true })

const groupId = useId()
const root = useTemplateRef<HTMLElement>('root')
const basemapFieldset = useTemplateRef<HTMLFieldSetElement>('basemapFieldset')

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
}

function onPointerDown(event: PointerEvent): void {
  const target = event.target
  if (target instanceof Node && root.value?.contains(target)) return
  emit('close')
}

if (typeof document !== 'undefined') {
  onMounted(() => {
    document.addEventListener('keydown', onKeydown)
    document.addEventListener('pointerdown', onPointerDown, true)
    basemapFieldset.value?.querySelector<HTMLInputElement>('input:checked')?.focus()
  })

  onBeforeUnmount(() => {
    document.removeEventListener('keydown', onKeydown)
    document.removeEventListener('pointerdown', onPointerDown, true)
  })
}
</script>

<template>
  <div ref="root" role="dialog" :aria-label="title" class="style-menu">
    <fieldset ref="basemapFieldset" class="fieldset">
      <legend class="menu-title">{{ title }}</legend>
      <label
        v-for="option in basemaps"
        :key="option.key"
        class="option"
        :for="`mapkit-style-basemap-${groupId}-${option.key}`"
      >
        <input
          :id="`mapkit-style-basemap-${groupId}-${option.key}`"
          type="radio"
          :name="`mapkit-style-basemap-${groupId}`"
          :checked="option.key === basemap"
          @change="basemap = option.key"
        />
        <span>{{ option.label }}</span>
        <span v-if="option.note" class="option-note">{{ option.note }}</span>
      </label>
    </fieldset>

    <span class="divider" />

    <fieldset class="fieldset fieldset--units">
      <legend class="menu-title menu-title--inset">{{ unitsTitle }}</legend>
      <div class="units-toggle">
        <label
          v-for="option in unitOptions"
          :key="option.key"
          class="unit-option"
          :class="{ 'is-on': option.key === units }"
          :for="`mapkit-style-units-${groupId}-${option.key}`"
        >
          <input
            :id="`mapkit-style-units-${groupId}-${option.key}`"
            type="radio"
            :name="`mapkit-style-units-${groupId}`"
            :checked="option.key === units"
            @change="units = option.key"
          />
          {{ option.label }}
        </label>
      </div>
    </fieldset>
  </div>
</template>

<style scoped>
.style-menu {
  position: relative;
  box-sizing: border-box;
  width: 268px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-radius: var(--mk-radius-panel);
  background: var(--mk-surface);
  box-shadow: var(--mk-elev-3);
}

.fieldset {
  margin: 0;
  padding: 0;
  border: 0;
  display: flex;
  flex-direction: column;
}

.fieldset--units {
  padding: 0 4px 4px;
  gap: 6px;
}

.menu-title {
  padding: 6px 10px 4px;
  font-size: 13px;
  font-weight: 600;
  color: var(--mk-ink-3);
}

.menu-title--inset {
  padding-left: 6px;
}

.option {
  min-height: 44px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 10px;
  border-radius: var(--mk-radius-control);
  font-size: 15px;
  color: var(--mk-ink-strong);
  cursor: pointer;
}

.option:hover {
  background: var(--mk-surface-hover);
}

.option input {
  width: 18px;
  height: 18px;
  margin: 0;
  accent-color: var(--mk-accent-strong);
}

.option-note {
  margin-left: auto;
  font-size: 13px;
  color: var(--mk-ink-3);
}

.divider {
  height: 1px;
  margin: 0 4px;
  background: #eaeef1;
}

.units-toggle {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2px;
  padding: 2px;
  border-radius: 10px;
  background: var(--mk-surface-sunken);
}

.unit-option {
  position: relative;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: var(--mk-radius-control);
  font-size: 14px;
  font-weight: 600;
  color: var(--mk-ink-2);
  cursor: pointer;
}

.unit-option input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

.unit-option.is-on {
  background: var(--mk-surface);
  color: var(--mk-ink);
  box-shadow:
    0 1px 2px rgb(14 20 24 / 0.12),
    inset 0 0 0 1px var(--mk-line-soft);
}

.unit-option:focus-within {
  outline: 2px solid var(--mk-focus);
  outline-offset: 1px;
}
</style>
