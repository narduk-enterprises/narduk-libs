<script setup lang="ts">
defineProps<{
  icon: string
  label: string
  pressed: boolean
  variant: 'bar' | 'chips'
}>()

const emit = defineEmits<{
  click: []
  keydown: [event: KeyboardEvent]
}>()
</script>

<template>
  <button
    type="button"
    class="option"
    :class="`option--${variant}`"
    :aria-pressed="pressed"
    @click="emit('click')"
    @keydown="emit('keydown', $event)"
  >
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        :d="icon"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
    <span>{{ label }}</span>
  </button>
</template>

<style scoped>
.option {
  position: relative;
  flex: none;
  height: 44px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 0 14px 0 12px;
  border: 0;
  border-radius: var(--mk-radius-control);
  background: transparent;
  font-family: var(--mk-font-sans);
  font-size: 15px;
  font-weight: 600;
  color: var(--mk-ink-2);
  cursor: pointer;
  white-space: nowrap;
  transition:
    background-color 0.12s ease,
    color 0.12s ease;
}

.option svg {
  flex: none;
}

.option--bar:hover {
  background: var(--mk-surface-sunken);
  color: var(--mk-ink);
}

.option--bar[aria-pressed='true'] {
  background: var(--mk-ink-strong);
  color: var(--mk-surface);
}

.option--chips {
  border-radius: 999px;
  background: var(--mk-surface);
  box-shadow: var(--mk-elev-2);
  scroll-snap-align: start;
  color: var(--mk-ink-strong);
}

.option--chips[aria-pressed='true'] {
  background: var(--mk-ink-strong);
  color: var(--mk-surface);
  box-shadow:
    0 1px 2px rgb(14 20 24 / 0.2),
    0 10px 20px -12px rgb(14 20 24 / 0.4);
}

@media (prefers-reduced-motion: reduce) {
  .option {
    transition: none;
  }
}
</style>
