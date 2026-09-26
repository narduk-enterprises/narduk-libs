<script setup lang="ts">
/**
 * NeAdminEditPage — create or edit one record on an admin screen
 * (components backlog item 20, narduk-libs#267).
 *
 * `NePageHeader` over a `NeForm` whose save bar is sticky by default and
 * carries a cancel action, gated by `NeStatePanel` while the record being
 * edited is still loading or failed to load. Composition, not new
 * behaviour: every `NeForm` fix (one submit per click, dirty state that only
 * clears on success, focus on the first invalid field) is inherited
 * unchanged — the same relationship `NeSettingsPage` has with `NeForm`.
 *
 * The gate is the point of the panel: a form rendered over a record that
 * has not arrived yet is a form of blank fields that saves blanks. With
 * `status` bound, the form does not exist until the read has succeeded.
 *
 * Cancel is a real link when `cancelTo` is given (back to the detail page,
 * middle-clickable) and a plain `type="button"` calling `onCancel`
 * otherwise, so it can never submit the form it sits in.
 */
import UButton from '@nuxt/ui/components/Button.vue'
import { computed } from 'vue'

import NeForm from './NeForm.vue'
import NePageHeader from './NePageHeader.vue'
import NeStatePanel from './NeStatePanel.vue'

import type { NeAsyncDataStatus, NeStateValue } from '../types'
import type { NeAdminEditPageProps } from './ne-admin-page-types'

const props = withDefaults(defineProps<NeAdminEditPageProps>(), {
  breadcrumbs: undefined,
  cancelLabel: 'Cancel',
  cancelTo: undefined,
  description: undefined,
  disabled: false,
  emptyMessage: '',
  emptyTitle: '',
  errorMessage: '',
  errorTitle: '',
  eyebrow: undefined,
  loadingMessage: '',
  loadingTitle: '',
  onCancel: undefined,
  onSubmit: undefined,
  panelState: undefined,
  saveLabel: 'Save',
  schema: undefined,
  status: undefined,
  stickySave: true,
  validate: undefined,
})

defineSlots<{
  /** Extra buttons in the save bar, before cancel and save. */
  actions?(): unknown
  /** The form's fields — typically one or more `NeFormSection`s. */
  default?(): unknown
  /** Right-aligned actions next to the page title (distinct from the save bar's `actions`). */
  headerActions?(): unknown
}>()

/** `NeStatePanel`'s own status mapping, so the page knows when it is showing one. */
const STATUS_STATE: Readonly<Record<NeAsyncDataStatus, NeStateValue | undefined>> = {
  error: 'error',
  idle: 'loading',
  pending: 'loading',
  success: undefined,
}

const reading = computed<NeStateValue | undefined>(() =>
  props.panelState ? props.panelState : props.status ? STATUS_STATE[props.status] : undefined,
)

const panelTitle = computed(() => {
  if (reading.value === 'loading') return props.loadingTitle
  if (reading.value === 'error') return props.errorTitle
  if (reading.value === 'empty') return props.emptyTitle
  return ''
})

const panelMessage = computed(() => {
  if (reading.value === 'loading') return props.loadingMessage
  if (reading.value === 'error') return props.errorMessage
  if (reading.value === 'empty') return props.emptyMessage
  return ''
})

const hasCancel = computed(() => props.cancelTo !== undefined || Boolean(props.onCancel))

function cancel(): void {
  if (props.cancelTo === undefined) props.onCancel?.()
}
</script>

<template>
  <div data-ne-admin-edit-page class="ne-admin-edit-page min-w-0 space-y-6">
    <NePageHeader
      :title="title"
      :description="description"
      :eyebrow="eyebrow"
      :breadcrumbs="breadcrumbs"
    >
      <template v-if="$slots.headerActions" #actions>
        <slot name="headerActions" />
      </template>
    </NePageHeader>

    <NeStatePanel :state="reading" :title="panelTitle" :message="panelMessage">
      <NeForm
        :disabled="disabled"
        :save-label="saveLabel"
        :schema="schema"
        :state="state"
        :sticky-save="stickySave"
        :validate="validate"
        :on-submit="onSubmit"
      >
        <slot />

        <template v-if="$slots.actions || hasCancel" #actions>
          <slot name="actions" />
          <UButton
            v-if="hasCancel"
            data-ne-admin-cancel
            type="button"
            color="neutral"
            variant="ghost"
            :label="cancelLabel"
            :to="cancelTo"
            @click="cancel"
          />
        </template>
      </NeForm>
    </NeStatePanel>
  </div>
</template>
