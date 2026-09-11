<script setup lang="ts">
import type { Component } from 'vue'
import {
  NsFreshnessChip,
  NsLevelWell,
  NsRangeBar,
  NsReadoutTile,
} from '@narduk-enterprises/narduk-ui/instruments'

/*
 * narduk-shell design cards are DISCOVERED, not authored here.
 *
 * The cards below for narduk-ui and Nuxt UI are hand-written sections, which
 * is why the plan's "every component ships an NE Base card" was the done-when
 * nothing enforced: the card lived in a different package from the component.
 * A narduk-shell component instead ships
 * `src/design-cards/<Name>.card.vue` next to itself, and this glob renders
 * every one of them (components backlog item 3, narduk-libs#250). The existing
 * hand-authored cards keep working untouched until item 22 migrates them.
 *
 * The path is relative rather than a package specifier on purpose: this
 * renderer is a private workspace tool, and narduk-shell's published `exports`
 * map stays the three subpaths item 1 fixed (`.`, `./format`, `./theme.css`).
 * A gallery is not a reason to grow a package's public surface. The
 * `workspace:*` devDependency in package.json is what states the build-time
 * relationship, so CI's affected-package graph reruns this package when
 * narduk-shell changes.
 *
 * `scripts/build.mts` fails the build when a registered component has no card,
 * when a card has no registered component, or when a card does not reach the
 * rendered output.
 */
const shellCards = Object.entries(
  import.meta.glob<{ default: Component }>('../../narduk-shell/src/design-cards/*.card.vue', {
    eager: true,
  }),
)
  .map(([path, module]) => ({
    name: path.slice(path.lastIndexOf('/') + 1, -'.card.vue'.length),
    component: module.default,
  }))
  .sort((first, second) => first.name.localeCompare(second.name))
</script>

<template>
  <main class="gallery">
    <header>
      <p class="mono">NARDUK ENTERPRISES / CODED SYSTEM</p>
      <h1>NE Base preview</h1>
      <p>Rendered from Vue components. Values below are fixed demonstration fixtures.</p>
    </header>
    <section
      class="preview-card"
      data-design-card="foundations"
      data-name="Ink, surfaces and type"
      data-group="Foundations"
    >
      <h2>Ink, surfaces and type</h2>
      <div class="preview-grid">
        <div class="swatch">Surface / --ns-surface</div>
        <div class="swatch paper">Paper / --ns-paper</div>
        <div class="swatch sunk">Sunk / --ns-sunk</div>
        <div class="swatch ink">Ink / --ns-ink</div>
      </div>
      <p>Language follows the coded sans-serif stack.</p>
      <p class="mono">Measured numbers: 47.2% · +0.3 ft / 24 h</p>
    </section>
    <section
      class="preview-card"
      data-design-card="freshness"
      data-name="Freshness states"
      data-group="Instruments"
    >
      <h2>Freshness states</h2>
      <div class="preview-row">
        <NsFreshnessChip state="live" />
        <NsFreshnessChip state="aging" />
        <NsFreshnessChip state="stale" />
        <NsFreshnessChip state="void" />
      </div>
    </section>
    <section
      class="preview-card"
      data-design-card="readouts"
      data-name="Readout tiles"
      data-group="Instruments"
    >
      <h2>Readout tiles</h2>
      <div class="preview-grid">
        <NsReadoutTile
          label="Water level"
          :value="681.2"
          unit="ft"
          :delta="0.3"
          delta-unit="ft"
          delta-window="24 h"
        />
        <NsReadoutTile label="Water level" :value="null" missing-reason="Gauge offline" />
      </div>
    </section>
    <section
      class="preview-card"
      data-design-card="ranges"
      data-name="Ranges with reference bands"
      data-group="Instruments"
    >
      <h2>Ranges with reference bands</h2>
      <div class="preview-grid">
        <NsRangeBar
          label="Conservation pool"
          :value="47.2"
          :band="{ low: 55, high: 88, label: 'seasonal normal' }"
          unit="%"
        />
        <NsRangeBar
          label="Conservation pool"
          :value="null"
          :band="{ low: 55, high: 88 }"
          missing-reason="Gauge offline"
        />
      </div>
    </section>
    <section
      class="preview-card"
      data-design-card="wells"
      data-name="Level wells and missing data"
      data-group="Instruments"
    >
      <h2>Level wells and missing data</h2>
      <div class="preview-wells">
        <NsLevelWell name="Observed" :value="47.2" :median="72" />
        <NsLevelWell name="Unavailable" :value="null" :median="72" missing-reason="Gauge offline" />
      </div>
    </section>
    <section
      class="preview-card"
      data-design-card="nuxt-ui"
      data-name="Nuxt UI baseline variants"
      data-group="Nuxt UI"
    >
      <h2>Nuxt UI baseline variants</h2>
      <p>
        Standard Nuxt UI fixtures with the gallery's explicit blue/slate configuration.
        Product-specific overrides are not asserted.
      </p>
      <div class="preview-row">
        <UButton label="Primary action" />
        <UButton label="Secondary action" variant="outline" />
        <UButton label="Disabled action" disabled />
        <UBadge label="Informational" variant="subtle" />
      </div>
      <div class="preview-row">
        <UInput model-value="Example station" aria-label="Station name" />
        <UInput placeholder="Unavailable" disabled aria-label="Disabled field" />
      </div>
      <UAlert
        title="Demonstration notice"
        description="This is a fixed preview fixture."
        variant="soft"
      />
    </section>
    <component :is="card.component" v-for="card in shellCards" :key="card.name" />
  </main>
</template>
