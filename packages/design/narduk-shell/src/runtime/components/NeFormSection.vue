<script setup lang="ts">
/**
 * NeFormSection — a titled group of fields inside a `NeForm`.
 *
 * A thin wrapper around `NeSectionHeader` (title/description/actions) plus a
 * fields slot below it. It renders no `<form>` of its own and does not touch
 * validation or submission — those stay owned by the enclosing `NeForm`'s
 * `UForm`. Splitting sections is purely presentational: `UForm` validates
 * against the whole `state`/`schema` regardless of how the fields inside it
 * are grouped visually.
 *
 * Components-library backlog item 19 (narduk-libs#266); plan
 * docs/plans/components-library-plan.md §2 item 19.
 */
import NeSectionHeader from './NeSectionHeader.vue'

export interface NeFormSectionProps {
  /**
   * The heading tag for the section title. Default `'h3'` — one level below
   * `NeSettingsPage`'s own `h1` and a typical `NeSectionHeader`'s `h2`, since
   * a form section usually nests under a page that already has its own
   * section-level heading.
   */
  as?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
  /** Supporting copy shown below the title. */
  description?: string
  /** The section title. */
  title: string
}

withDefaults(defineProps<NeFormSectionProps>(), {
  as: 'h3',
  description: undefined,
})

defineSlots<{
  /** Right-aligned actions next to the section title. */
  actions?(): unknown
  /** The section's fields — typically one or more `UFormField`s. */
  default?(): unknown
}>()
</script>

<template>
  <section class="ne-form-section space-y-4">
    <NeSectionHeader :as="as" :title="title" :description="description">
      <template v-if="$slots.actions" #actions>
        <slot name="actions" />
      </template>
    </NeSectionHeader>

    <div class="ne-form-section__fields space-y-4">
      <slot />
    </div>
  </section>
</template>
