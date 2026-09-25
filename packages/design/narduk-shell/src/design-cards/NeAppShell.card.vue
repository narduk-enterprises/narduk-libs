<script setup lang="ts">
/*
 * NE Base design card for NeAppShell — components backlog item 18
 * (narduk-libs#265).
 *
 * The shell is a whole-page frame (`UDashboardGroup` is `position: fixed;
 * inset: 0`), so the preview puts it in a bounded frame whose `transform`
 * makes it the containing block for that `fixed`; without it the card would
 * cover the gallery.
 *
 * Routing. Every rail item is a `to`, and the active row is whichever one the
 * router matches. `test/design-cards.test.ts` server-renders this card with no
 * router installed, so the card provides its own: a memory router whose
 * current location is `/runners`. That is what Nuxt UI's Vue-mode links
 * inject. In the prerendered gallery Nuxt's own link resolves instead, against
 * the gallery's page, so the active row there is whichever item matches it.
 */
import { provide } from 'vue'
import {
  createMemoryHistory,
  createRouter,
  routeLocationKey,
  type RouteLocationNormalizedLoaded,
  routerKey,
} from 'vue-router'

import NeAppShell from '../runtime/components/NeAppShell.vue'

import type { NeAppShellSection } from '../runtime/components/ne-app-shell-types'

const sections: NeAppShellSection[] = [
  {
    id: 'operate',
    label: 'Operate',
    items: [
      { label: 'Overview', to: '/', icon: 'i-lucide-layout-dashboard' },
      { label: 'Runners', to: '/runners', icon: 'i-lucide-server', badge: 3 },
      { label: 'Deploys', to: '/deploys', icon: 'i-lucide-rocket' },
    ],
  },
  {
    id: 'infrastructure',
    label: 'Infrastructure',
    items: [
      { label: 'Hosts', to: '/hosts', icon: 'i-lucide-hard-drive' },
      { label: 'Networks', to: '/networks', icon: 'i-lucide-network' },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    items: [{ label: 'Access', to: '/settings/access', icon: 'i-lucide-key-round' }],
  },
]

const router = createRouter({
  history: createMemoryHistory(),
  routes: sections
    .flatMap((section) => section.items)
    .map((item) => ({ path: item.to, component: { render: () => null } })),
})

provide(routerKey, router)
// A resolved location is what the router would load for this path; the card
// renders synchronously, so it provides that rather than awaiting a push.
provide(routeLocationKey, router.resolve('/runners') as RouteLocationNormalizedLoaded)
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ne-app-shell"
    data-name="App shell"
    data-group="Shell"
  >
    <h2>App shell</h2>
    <p>
      The application frame: a rail of labelled, always-expanded sections, a navbar row and the
      page. The active row is the one the router matches; the arrow keys walk the rail; below
      <code>lg</code> the rail becomes a drawer. Opt-in: an app writes it in its own layout.
    </p>
    <div class="preview-row">
      <div
        style="
          position: relative;
          width: 100%;
          height: 26rem;
          overflow: hidden;
          transform: translateZ(0);
        "
      >
        <NeAppShell :sections="sections" nav-label="Portal">
          <template #rail-top>
            <strong>Operator</strong>
          </template>
          <template #rail-bottom>
            <span>logan@example.com</span>
          </template>
          <template #navbar>
            <span>Operate / Runners</span>
          </template>
          <p>The page renders here, inside the shell's one <code>&lt;main&gt;</code>.</p>
        </NeAppShell>
      </div>
    </div>
  </section>
</template>
