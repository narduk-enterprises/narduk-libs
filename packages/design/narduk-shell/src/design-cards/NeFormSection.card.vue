<script setup lang="ts">
/*
 * NE Base design card for NeFormSection — components backlog item 19
 * (narduk-libs#266).
 *
 * Shown standalone (not nested in a NeForm) since the card's job is to prove
 * NeFormSection's own layout — the titled group and the actions slot — not
 * to re-demonstrate submission, which is NeForm's card.
 */
import NeFormSection from '../runtime/components/NeFormSection.vue'
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ne-form-section"
    data-name="Form section"
    data-group="Shell"
  >
    <h2>Form section</h2>
    <p>
      A titled group of fields inside a form. Purely presentational — validation stays with the
      enclosing NeForm's UForm.
    </p>
    <div class="preview-row">
      <NeFormSection title="Profile" description="Your public account details.">
        <p class="mono">Fields go here (typically UFormField + an input).</p>
      </NeFormSection>
    </div>
    <div class="preview-row">
      <NeFormSection title="Notifications">
        <template #actions>
          <span class="mono">Reset to defaults</span>
        </template>
        <p class="mono">Fields go here.</p>
      </NeFormSection>
    </div>
  </section>
</template>
