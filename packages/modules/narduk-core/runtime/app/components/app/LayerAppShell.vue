<script setup lang="ts">
/**
 * A highly configurable application shell that provides the default layout structure.
 * Wraps content in a Nuxt UI <UApp> and provides slots for the header, main content, and footer.
 *
 * @deprecated Use `NeAppShell` from `@narduk-enterprises/narduk-shell`
 * instead (components backlog item 18, narduk-libs#265). Deprecated
 * 2026-09-25 under decision D4 and removed in the next narduk-core major;
 * behaviour is unchanged until then. No runtime warning: narduk-core's own
 * `app.vue` renders it, so a warning would fire in apps that never chose
 * this component. The migration mapping is in this package's README under
 * "Deprecated components".
 */
</script>

<template>
  <UApp>
    <ULink
      to="#main-content"
      class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-100 focus:px-4 focus:py-2 focus:bg-primary focus:text-white focus:rounded-lg"
    >
      Skip to content
    </ULink>

    <div class="app-shell min-h-screen flex flex-col">
      <!-- Header slot -->
      <slot name="header"></slot>

      <!-- Main content -->
      <!-- eslint-disable-next-line vue/no-restricted-html-elements -- layer scaffold: semantic landmark element -->
      <main id="main-content" class="flex-1">
        <slot></slot>
      </main>

      <!-- Footer slot -->
      <slot name="footer"></slot>
    </div>
  </UApp>
</template>
