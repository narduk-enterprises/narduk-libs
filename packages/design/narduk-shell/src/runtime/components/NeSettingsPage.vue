<script setup lang="ts">
/**
 * NeSettingsPage — a full settings screen: `NePageHeader` on top of a
 * `NeForm` whose save bar is sticky by default, so the save action stays
 * reachable on a page built from several `NeFormSection`s stacked below the
 * fold.
 *
 * This is composition, not new behaviour: every bug fix (double-submit,
 * honest dirty state, focus-on-error) lives in `NeForm` and is inherited
 * unchanged. `NeSettingsPage` only wires `NePageHeader`'s title/description
 * to the page and forces `NeForm`'s `stickySave` on, since a settings page is
 * the canonical "possibly long, definitely wants a reachable save button"
 * shape called out in docs/plans/components-library-plan.md §2 item 19.
 *
 * Components-library backlog item 19 (narduk-libs#266).
 */
import NeForm from './NeForm.vue'
import NePageHeader from './NePageHeader.vue'

import type { NeFormProps } from './NeForm.vue'

export interface NeSettingsPageProps {
  /** Forwarded to `NePageHeader`. */
  description?: string
  /** Forwarded to `NeForm`. */
  disabled?: boolean
  /** Forwarded to `NeForm`'s `onSubmit` prop. See `NeForm` for the full submit contract. */
  onSubmit?: NeFormProps['onSubmit']
  /** Forwarded to `NeForm`. */
  saveLabel?: string
  /** Forwarded to `NeForm`'s `schema` prop. */
  schema?: unknown
  /** Forwarded to `NeForm`'s `state` prop. Required — settings pages are always controlled. */
  state: Record<string, unknown>
  /** The page title, rendered by `NePageHeader`. */
  title: string
  /** Forwarded to `NeForm`'s `validate` prop. */
  validate?: (state: Record<string, unknown>) => unknown
}

withDefaults(defineProps<NeSettingsPageProps>(), {
  disabled: false,
  description: undefined,
  saveLabel: 'Save',
  schema: undefined,
  validate: undefined,
})

defineSlots<{
  /** Extra buttons in the save bar, rendered before the save button. */
  actions?(): unknown
  /** The page's fields — typically one or more `NeFormSection`s. */
  default?(): unknown
  /** Right-aligned actions next to the page title (distinct from the save bar's `actions`). */
  headerActions?(): unknown
}>()
</script>

<template>
  <div class="ne-settings-page space-y-6">
    <NePageHeader :title="title" :description="description">
      <template v-if="$slots.headerActions" #actions>
        <slot name="headerActions" />
      </template>
    </NePageHeader>

    <NeForm
      :disabled="disabled"
      :save-label="saveLabel"
      :schema="schema"
      :state="state"
      sticky-save
      :validate="validate"
      :on-submit="onSubmit"
    >
      <slot />

      <template v-if="$slots.actions" #actions>
        <slot name="actions" />
      </template>
    </NeForm>
  </div>
</template>
