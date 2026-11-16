<script setup lang="ts">
/**
 * NeFormActions — the one action row of a form or dialog (`docs/DESIGN.md`,
 * "Form actions").
 *
 * One row at the bottom of the form, right-aligned to the form's edge. Write
 * the buttons in reading order: Cancel and any other secondary first, the
 * primary LAST, so the primary is rightmost. A destructive action, or a note
 * about the row ("Unsaved changes"), goes in `#lead` and is pinned to the far
 * left, away from the primary.
 *
 * Below `sm` (40rem) the row stacks full width with the primary on top: the row
 * is reversed, so the last button in the source is the first one a thumb meets,
 * and `#lead` comes last.
 *
 * The row does not choose a button's look. The primary is a solid `UButton`,
 * Cancel a quiet one (`color="neutral"` with `variant="ghost"` or `"outline"`),
 * a destructive action `color="error"`. Enter is the form's: make the primary
 * `type="submit"` inside the `<form>`, or give it `form="id"` when the row sits
 * in a dialog's footer outside the form element.
 *
 * Styling contract: layout only, no colour. A class on the component lands on
 * the row, so a caller adds its own border, padding or `sticky`.
 */
defineSlots<{
  /** Cancel and other secondaries first, the primary last. */
  default?(): unknown
  /** A destructive action or a note about the row: far left, and last on a phone. */
  lead?(): unknown
}>()
</script>

<template>
  <div class="ne-form-actions" data-ne-form-actions>
    <div v-if="$slots.lead" class="ne-form-actions__lead">
      <slot name="lead" />
    </div>
    <slot />
  </div>
</template>

<style scoped>
.ne-form-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
  width: 100%;
}

.ne-form-actions__lead {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  margin-inline-end: auto;
}

/* Below Tailwind's `sm`: full width, stacked, the primary (last in the source) on top. */
@media (width < 40rem) {
  .ne-form-actions {
    flex-direction: column-reverse;
    flex-wrap: nowrap;
    align-items: stretch;
  }

  .ne-form-actions__lead {
    flex-direction: column;
    align-items: stretch;
    margin-inline-end: 0;
  }

  .ne-form-actions > :deep(:where(button, a)),
  .ne-form-actions__lead > :deep(:where(button, a)) {
    width: 100%;
    justify-content: center;
  }
}
</style>
