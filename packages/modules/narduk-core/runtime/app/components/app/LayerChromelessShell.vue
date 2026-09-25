<script setup lang="ts">
/**
 * Viewport-sized wrapper for layouts used under `LayerAppShell` (e.g. auth,
 * blank). Does not add UApp, skip link, or `<main>` — those come from the root
 * shell so nested layouts do not duplicate landmarks or `#main-content`.
 *
 * @deprecated Use `NeAppShell` from `@narduk-enterprises/narduk-shell`
 * instead (components backlog item 18, narduk-libs#265). Deprecated
 * 2026-09-25 under decision D4 and removed in the next narduk-core major;
 * behaviour is unchanged until then. No runtime warning: narduk-auth's own
 * `auth` and `blank` layouts render it, so a warning would fire in apps that
 * never chose this component. The migration mapping is in this package's
 * README under "Deprecated components".
 */
</script>

<template>
  <div class="min-h-dvh w-full">
    <slot />
  </div>
</template>
