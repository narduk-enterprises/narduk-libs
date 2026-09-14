<script setup lang="ts">
/*
 * NE Base design card — TEMPLATE. Copy me.
 *
 *   cp src/design-cards/template/NeExample.card.vue \
 *      src/design-cards/NeStatePanel.card.vue
 *
 * Then: import your component, render it in its representative states, and set
 * `data-design-card` to the kebab-case of the component's registered name
 * (`NeStatePanel` -> `ne-state-panel`). Nothing else registers the card —
 * design-system-build discovers every `src/design-cards/*.card.vue` and renders
 * it into NE Base, and `test/design-cards.test.ts` fails if a registered
 * component has no card or a card has no registered component.
 *
 * Import the component explicitly, like this:
 *
 *   import NeStatePanel from '../runtime/components/NeStatePanel.vue'
 *
 * The renderer mounts this file directly, outside the Nuxt module, so the
 * module's `addComponent` registration does not apply there. An unimported
 * component is also an `vue/no-undef-components` lint failure here.
 *
 * This directory (`template/`) is deliberately NOT discovered: only
 * `src/design-cards/*.card.vue` at the top level becomes a card. The file still
 * lints, typechecks and server-renders in CI, so the thing you copy is known to
 * work.
 */

/** One row per state the card shows. Replace with your component's states. */
const states = ['default', 'loading', 'empty'] as const
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ne-example"
    data-name="Example component"
    data-group="Shell"
  >
    <h2>Example component</h2>
    <p>
      One card per component, showing the states a reviewer has to be able to see: the ordinary one,
      the busy one, and whatever this component does when it has nothing to show.
    </p>
    <div v-for="state in states" :key="state" class="preview-row">
      <!-- Replace this placeholder with the component, e.g.
           <NeStatePanel :state="state" title="Example" /> -->
      <p class="mono">{{ state }}</p>
    </div>
  </section>
</template>
