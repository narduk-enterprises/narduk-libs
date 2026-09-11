<script setup lang="ts">
/**
 * AppConfirmModal — Generic confirmation dialog.
 *
 * @deprecated Use `NeConfirmDialog` / `useConfirm()` from
 * `@narduk-enterprises/narduk-shell` instead (components backlog item 16,
 * narduk-libs#263). Deprecated 2026-09-11 under decision D4 and removed in the
 * next narduk-core major; behaviour is unchanged until then. A one-time
 * dev-only `console.warn` points at the replacement the first time this
 * component is used. The migration mapping — including `v-model` →
 * `v-model:open`, `confirmColor="error"` → `tone="danger"`, `loading` →
 * `pending`, and the default slot → `#body` — is in this package's README
 * under "Deprecations".
 *
 * Wraps UModal for "Are you sure?" patterns. Supports customizable title,
 * message, button labels, colors, and a loading state on the confirm button.
 *
 * Usage:
 *   <AppConfirmModal
 *     v-model="showDeleteModal"
 *     title="Delete invoice?"
 *     message="This action cannot be undone."
 *     confirm-label="Delete"
 *     confirm-color="error"
 *     :loading="isDeleting"
 *     @confirm="handleDelete"
 *   />
 */

import { warnAppConfirmModalDeprecated } from './appConfirmModalDeprecation'

type ConfirmColor = 'error' | 'info' | 'primary' | 'secondary' | 'success' | 'warning' | 'neutral'

const props = withDefaults(
  defineProps<{
    /** Cancel button label. */
    cancelLabel?: string
    /** Confirm button color. */
    confirmColor?: ConfirmColor
    /** Confirm button label. */
    confirmLabel?: string
    /** Whether the modal can be closed by clicking outside or pressing Escape. */
    dismissible?: boolean
    /** Icon shown next to the title. */
    icon?: string
    /** Whether the confirm button shows a loading spinner. */
    loading?: boolean
    /** Description text. */
    message?: string
    /** Modal title. */
    title?: string
  }>(),
  {
    title: 'Are you sure?',
    message: '',
    icon: 'i-lucide-alert-triangle',
    confirmLabel: 'Confirm',
    cancelLabel: 'Cancel',
    confirmColor: 'error',
    loading: false,
    dismissible: true,
  },
)

const emit = defineEmits<{
  cancel: []
  confirm: []
}>()

const modelValue = defineModel<boolean>({ default: false })

warnAppConfirmModalDeprecated()

const ICON_TONE_CLASSES: Record<ConfirmColor, string> = {
  error: 'bg-error/10 text-error',
  info: 'bg-info/10 text-info',
  neutral: 'bg-neutral/10 text-neutral',
  primary: 'bg-primary/10 text-primary',
  secondary: 'bg-secondary/10 text-secondary',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
}

const iconToneClass = computed(() => ICON_TONE_CLASSES[props.confirmColor])

/**
 * Emits 'confirm' and intentionally leaves the modal open, allowing the parent
 * to show a loading state (via :loading) and close the modal after the async
 * operation completes by setting v-model to false.
 */
function handleConfirm() {
  emit('confirm')
}

function handleCancel() {
  modelValue.value = false
  emit('cancel')
}
</script>

<template>
  <!-- eslint-disable-next-line narduk/no-unknown-component-prop -- dismissible and close are valid in Nuxt UI v4 -->
  <UModal v-model:open="modelValue" :dismissible="props.dismissible" :close="false">
    <template #header>
      <div class="flex items-start gap-3">
        <div
          v-if="props.icon"
          :class="iconToneClass"
          class="flex size-10 shrink-0 items-center justify-center rounded-full"
        >
          <!-- eslint-disable-next-line vuejs-accessibility/alt-text -- UIcon augments title; dialog header names the action -->
          <UIcon :name="props.icon" class="size-5" />
        </div>
        <div class="space-y-1">
          <h3 class="text-lg font-semibold text-default">{{ props.title }}</h3>
          <p v-if="props.message" class="text-sm text-muted">{{ props.message }}</p>
        </div>
      </div>
    </template>

    <div v-if="$slots.default" class="space-y-4">
      <slot />
    </div>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          color="neutral"
          variant="soft"
          :label="props.cancelLabel"
          :disabled="props.loading"
          @click="handleCancel"
        />
        <UButton
          :color="props.confirmColor"
          :label="props.confirmLabel"
          :loading="props.loading"
          @click="handleConfirm"
        />
      </div>
    </template>
  </UModal>
</template>
