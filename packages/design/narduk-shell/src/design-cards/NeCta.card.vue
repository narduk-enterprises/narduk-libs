<script setup lang="ts">
/*
 * NE Base design card for NeCta — components backlog item 21
 * (narduk-libs#268). The default outline panel and the solid one, both
 * rounded to `--ne-radius-panel`.
 */
import NeCta from '../runtime/components/NeCta.vue'
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ne-cta"
    data-name="Call to action"
    data-group="Marketing"
  >
    <h2>Call to action</h2>
    <p>
      <code>UPageCTA</code>, rounded to <code>--ne-radius-panel</code>. The title is an
      <code>&lt;h2&gt;</code>.
    </p>

    <div class="preview-row">
      <NeCta
        title="Need a quote?"
        description="Tell us what you need and we will find it fast."
        :links="[{ label: 'Get a quote' }]"
      />
      <p class="mono">outline (default)</p>
    </div>

    <div class="preview-row">
      <NeCta
        variant="solid"
        title="Need a quote?"
        description="Tell us what you need and we will find it fast."
        :links="[{ label: 'Get a quote', color: 'neutral' }]"
      />
      <p class="mono">solid · --ne-surface-inverted</p>
    </div>
  </section>
</template>
