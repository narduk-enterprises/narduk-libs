<script setup lang="ts">
import NeStatementHero from '../runtime/components/NeStatementHero.vue'
</script>
<template>
  <section
    class="preview-card"
    data-design-card="ne-statement-hero"
    data-name="Statement hero"
    data-group="Hall of fame"
  >
    <h2>Statement hero</h2>
    <p>Extracted from a shipped design; sample data only.</p>

    <NeStatementHero
      eyebrow="Community radio · sample schedule"
      title="Miles Ahead, Miles Behind"
      description="A show and a local voice, right at the top of the page."
      :marker="{ state: 'stale', label: 'Station schedule', detail: 'Sample snapshot · 5–7:30 PM' }"
      :links="[{ label: 'See the sample schedule', to: '#schedule' }]"
    >
      <template #media>
        <figure class="border-l border-default p-6">
          <p class="font-mono text-[length:var(--ne-text-display)]">90.1 FM</p>
          <figcaption>Station frequency · KZFR source snapshot</figcaption>
        </figure>
      </template>
      <p id="schedule">Illustrative snapshot, not a live station status.</p>
    </NeStatementHero>
  </section>
</template>
