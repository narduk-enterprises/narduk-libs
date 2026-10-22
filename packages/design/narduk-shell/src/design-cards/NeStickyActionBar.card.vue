<script setup lang="ts">
/*
 * NE Base design card for NeStickyActionBar.
 *
 * The bar is `position: fixed`, so the demonstration frame is given a
 * transform, which makes it the bar's containing block: the bar pins to the
 * bottom of the frame instead of the gallery's viewport. `phone-only` is off
 * here because the gallery is a desktop page.
 */
import NeStickyActionBar from '../runtime/components/NeStickyActionBar.vue'
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ne-sticky-action-bar"
    data-name="Sticky action bar"
    data-group="Shell"
  >
    <h2>Sticky action bar</h2>
    <p>
      The phone's bottom call to action. It clears the home indicator, and a spacer as tall as the
      bar keeps it from covering the last row of the page.
    </p>
    <div
      class="preview-row"
      style="
        position: relative;
        width: 22rem;
        height: 11rem;
        overflow: hidden;
        transform: translate(0);
        border: 1px solid var(--ne-hairline);
      "
    >
      <p style="margin: 0.75rem 1rem">Last row of the page</p>
      <NeStickyActionBar :phone-only="false" label="Trade actions">
        <button type="button" style="flex: 1; min-height: 2.75rem">Sell</button>
        <button type="button" style="flex: 1; min-height: 2.75rem">Buy</button>
      </NeStickyActionBar>
    </div>
  </section>
</template>
