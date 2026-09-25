<script setup lang="ts">
/**
 * NeSkipLink — "Skip to content" that actually moves keyboard focus
 * (narduk-libs#977).
 *
 * Apps hand-rolled this with Nuxt UI's link component and
 * `to="#main-content"`. That renders a RouterLink, whose click handler calls
 * preventDefault and `router.push`, so the page scrolled to the fragment but
 * focus never left the link, and the next Tab went back into the navigation
 * the link was meant to skip.
 *
 * This is a plain `<a href="#target">`, never a RouterLink, and it keeps the
 * browser's own fragment navigation — the hash, the scroll, back/forward —
 * exactly as it is. The one thing it adds is in the click handler, which
 * Enter on a focused anchor also fires: find the target, give it
 * `tabindex="-1"` if it has no tabindex of its own (a `<main>` is not
 * focusable otherwise, and `focus()` on it would do nothing), and focus it.
 * The click is never prevented; a modified click (a new tab or window) is
 * left to the browser untouched.
 *
 * Styling contract: tokens only, the same treatment `NeAppShell` gave its
 * inline skip link. Visually hidden until it has focus, then drawn over the
 * top-left corner of its positioned container.
 */
import { NE_MAIN_ID, type NeSkipLinkProps } from './ne-skip-link-types'

const props = withDefaults(defineProps<NeSkipLinkProps>(), {
  label: 'Skip to content',
  target: NE_MAIN_ID,
})

function onClick(event: MouseEvent) {
  // A click only ever happens in the browser; the guard says so to the SSR
  // lint and strips the handler body from the server bundle.
  if (!import.meta.client) return
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return
  }
  const element = document.getElementById(props.target)
  if (!element) {
    if (import.meta.dev) {
      console.warn(
        `[narduk-shell] NeSkipLink: no element has id ${JSON.stringify(props.target)}, so focus stays on the link. Put :id="NE_MAIN_ID" (or the link's target) on the page's main content.`,
      )
    }
    return
  }
  if (!element.hasAttribute('tabindex')) element.setAttribute('tabindex', '-1')
  element.focus()
}
</script>

<template>
  <a class="ne-skip-link" :href="`#${target}`" @click="onClick">{{ label }}</a>
</template>

<style scoped>
/*
 * Tokens only (README § Styling contract); the rest is layout. Hidden with a
 * clip rather than `display: none` or `visibility: hidden`, either of which
 * would take the link out of the Tab order.
 */
.ne-skip-link {
  position: absolute;
  top: 0.5rem;
  left: 0.5rem;
  z-index: 50;
  padding: 0.5rem 0.75rem;
  border-radius: var(--ne-radius-control);
  background-color: var(--ne-surface);
  color: var(--ne-ink);
  outline: 2px solid var(--ne-accent);
}

.ne-skip-link:not(:focus) {
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  white-space: nowrap;
  clip-path: inset(50%);
  outline: none;
}
</style>
