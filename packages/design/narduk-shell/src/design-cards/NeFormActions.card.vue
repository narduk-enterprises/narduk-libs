<script setup lang="ts">
/*
 * NE Base design card for NeFormActions.
 *
 * Three rows: Cancel then the primary; a destructive action alone at the far
 * left; and the same row in a 20rem frame. The frame does not stack it: the
 * stack follows the viewport (below 40rem), so the last row only shows that the
 * row wraps before it overflows.
 */
import UButton from '@nuxt/ui/components/Button.vue'

import NeFormActions from '../runtime/components/NeFormActions.vue'
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ne-form-actions"
    data-name="Form actions"
    data-group="Shell"
  >
    <h2>Form actions</h2>
    <p>
      The one action row of a form or dialog: bottom right, the primary last, Cancel to its left, a
      destructive action alone at the far left. Below 40rem it stacks full width, primary on top.
    </p>
    <div class="preview-row">
      <NeFormActions>
        <UButton color="neutral" variant="ghost" label="Cancel" />
        <UButton label="Save changes" />
      </NeFormActions>
    </div>
    <div class="preview-row">
      <NeFormActions>
        <template #lead>
          <UButton color="error" variant="outline" label="Delete runner" />
        </template>
        <UButton color="neutral" variant="ghost" label="Cancel" />
        <UButton label="Save" />
      </NeFormActions>
    </div>
    <div class="preview-row" style="width: 20rem">
      <NeFormActions>
        <template #lead>
          <span class="mono">Unsaved changes</span>
        </template>
        <UButton color="neutral" variant="ghost" label="Cancel" />
        <UButton label="Save" />
      </NeFormActions>
    </div>
  </section>
</template>
