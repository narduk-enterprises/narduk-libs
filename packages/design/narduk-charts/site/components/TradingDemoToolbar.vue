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
  <section class="td-toolbar">
    <div class="td-toolbar__quote">
      <div class="td-toolbar__eyebrow">
        <span class="td-toolbar__venue">{{ venue }}</span>
        <span class="td-toolbar__eyebrow-dot" aria-hidden="true" />
        <span>{{ timeframe }}</span>
      </div>
      <div class="td-toolbar__headline">
        <div class="td-toolbar__headline-copy">
          <p class="td-toolbar__symbol">{{ symbol }}</p>
          <p class="td-toolbar__subcopy">
            Flagship demo with synced panes, overlays, and pro-grade market interactions.
          </p>
        </div>
        <div class="td-toolbar__price-block">
          <p class="td-toolbar__price">{{ lastPriceText }}</p>
          <p class="td-toolbar__change" :class="changeClass">
            {{ changeText }} · {{ changePctText }}
          </p>
        </div>
      </div>
    </div>

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

    <div class="td-toolbar__controls">
      <label class="td-toolbar__toggle">
        <input
          :checked="terminalDark"
          type="checkbox"
          @change="onTerminalDarkChange"
        >
        <span>Terminal surface</span>
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
        <span class="td-toolbar__select-label">Draw mode</span>
        <select
          :value="drawMode"
          class="td-toolbar__select"
          @change="onDrawModeChange"
        >
          <option value="off">
            Zoom box
          </option>
          <option value="trend">
            Trend line
          </option>
          <option value="horizontal">
            Horizontal
          </option>
        </select>
      </label>
    </div>
  </section>
</template>

<style scoped>
.td-toolbar {
  display: grid;
  gap: 1rem;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 1.25rem;
  background:
    linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(11, 17, 31, 0.96)),
    radial-gradient(circle at top left, rgba(49, 88, 255, 0.22), transparent 35%);
  box-shadow:
    0 20px 46px -28px rgba(2, 6, 23, 0.72),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
  color: rgba(248, 250, 252, 0.96);
  padding: 1.1rem 1.15rem;
}

.td-toolbar__quote {
  display: grid;
  gap: 0.65rem;
}

.td-toolbar__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(148, 163, 184, 0.82);
}

.td-toolbar__venue {
  color: rgba(165, 180, 252, 0.95);
}

.td-toolbar__eyebrow-dot {
  width: 0.35rem;
  height: 0.35rem;
  border-radius: 999px;
  background: rgba(45, 212, 191, 0.9);
  box-shadow: 0 0 16px rgba(45, 212, 191, 0.4);
}

.td-toolbar__headline {
  display: grid;
  gap: 0.85rem;
}

.td-toolbar__headline-copy {
  min-width: 0;
}

.td-toolbar__symbol {
  margin: 0;
  font-size: clamp(1.5rem, 2vw, 2rem);
  font-weight: 800;
  letter-spacing: -0.04em;
}

.td-toolbar__subcopy {
  margin: 0.35rem 0 0;
  max-width: 34rem;
  color: rgba(203, 213, 225, 0.88);
  font-size: 0.92rem;
  line-height: 1.55;
}

.td-toolbar__price-block {
  display: inline-flex;
  flex-direction: column;
  gap: 0.3rem;
}

.td-toolbar__price {
  margin: 0;
  font-family: var(--font-mono);
  font-size: clamp(1.35rem, 2vw, 1.85rem);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
}

.td-toolbar__change {
  margin: 0;
  font-size: 0.88rem;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.td-toolbar__change--up {
  color: rgba(74, 222, 128, 0.96);
}

.td-toolbar__change--down {
  color: rgba(248, 113, 113, 0.96);
}

.td-toolbar__change--flat {
  color: rgba(226, 232, 240, 0.92);
}

.td-toolbar__metrics {
  display: grid;
  gap: 0.75rem;
}

.td-toolbar__metric {
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 1rem;
  background: rgba(15, 23, 42, 0.62);
  padding: 0.8rem 0.9rem;
}

.td-toolbar__metric-label {
  margin: 0;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(148, 163, 184, 0.82);
}

.td-toolbar__metric-value {
  margin: 0.45rem 0 0;
  font-family: var(--font-mono);
  font-size: 0.98rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: rgba(248, 250, 252, 0.96);
}

.td-toolbar__controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.85rem;
  align-items: center;
}

.td-toolbar__toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.54);
  color: rgba(226, 232, 240, 0.94);
  cursor: pointer;
  font-size: 0.84rem;
  font-weight: 600;
  min-height: 2.75rem;
  padding: 0 0.95rem;
}

.td-toolbar__toggle input {
  accent-color: #4f46e5;
}

.td-toolbar__select-wrap {
  display: inline-flex;
  align-items: center;
  gap: 0.7rem;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.54);
  min-height: 2.75rem;
  padding: 0 0.45rem 0 0.95rem;
}

.td-toolbar__select-label {
  color: rgba(203, 213, 225, 0.88);
  font-size: 0.84rem;
  font-weight: 600;
}

.td-toolbar__select {
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(248, 250, 252, 0.96);
  font-size: 0.82rem;
  font-weight: 600;
  min-height: 2.15rem;
  padding: 0 0.8rem;
}

.td-toolbar__select:focus-visible {
  outline: 2px solid rgba(129, 140, 248, 0.86);
  outline-offset: 2px;
}

@media (min-width: 860px) {
  .td-toolbar {
    grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr);
    align-items: center;
  }

  .td-toolbar__headline {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
  }

  .td-toolbar__metrics {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .td-toolbar__controls {
    grid-column: 1 / -1;
    justify-content: flex-end;
  }
}
</style>
