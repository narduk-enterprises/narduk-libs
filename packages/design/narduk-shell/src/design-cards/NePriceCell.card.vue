<script setup lang="ts">
/*
 * NE Base design card for NePriceCell.
 *
 * The point of the card is the column on the right of each pair being the same
 * width whatever its digits: a reserved `ch` width, tabular figures, and a tint
 * that changes colour only. The unreported row draws the suite's hatch in the
 * same slot, never a blank or a zero.
 */
import NePriceCell from '../runtime/components/NePriceCell.vue'

const prices = [9.99, 100.01, 1234.5, 11111.11, 88888.88]
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ne-price-cell"
    data-name="Price cell"
    data-group="Shell"
  >
    <h2>Price cell</h2>
    <p>
      Reserved width in <code>ch</code>, tabular figures, and a tint that changes colour only — a
      ticking price never moves its neighbours.
    </p>
    <div v-for="price in prices" :key="price" class="preview-row">
      <NePriceCell :value="price" kind="money" currency="USD" :digits="2" :chars="10" />
    </div>
    <div class="preview-row">
      <NePriceCell :value="1.2" kind="money" currency="USD" :digits="2" signed tint="sign" />
      <NePriceCell :value="-0.4" kind="money" currency="USD" :digits="2" signed tint="sign" />
      <NePriceCell :value="0" kind="money" currency="USD" :digits="2" signed tint="sign" />
    </div>
    <div class="preview-row">
      <NePriceCell :value="0.0123" kind="percent" signed tint="sign" />
      <NePriceCell :value="-0.0456" kind="percent" signed tint="sign" />
    </div>
    <div class="preview-row">
      <NePriceCell :value="null" label="Last price" :chars="10" />
    </div>
  </section>
</template>
