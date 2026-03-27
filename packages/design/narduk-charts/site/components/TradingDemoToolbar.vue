<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  symbol: string
  venue: string
  timeframe: string
  lastPriceText: string
  changeText: string
  changePctText: string
  changeTone?: 'up' | 'down' | 'flat'
  vwapText: string
  avgVolumeText: string
  sessionRangeText: string
  terminalDark: boolean
  useLogScale: boolean
  drawMode: 'off' | 'trend' | 'horizontal'
}>(), {
  changeTone: 'flat',
})

const emit = defineEmits<{
  'update:terminalDark': [value: boolean]
  'update:useLogScale': [value: boolean]
  'update:drawMode': [value: 'off' | 'trend' | 'horizontal']
}>()

const changeClass = computed(() => {
  if (props.changeTone === 'up') return 'td-toolbar__change--up'
  if (props.changeTone === 'down') return 'td-toolbar__change--down'
  return 'td-toolbar__change--flat'
})

const changeBadgeClass = computed(() => {
  if (props.changeTone === 'up') return 'td-toolbar__change-badge--up'
  if (props.changeTone === 'down') return 'td-toolbar__change-badge--down'
  return 'td-toolbar__change-badge--flat'
})

const metrics = computed(() => [
  { label: 'VWAP', value: props.vwapText },
  { label: 'Avg volume', value: props.avgVolumeText },
  { label: 'Session range', value: props.sessionRangeText },
])

function onTerminalDarkChange(event: Event) {
  emit('update:terminalDark', (event.target as HTMLInputElement).checked)
}

function onUseLogScaleChange(event: Event) {
  emit('update:useLogScale', (event.target as HTMLInputElement).checked)
}

function onDrawModeChange(event: Event) {
  emit('update:drawMode', (event.target as HTMLSelectElement).value as 'off' | 'trend' | 'horizontal')
}
</script>

<template>
  <section class="td-toolbar" role="toolbar" aria-label="Chart controls">
    <div class="td-toolbar__header">
      <div class="td-toolbar__identity">
        <div class="td-toolbar__eyebrow">
          <span class="td-toolbar__venue">{{ venue }}</span>
          <span class="td-toolbar__sep" aria-hidden="true">·</span>
          <span class="td-toolbar__timeframe">{{ timeframe }}</span>
        </div>
        <p class="td-toolbar__symbol">{{ symbol }}</p>
      </div>

      <div class="td-toolbar__quote-block">
        <p class="td-toolbar__price">{{ lastPriceText }}</p>
        <span class="td-toolbar__change-badge" :class="changeBadgeClass">
          <span class="td-toolbar__change" :class="changeClass">{{ changeText }}</span>
          <span class="td-toolbar__change-divider" aria-hidden="true" />
          <span class="td-toolbar__change" :class="changeClass">{{ changePctText }}</span>
        </span>
      </div>
    </div>

    <div class="td-toolbar__divider" aria-hidden="true" />

    <div class="td-toolbar__metrics">
      <article
        v-for="metric in metrics"
        :key="metric.label"
        class="td-toolbar__metric"
      >
        <p class="td-toolbar__metric-label">{{ metric.label }}</p>
        <p class="td-toolbar__metric-value">{{ metric.value }}</p>
      </article>
    </div>

    <div class="td-toolbar__divider" aria-hidden="true" />

    <div class="td-toolbar__controls">
      <label class="td-toolbar__toggle">
        <input
          :checked="terminalDark"
          type="checkbox"
          @change="onTerminalDarkChange"
        >
        <span>Dark surface</span>
      </label>
      <label class="td-toolbar__toggle">
        <input
          :checked="useLogScale"
          type="checkbox"
          @change="onUseLogScaleChange"
        >
        <span>Log Y</span>
      </label>
      <label class="td-toolbar__select-wrap">
        <span class="td-toolbar__select-label">Tool</span>
        <select
          :value="drawMode"
          class="td-toolbar__select"
          @change="onDrawModeChange"
        >
          <option value="off">Zoom box</option>
          <option value="trend">Trend line</option>
          <option value="horizontal">Horizontal</option>
        </select>
      </label>
    </div>
  </section>
</template>

<style scoped>
.td-toolbar {
  display: flex;
  flex-direction: column;
  gap: 0;
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 1.25rem;
  background:
    linear-gradient(160deg, rgba(16, 24, 44, 0.99) 0%, rgba(10, 16, 30, 0.97) 100%),
    radial-gradient(ellipse at 0% 0%, rgba(49, 88, 255, 0.18) 0%, transparent 40%),
    radial-gradient(ellipse at 100% 100%, rgba(45, 212, 191, 0.08) 0%, transparent 40%);
  box-shadow:
    0 24px 56px -32px rgba(2, 6, 23, 0.8),
    inset 0 1px 0 rgba(255, 255, 255, 0.07),
    inset 0 0 0 1px rgba(255, 255, 255, 0.03);
  color: rgba(248, 250, 252, 0.96);
  overflow: hidden;
}

.td-toolbar__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.15rem 1.25rem 1rem;
  flex-wrap: wrap;
}

.td-toolbar__identity {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
}

.td-toolbar__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.td-toolbar__venue {
  color: rgba(165, 180, 252, 0.9);
}

.td-toolbar__sep {
  color: rgba(45, 212, 191, 0.7);
}

.td-toolbar__timeframe {
  color: rgba(148, 163, 184, 0.75);
}

.td-toolbar__symbol {
  margin: 0;
  font-size: clamp(1.65rem, 2.5vw, 2.1rem);
  font-weight: 800;
  letter-spacing: -0.045em;
  line-height: 1;
  color: rgba(255, 255, 255, 0.98);
}

.td-toolbar__quote-block {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.35rem;
  min-width: 0;
}

.td-toolbar__price {
  margin: 0;
  font-family: var(--font-mono, monospace);
  font-size: clamp(1.5rem, 2.2vw, 2rem);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
  color: rgba(255, 255, 255, 0.98);
  line-height: 1;
}

.td-toolbar__change-badge {
  display: inline-flex;
  align-items: center;
  gap: 0;
  border-radius: 999px;
  padding: 0.3rem 0.65rem;
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.td-toolbar__change-badge--up {
  background: rgba(22, 163, 74, 0.18);
  border: 1px solid rgba(74, 222, 128, 0.24);
}

.td-toolbar__change-badge--down {
  background: rgba(185, 28, 28, 0.18);
  border: 1px solid rgba(248, 113, 113, 0.24);
}

.td-toolbar__change-badge--flat {
  background: rgba(148, 163, 184, 0.1);
  border: 1px solid rgba(148, 163, 184, 0.18);
}

.td-toolbar__change {
  display: inline;
}

.td-toolbar__change-divider {
  display: inline-block;
  width: 1px;
  height: 0.75em;
  background: currentColor;
  opacity: 0.3;
  margin: 0 0.45em;
  vertical-align: middle;
}

.td-toolbar__change--up {
  color: rgba(74, 222, 128, 0.98);
}

.td-toolbar__change--down {
  color: rgba(252, 100, 100, 0.98);
}

.td-toolbar__change--flat {
  color: rgba(203, 213, 225, 0.85);
}

.td-toolbar__divider {
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.07) 20%, rgba(255, 255, 255, 0.07) 80%, transparent);
  flex-shrink: 0;
}

.td-toolbar__metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0;
}

.td-toolbar__metric {
  padding: 0.8rem 1.25rem;
  position: relative;
}

.td-toolbar__metric + .td-toolbar__metric::before {
  content: '';
  position: absolute;
  left: 0;
  top: 25%;
  height: 50%;
  width: 1px;
  background: rgba(255, 255, 255, 0.07);
}

.td-toolbar__metric-label {
  margin: 0;
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.13em;
  text-transform: uppercase;
  color: rgba(100, 116, 139, 0.95);
  white-space: nowrap;
}

.td-toolbar__metric-value {
  margin: 0.35rem 0 0;
  font-family: var(--font-mono, monospace);
  font-size: 0.92rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: rgba(226, 232, 240, 0.95);
  white-space: nowrap;
}

.td-toolbar__controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  align-items: center;
  padding: 0.75rem 1.25rem;
}

.td-toolbar__toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(203, 213, 225, 0.88);
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 600;
  min-height: 2.25rem;
  padding: 0 0.85rem;
  letter-spacing: 0.01em;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.td-toolbar__toggle:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.15);
}

.td-toolbar__toggle input {
  accent-color: #818cf8;
  width: 0.9rem;
  height: 0.9rem;
}

.td-toolbar__select-wrap {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  min-height: 2.25rem;
  padding: 0 0.4rem 0 0.85rem;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.td-toolbar__select-wrap:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.15);
}

.td-toolbar__select-label {
  color: rgba(148, 163, 184, 0.82);
  font-size: 0.8rem;
  font-weight: 600;
  white-space: nowrap;
  letter-spacing: 0.01em;
}

.td-toolbar__select {
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.07);
  color: rgba(226, 232, 240, 0.95);
  font-size: 0.8rem;
  font-weight: 600;
  min-height: 1.85rem;
  padding: 0 0.75rem;
}

.td-toolbar__select:focus-visible {
  outline: 2px solid rgba(129, 140, 248, 0.86);
  outline-offset: 2px;
}
</style>
