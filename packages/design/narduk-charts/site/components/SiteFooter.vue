<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <footer class="mt-16 border-t border-[var(--color-ns-border)] bg-[var(--color-ns-surface)] py-10">
    <div class="ns-container flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
      <p class="m-0 text-sm text-[var(--color-ns-muted)]">
        Vue 3 · TypeScript · SVG · Accessible components
      </p>
      <div class="flex flex-wrap gap-4 text-sm">
        <RouterLink
          to="/"
          class="font-medium text-[var(--color-ns-accent)] no-underline"
        >
          Home
        </RouterLink>
        <RouterLink
          to="/playground"
          class="font-medium text-[var(--color-ns-accent)] no-underline"
        >
          Playground
        </RouterLink>
        <a
          class="font-medium text-[var(--color-ns-accent)] no-underline"
          href="https://github.com/narduk-enterprises/narduk-charts"
          target="_blank"
          rel="noopener noreferrer"
        >
          Library
        </a>
        <a
          class="font-medium text-[var(--color-ns-accent)] no-underline"
          href="https://github.com/narduk-enterprises/charts"
          target="_blank"
          rel="noopener noreferrer"
        >
          Product site
        </a>
      </div>
    </div>
  </footer>
</template>
