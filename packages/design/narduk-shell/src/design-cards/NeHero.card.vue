<script setup lang="ts">
/*
 * NE Base design card for NeHero — components backlog item 21
 * (narduk-libs#268). Both orientations, so a reviewer sees the centred hero
 * and the text-beside-media one. Buttons carry no `to`: the card is
 * prerendered outside any router, and a `UButton` without `to` renders a
 * plain button that looks the same.
 */
import NeHero from '../runtime/components/NeHero.vue'
</script>

<template>
  <section class="preview-card" data-design-card="ne-hero" data-name="Hero" data-group="Marketing">
    <h2>Hero</h2>
    <p>
      The top of a landing page, over <code>UPageHero</code>. The headline reads
      <code>--ne-accent</code>; the title is the page's one <code>&lt;h1&gt;</code>.
    </p>

    <div class="preview-row">
      <NeHero
        headline="Equipment"
        title="Circuit breakers that ship today"
        description="Load-tested breakers from every major manufacturer, in stock and on the truck by 3pm."
        :links="[
          { label: 'Browse the catalog' },
          { label: 'Request a quote', color: 'neutral', variant: 'outline' },
        ]"
      />
      <p class="mono">vertical · headline · two links</p>
    </div>

    <div class="preview-row">
      <NeHero
        orientation="horizontal"
        headline="New stock"
        title="Molded-case breakers"
        description="Frames from 15 A to 2500 A, tested before they leave the shop."
        :links="[{ label: 'See the range' }]"
      >
        <div class="mono">media slot</div>
      </NeHero>
      <p class="mono">horizontal · default slot beside the text</p>
    </div>
  </section>
</template>
