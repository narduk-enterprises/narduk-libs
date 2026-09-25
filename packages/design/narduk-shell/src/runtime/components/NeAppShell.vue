<script setup lang="ts">
/**
 * NeAppShell — the application frame: the sectioned left rail, a navbar row
 * and the page (components backlog item 18, narduk-libs#265; plan
 * docs/plans/components-library-plan.md §2 item 18).
 *
 * The rail is promoted from operator-portal's `app/layouts/default.vue`, the
 * reference implementation (plan decision D2), and keeps its four rules:
 *
 * 1. **Sections are labelled and always expanded.** Not a tree, not icon-only,
 *    and nothing on the desktop collapses. Each section is a `role="group"`
 *    named by its label; the rail is one `nav` landmark.
 * 2. **Active comes from the router.** Every item is a `to`, and the item that
 *    lights is the one the router matches against the current route — the
 *    link's own `RouterLink` active state, surfaced by `UNavigationMenu` as
 *    `data-active` and `aria-current="page"`. There is no `active` input.
 * 3. **The drawer exists only below the breakpoint.** At and above Nuxt UI's
 *    `lg` (1024px) the rail is a fixed-width column; below it the rail is
 *    hidden and the navbar's toggle opens the same rail in a slide-over.
 *    There is no icon-only mode at any width.
 * 4. **Arrow keys walk the rail.** ArrowDown / ArrowUp move focus to the
 *    next / previous link across section boundaries (wrapping), Home / End to
 *    the first / last. Every link stays in the Tab order: this is a faster
 *    path, not a roving tabindex.
 *
 * It wraps Nuxt UI's dashboard primitives rather than re-implementing them:
 * `UDashboardGroup` is the frame, `UDashboardSidebar` the rail and its mobile
 * slide-over, `UDashboardPanel` + `UDashboardNavbar` the content column, and
 * one `UNavigationMenu` per section the links. They are imported explicitly
 * from `@nuxt/ui/components/*`, the suite's standing choice (NePageHeader's
 * header explains it); under vitest `@nuxt/ui/vite` resolves their build-time
 * virtuals, so the tests render the real components.
 *
 * `variant` is `'rail'` and nothing else today (D3); see
 * `ne-app-shell-types.ts`.
 *
 * The skip link is `NeSkipLink` (narduk-libs#977), aimed at the shell's own
 * `<main>`, so activating it moves focus into the page rather than only
 * scrolling there.
 *
 * Styling contract: tokens only. The rail reads `--ne-accent` for the active
 * row's marker, and the section labels read the NE label type tokens.
 */
import UDashboardGroup from '@nuxt/ui/components/DashboardGroup.vue'
import UDashboardNavbar from '@nuxt/ui/components/DashboardNavbar.vue'
import UDashboardPanel from '@nuxt/ui/components/DashboardPanel.vue'
import UDashboardSidebar from '@nuxt/ui/components/DashboardSidebar.vue'
import UNavigationMenu from '@nuxt/ui/components/NavigationMenu.vue'
import { computed, useId } from 'vue'

import { useNardukShellSections } from '../composables/use-narduk-shell-sections'

import NeSkipLink from './NeSkipLink.vue'

import type { NeAppShellItem, NeAppShellProps, NeAppShellSection } from './ne-app-shell-types'

const props = withDefaults(defineProps<NeAppShellProps>(), {
  navLabel: 'Main',
  sections: undefined,
  skipLinkLabel: 'Skip to content',
  variant: 'rail',
})

const slots = defineSlots<{
  /** Top of the navbar row, right side: search, page-level actions. */
  'navbar-right'?(): unknown
  /** Bottom of the rail: the user / account control. */
  'rail-bottom'?(): unknown
  /** Top of the rail: the logo or app switcher. */
  'rail-top'?(): unknown
  /** The page. Rendered inside the shell's one `<main>` landmark. */
  default?(): unknown
  /** Top of the navbar row, left side: a breadcrumb, a page context line. */
  navbar?(): unknown
}>()

/**
 * The rail's width, in rem. operator-portal's rail is 232px
 * (`--op-rail-width`); 14.5rem is that at the default 16px root size and
 * scales with the reader's text size where a pixel width would not.
 */
const RAIL_WIDTH_REM = 14.5

const shared = useNardukShellSections()
const sections = computed<readonly NeAppShellSection[]>(() => props.sections ?? shared.value)

/** `UNavigationMenu`'s item shape. Only routing fields; no `active` input. */
function menuItem(item: NeAppShellItem) {
  return { badge: item.badge, icon: item.icon, label: item.label, to: item.to }
}

const menus = computed(() =>
  sections.value.map((section) => ({ section, items: section.items.map(menuItem) })),
)

const mainId = `${useId()}-main`

/**
 * With no navbar content, the navbar row exists only to carry the mobile
 * drawer toggle, so it is hidden at the breakpoint rather than drawn empty.
 * A function rather than a `computed`: slot presence is not reactive state.
 */
function navbarIsToggleOnly(): boolean {
  return !slots.navbar && !slots['navbar-right']
}

const RAIL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'End', 'Home'])

/**
 * Handled in the capture phase and stopped there: `UNavigationMenu`'s
 * vertical list is a reka-ui accordion whose items also listen for arrow keys,
 * and they would move focus a second time within one section. The rail walks
 * all sections as one list, so it owns these four keys outright.
 */
function onRailKeydown(event: KeyboardEvent) {
  if (!RAIL_KEYS.has(event.key)) return
  const rail = event.currentTarget as HTMLElement
  const links = [...rail.querySelectorAll<HTMLElement>('[data-slot="link"]')]
  const current = links.indexOf(event.target as HTMLElement)
  if (current === -1 || links.length === 0) return

  event.preventDefault()
  event.stopPropagation()

  let next: number
  if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = links.length - 1
  else next = (current + (event.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length
  links[next]?.focus()
}
</script>

<template>
  <UDashboardGroup class="ne-app-shell" :data-variant="variant" unit="rem" :persistent="false">
    <NeSkipLink class="ne-app-shell__skip" :target="mainId" :label="skipLinkLabel" />

    <UDashboardSidebar
      class="ne-app-shell__rail"
      mode="slideover"
      :default-size="RAIL_WIDTH_REM"
      :min-size="RAIL_WIDTH_REM"
      :max-size="RAIL_WIDTH_REM"
      :resizable="false"
      :collapsible="false"
    >
      <template v-if="$slots['rail-top']" #header>
        <div class="ne-app-shell__rail-top" data-ne-slot="rail-top">
          <slot name="rail-top" />
        </div>
      </template>

      <!-- Rendered twice by UDashboardSidebar: once in the desktop column and
           once in the mobile slide-over, which is only mounted while open.
           Groups are named with aria-label rather than aria-labelledby for
           that reason — two copies of one id would collide while both exist. -->
      <nav class="ne-app-shell__nav" :aria-label="navLabel" @keydown.capture="onRailKeydown">
        <div
          v-for="{ section, items } in menus"
          :key="section.id"
          class="ne-app-shell__section"
          role="group"
          :aria-label="section.label"
          :data-section="section.id"
        >
          <!-- The group already carries this text as its accessible name. -->
          <p class="ne-app-shell__section-label" aria-hidden="true">{{ section.label }}</p>
          <!-- Not in <ClientOnly>, on purpose: the rail must be in the
               server's first paint (test/NeAppShell.ssr.test.ts). The
               narduk/require-client-only-hydration-sensitive rule flags every
               UNavigationMenu for client-only state; here the only state is
               the active item, derived from the route, which is the same on
               the server and the client, and no item has children, so there is
               no accordion open state either. The one warning is recorded in
               lint-budget.json rather than disabled: this lint config does not
               honour eslint-disable comments inside <template>. -->
          <UNavigationMenu as="div" orientation="vertical" :items="items" />
        </div>
      </nav>

      <template v-if="$slots['rail-bottom']" #footer>
        <div class="ne-app-shell__rail-bottom" data-ne-slot="rail-bottom">
          <slot name="rail-bottom" />
        </div>
      </template>
    </UDashboardSidebar>

    <UDashboardPanel class="ne-app-shell__panel">
      <template #header>
        <UDashboardNavbar
          :class="[
            'ne-app-shell__navbar',
            { 'ne-app-shell__navbar--toggle-only': navbarIsToggleOnly() },
          ]"
        >
          <!-- Always an element, so UDashboardNavbar never falls back to its
               own <h1>: the page's heading belongs to the page (NePageHeader).
               An empty <slot /> alone would not do it — Vue renders a slot's
               fallback when the provided content is only comments. -->
          <template #left>
            <div class="ne-app-shell__navbar-left" data-ne-slot="navbar">
              <slot name="navbar" />
            </div>
          </template>
          <template #right>
            <div class="ne-app-shell__navbar-right" data-ne-slot="navbar-right">
              <slot name="navbar-right" />
            </div>
          </template>
        </UDashboardNavbar>
      </template>

      <template #body>
        <main :id="mainId" class="ne-app-shell__main" tabindex="-1">
          <slot />
        </main>
      </template>
    </UDashboardPanel>
  </UDashboardGroup>
</template>

<style scoped>
/*
 * Tokens only (README § Styling contract). Everything here reads an `--ne-*`
 * token or is layout; colour, radius, shadow and type size come from tokens.
 */
.ne-app-shell__nav {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.ne-app-shell__section-label {
  margin: 0 0 0.25rem;
  padding: 0 0.625rem;
  font-size: var(--ne-text-label);
  letter-spacing: var(--ne-tracking-label);
  text-transform: uppercase;
  color: var(--ne-ink-muted);
}

.ne-app-shell__rail-top,
.ne-app-shell__rail-bottom,
.ne-app-shell__navbar-left,
.ne-app-shell__navbar-right {
  display: flex;
  flex: 1;
  align-items: center;
  min-width: 0;
  gap: 0.5rem;
}

/*
 * The active row: Nuxt UI's pill already inks it; the marker at its start edge
 * is the brand accent, so the current page reads by position and shape as
 * well as by colour. Drawn here rather than with `UNavigationMenu`'s
 * `highlight`, which in a vertical menu only marks nested (child) items.
 * The link is already `position: relative`.
 */
.ne-app-shell__nav :deep([data-slot='link'][data-active])::after {
  content: '';
  position: absolute;
  inset-block: 0.25rem;
  inset-inline-start: 0;
  width: 2px;
  background-color: var(--ne-accent);
}

.ne-app-shell__nav :deep([data-slot='link'][data-active] [data-slot='linkLeadingIcon']) {
  color: var(--ne-accent);
}

.ne-app-shell__main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: inherit;
  min-width: 0;
}

.ne-app-shell__main:focus:not(:focus-visible) {
  outline: none;
}

/* Nuxt UI's `lg`: where the rail becomes a column and the toggle goes away. */
@media (min-width: 64rem) {
  .ne-app-shell :deep(.ne-app-shell__navbar--toggle-only) {
    display: none;
  }
}
</style>
