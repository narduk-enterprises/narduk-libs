<script setup lang="ts">
/**
 * NeConfirmDialog — the suite's "are you sure?" dialog (components backlog
 * item 16, narduk-libs#263).
 *
 * It wraps Nuxt UI's `UModal`, which is Reka UI's `Dialog` underneath. The
 * containment that operator-portal#134 was filed about — a declared
 * `aria-modal` with Tab not trapped — is Reka's `FocusScope` (`trapped` while
 * open, `loop` at both ends) plus the `aria-hidden` it puts on everything
 * outside the dialog. This component does not re-implement any of that; what
 * it adds is the confirm/cancel contract, the pending rules, the tone, and the
 * initial-focus choice.
 *
 * `aria-modal="true"` is declared here rather than by Reka, which relies on the
 * outside `aria-hidden` alone. The claim is backed in this case: the trap is
 * real, and `test/ne-confirm-dialog.test.ts` asserts both halves together so
 * the attribute can never outlive the behaviour.
 */
import UButton from '@nuxt/ui/components/Button.vue'
import UModal, { type ModalProps } from '@nuxt/ui/components/Modal.vue'
import { computed, nextTick, ref } from 'vue'

import type { NeConfirmDialogProps } from './ne-confirm-dialog-types'

const props = withDefaults(defineProps<NeConfirmDialogProps>(), {
  title: 'Are you sure?',
  message: '',
  confirmLabel: 'Confirm',
  cancelLabel: 'Cancel',
  tone: 'default',
  pending: false,
  error: '',
  body: undefined,
  props: undefined,
})

const emit = defineEmits<{
  /** Forwarded from `UModal` so `useOverlay` can unmount a closed overlay. */
  'after:leave': []
  /** Cancel button, Escape, or an outside click. The dialog is already closing. */
  cancel: []
  /**
   * The overlay result. `useOverlay` resolves `open()`'s promise with this
   * value, which is what makes `useConfirm()` awaitable.
   */
  close: [result: boolean]
  /** The confirm button was pressed. The dialog deliberately stays open. */
  confirm: []
}>()

const slots = defineSlots<{
  /** Rich body content. Rendered after the `body` component, if both are given. */
  body?: () => unknown
}>()

const open = defineModel<boolean>('open', { default: false })

const footerElement = ref<HTMLElement | null>(null)

const hasBody = computed(() => Boolean(props.body) || Boolean(slots.body) || Boolean(props.error))

/**
 * Initial focus is the least destructive button: Cancel for `tone="danger"`,
 * Confirm otherwise. Reka focuses the first tabbable child by default, which
 * would put a destructive action one Return press away.
 */
function focusInitialTarget() {
  const selector =
    props.tone === 'danger' ? '[data-ne-confirm-cancel]' : '[data-ne-confirm-confirm]'
  const button = footerElement.value?.querySelector<HTMLElement>(selector)
  // Falling back to the dialog itself matters: the default focus was already
  // prevented, so without this a missing button would leave focus outside the
  // trap — the exact failure operator-portal#134 describes.
  const fallback = footerElement.value?.closest<HTMLElement>('[role="dialog"]')
  ;(button ?? fallback)?.focus()
}

function onOpenAutoFocus(event: Event) {
  event.preventDefault()
  void nextTick(focusInitialTarget)
}

const contentProps = computed(() => {
  const content: Record<string, unknown> = {
    'aria-modal': 'true',
    onOpenAutoFocus,
  }
  // Reka always points `aria-describedby` at its description id. With no
  // message there is no description element, and a dangling reference is worse
  // than none, so drop the attribute instead.
  if (!props.message) content['aria-describedby'] = undefined
  return content as ModalProps['content']
})

function cancel() {
  if (props.pending) return
  open.value = false
  emit('cancel')
  emit('close', false)
}

/**
 * Confirming does NOT close the dialog. The owner decides: `useConfirm()`
 * closes it (or holds it open through an async `onConfirm`), and a declarative
 * caller sets `v-model:open` itself once its work is done. This is the same
 * contract narduk-core's `AppConfirmModal` and stonx's `CommonConfirmModal`
 * already have, so adopting the suite is not a behaviour change.
 */
function confirm() {
  if (props.pending) return
  emit('confirm')
}

function onUpdateOpen(value: boolean) {
  if (value) {
    open.value = true
    return
  }
  // Escape, an outside click, or any other Reka dismissal. `dismissible` is
  // already false while pending, so this cannot fire mid-flight.
  cancel()
}
</script>

<template>
  <UModal
    :open="open"
    :title="props.title"
    :description="props.message || undefined"
    :dismissible="!props.pending"
    :close="false"
    :content="contentProps"
    @update:open="onUpdateOpen"
    @after:leave="emit('after:leave')"
  >
    <template v-if="hasBody" #body>
      <div class="space-y-3">
        <component :is="props.body" v-if="props.body" v-bind="props.props" />
        <slot name="body" />
        <p v-if="props.error" data-ne-confirm-error role="alert" class="text-sm text-error">
          {{ props.error }}
        </p>
      </div>
    </template>

    <template #footer>
      <div ref="footerElement" class="flex w-full justify-end gap-2">
        <UButton
          data-ne-confirm-cancel
          color="neutral"
          variant="ghost"
          :label="props.cancelLabel"
          :disabled="props.pending"
          @click="cancel"
        />
        <UButton
          data-ne-confirm-confirm
          :color="props.tone === 'danger' ? 'error' : 'primary'"
          :label="props.confirmLabel"
          :loading="props.pending"
          @click="confirm"
        />
      </div>
    </template>
  </UModal>
</template>
