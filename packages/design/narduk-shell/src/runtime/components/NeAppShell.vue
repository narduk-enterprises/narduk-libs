<script setup lang="ts">
/**
 * NeAppShell — the application frame: the sectioned left rail, a navbar row
 * and the page (components backlog item 18, narduk-libs#265; plan
 * docs/plans/components-library-plan.md §2 item 18).
 *
 * The default rail has labelled, expanded sections and a mobile drawer.
 * Desktop collapse and section disclosures are opt-in. Active state always
 * comes from the router, and arrow keys walk the visible navigation controls.
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
import UDashboardSidebarCollapse from '@nuxt/ui/components/DashboardSidebarCollapse.vue'
import UNavigationMenu from '@nuxt/ui/components/NavigationMenu.vue'
import { computed, ref, useId } from 'vue'

import { useNardukShellSections } from '../composables/use-narduk-shell-sections'

import NeSkipLink from './NeSkipLink.vue'

import type { NeAppShellItem, NeAppShellProps, NeAppShellSection } from './ne-app-shell-types'

const props = withDefaults(defineProps<NeAppShellProps>(), {
  collapsible: false,
  railWidth: 14.5,
  collapsedWidth: 4,
  navLabel: 'Main',
  sections: undefined,
  skipLinkLabel: 'Skip to content',
  variant: 'rail',
})

const slots = defineSlots<{
  /** Top of the navbar row, right side: search, page-level actions. */
  'navbar-right'?(): unknown
  /** Bottom of the rail: the user / account control. */
  'rail-bottom'?(props: { collapsed: boolean }): unknown
  /** Optional desktop collapse button; replaces the Nuxt UI default. */
  'rail-toggle'?(props: { collapsed: boolean; toggle: () => void }): unknown
  /** Top of the rail: the logo or app switcher. */
  'rail-top'?(props: { collapsed: boolean }): unknown
  /** The page. Rendered inside the shell's one `<main>` landmark. */
  default?(): unknown
  /** Top of the navbar row, left side: a breadcrumb, a page context line. */
  navbar?(): unknown
}>()

const collapsed = defineModel<boolean>('collapsed', { default: false })
const sectionOpen = ref<Record<string, boolean>>({})
function isSectionOpen(section: NeAppShellSection): boolean {
  return !section.collapsible || (sectionOpen.value[section.id] ?? section.defaultOpen !== false)
}
function toggleSection(section: NeAppShellSection) {
  sectionOpen.value[section.id] = !isSectionOpen(section)
}

const shared = useNardukShellSections()
const sections = computed<readonly NeAppShellSection[]>(() => props.sections ?? shared.value)

/** `UNavigationMenu`'s item shape. Only routing fields; no `active` input. */
function menuItem(item: NeAppShellItem) {
  return {
    badge: item.badge,
    exactQuery: item.exactQuery,
    icon: item.icon,
    iconSrc: item.iconSrc,
    slot: item.iconSrc ? 'asset' : undefined,
    label: item.label,
    to: item.to,
  }
}

function assetIcon(item: NeAppShellItem): string | undefined {
  return item.iconSrc
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
  const links = [
    ...rail.querySelectorAll<HTMLElement>('[data-slot="link"], [data-section-toggle]'),
  ].filter((element) => !element.closest('[hidden]'))
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
  <UDashboardGroup
    class="ne-app-shell"
    data-app-shell
    :data-variant="variant"
    unit="rem"
    :persistent="false"
  >
    <NeSkipLink class="ne-app-shell__skip" :target="mainId" :label="skipLinkLabel" />

    <UDashboardSidebar
      class="ne-app-shell__rail"
      mode="slideover"
      v-model:collapsed="collapsed"
      :default-size="railWidth"
      :min-size="railWidth"
      :max-size="railWidth"
      :collapsed-size="collapsedWidth"
      :resizable="false"
      :collapsible="collapsible"
    >
      <template
        v-if="$slots['rail-top'] || collapsible"
        #header="{ collapsed: railCollapsed, collapse }"
      >
        <div class="ne-app-shell__rail-top" data-ne-slot="rail-top">
          <slot name="rail-top" :collapsed="railCollapsed" />
          <slot
            v-if="collapsible"
            name="rail-toggle"
            :collapsed="railCollapsed"
            :toggle="() => collapse(!railCollapsed)"
          >
            <UDashboardSidebarCollapse />
          </slot>
        </div>
      </template>

      <!-- Sidebar slot state is always expanded inside the mobile drawer. -->
      <template #default="{ collapsed: railCollapsed }">
        <nav class="ne-app-shell__nav" :aria-label="navLabel" @keydown.capture="onRailKeydown">
          <div
            v-for="{ section, items } in menus"
            :key="section.id"
            class="ne-app-shell__section"
            role="group"
            :aria-label="section.label"
            :data-section="section.id"
          >
            <button
              v-if="section.collapsible && !railCollapsed"
              type="button"
              class="ne-app-shell__section-label ne-app-shell__section-toggle"
              data-section-toggle
              :aria-expanded="isSectionOpen(section)"
              @click="toggleSection(section)"
            >
              {{ section.label }}
            </button>
            <p
              v-else-if="!railCollapsed && !section.hideLabel"
              class="ne-app-shell__section-label"
              aria-hidden="true"
            >
              {{ section.label }}
            </p>
            <div :hidden="!railCollapsed && !isSectionOpen(section)">
              <UNavigationMenu
                as="div"
                orientation="vertical"
                :items="items"
                :collapsed="railCollapsed"
              >
                <template #asset-leading="{ item }">
                  <img :src="assetIcon(item)" alt="" class="ne-app-shell__asset-icon" />
                </template>
              </UNavigationMenu>
            </div>
          </div>
        </nav>
      </template>

      <template v-if="$slots['rail-bottom']" #footer="{ collapsed: railCollapsed }">
        <div class="ne-app-shell__rail-bottom" data-ne-slot="rail-bottom">
          <slot name="rail-bottom" :collapsed="railCollapsed" />
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
.ne-app-shell__asset-icon {
  width: 1.25rem;
  height: 1.25rem;
  flex-shrink: 0;
}

.ne-app-shell__section-toggle {
  display: block;
  width: 100%;
  text-align: start;
  cursor: pointer;
}

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
