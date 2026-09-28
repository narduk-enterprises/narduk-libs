<script setup lang="ts">
withDefaults(
  defineProps<{
    body?: string
    busy?: boolean
    title: string
    variant: 'banner' | 'card' | 'toast' | 'toast-dark'
  }>(),
  {
    busy: false,
  },
)
</script>

<template>
  <div class="notice" :class="`notice--${variant}`" :role="variant === 'card' ? 'alert' : 'status'">
    <template v-if="variant === 'card'">
      <span class="icon" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M9 4 3 6.5V20l6-2.5 6 2.5 6-2.5V4l-6 2.5L9 4zM9 4v13.5M15 6.5V20M3 3l18 18"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </span>
      <h2 class="title">{{ title }}</h2>
      <p v-if="body" class="body">{{ body }}</p>
      <div class="actions"><slot /></div>
    </template>

    <template v-else-if="variant === 'banner'">
      <svg class="banner-icon" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 7v5l3 2M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <div class="text">
        <b class="title">{{ title }}</b>
        <span v-if="body" class="body">{{ body }}</span>
      </div>
      <div class="actions"><slot /></div>
    </template>

    <template v-else-if="variant === 'toast'">
      <span class="title">{{ title }}</span>
      <span v-if="busy" class="progress" aria-hidden="true" />
      <div class="actions"><slot /></div>
    </template>

    <template v-else>
      <span class="title">{{ title }}</span>
      <div class="actions"><slot /></div>
    </template>
  </div>
</template>

<style scoped>
.notice {
  box-sizing: border-box;
  border-radius: var(--mk-radius-panel);
  font-family: var(--mk-font-sans);
}
.title {
  margin: 0;
  font-weight: 600;
  color: var(--mk-ink);
}
.body {
  margin: 0;
  color: var(--mk-ink-2);
}

/* Card */
.notice--card {
  max-width: 480px;
  padding: 28px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  background: var(--mk-surface);
  box-shadow: var(--mk-elev-3);
}

.notice--card .icon {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--mk-void-soft);
  color: var(--mk-ink-2);
}

.notice--card .title {
  font-size: 22px;
  line-height: 28px;
}
.notice--card .body {
  font-size: 16px;
  line-height: 24px;
}

.notice--card .actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

/* Banner */
.notice--banner {
  padding: 12px 16px;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  background: var(--mk-notice);
  box-shadow: inset 0 0 0 1px var(--mk-notice-line);
}

.notice--banner .banner-icon {
  flex: none;
  margin-top: 1px;
  color: var(--mk-aging);
}

.notice--banner .text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.notice--banner .title {
  font-size: 15px;
  line-height: 20px;
}
.notice--banner .body {
  font-size: 14px;
  line-height: 20px;
}

/* Toast (loading) */
.notice--toast {
  padding: 12px 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--mk-surface);
  box-shadow: var(--mk-elev-2);
}

.notice--toast .title {
  font-size: 15px;
  color: var(--mk-ink-strong);
}

.notice--toast .progress {
  position: relative;
  display: block;
  height: 4px;
  overflow: hidden;
  border-radius: 2px;
  background: var(--mk-line-faint);
}

.notice--toast .progress::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: -40%;
  width: 40%;
  border-radius: 2px;
  background: var(--mk-accent-strong);
  animation: mapkit-notice-slide 1.3s ease-in-out infinite;
}

@keyframes mapkit-notice-slide {
  from {
    left: -40%;
  }
  to {
    left: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .notice--toast .progress::after {
    animation: none;
    left: 0;
    width: 100%;
    opacity: 0.5;
  }
}

/* Toast dark (empty result) */
.notice--toast-dark {
  height: 52px;
  padding: 4px 4px 4px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--mk-ink-strong);
  box-shadow: 0 10px 20px -12px rgb(14 20 24 / 0.5);
}

.notice--toast-dark .title {
  font-weight: 600;
  font-size: 15px;
  color: var(--mk-surface);
  white-space: nowrap;
}

.notice--toast-dark .actions {
  display: contents;
}

/* Slotted actions */
.notice :slotted(.primary),
.notice :slotted(.secondary) {
  height: 44px;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 16px;
  border: 0;
  border-radius: var(--mk-radius-control);
  font-family: var(--mk-font-sans);
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  white-space: nowrap;
}

.notice :slotted(.secondary) {
  background: var(--mk-surface);
  color: var(--mk-ink-strong);
  box-shadow:
    inset 0 0 0 1px var(--mk-line),
    0 1px 2px rgb(14 20 24 / 0.05);
}

.notice :slotted(.secondary):hover {
  background: var(--mk-surface-hover);
}

.notice :slotted(.primary) {
  background: var(--mk-accent-strong);
  color: var(--mk-surface);
  box-shadow: 0 1px 2px rgb(14 20 24 / 0.12);
}

.notice :slotted(.primary):hover {
  background: var(--mk-accent);
}

.notice--toast-dark :slotted(.primary) {
  background: rgb(255 255 255 / 0.12);
  color: var(--mk-surface);
  box-shadow: none;
  padding: 0 14px;
}

.notice--toast-dark :slotted(.primary):hover {
  background: rgb(255 255 255 / 0.2);
}
</style>
