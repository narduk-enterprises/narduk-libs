<script setup lang="ts">
/**
 * NeAdminDetailPage — one record on an admin screen (components backlog
 * item 20, narduk-libs#267).
 *
 * `NePageHeader` with the page's actions, then the record through
 * `NeDetailView`, gated by `NeStatePanel` while the read is loading, failed
 * or found nothing. Composition, not new behaviour: the panel's five
 * readings, the detail view's unknown-is-not-zero rows and the confirm
 * dialog's focus and pending rules are all inherited unchanged.
 *
 * ## Delete asks first, by construction
 *
 * With `onDelete` bound, the header gains a delete button that opens
 * `useConfirm()` as a `danger` dialog and hands `onDelete` to it as the
 * dialog's own `onConfirm`. So the handler runs only on confirm, the dialog
 * stays open and pending while it runs, and a rejection stays in the dialog
 * as its error for a retry — a bare delete button with no question in front
 * of it cannot be built from this component. `deleted` is emitted once the
 * handler has resolved; that is where the page navigates away.
 *
 * The confirm handle is created on the first delete click, not in setup, so
 * a detail page that is never asked to delete adds nothing to the overlay
 * stack, and nothing overlay-related runs during a server render.
 */
import UButton from '@nuxt/ui/components/Button.vue'
import { computed } from 'vue'

import { useConfirm } from '../composables/use-confirm'

import NeDetailView from './NeDetailView.vue'
import NePageHeader from './NePageHeader.vue'
import NeStatePanel from './NeStatePanel.vue'

import type { NeAsyncDataStatus, NeStateValue } from '../types'
import type { NeAdminDetailPageProps } from './ne-admin-page-types'

const props = withDefaults(defineProps<NeAdminDetailPageProps>(), {
  breadcrumbs: undefined,
  deleteConfirm: undefined,
  deleteLabel: 'Delete',
  description: undefined,
  emptyMessage: '',
  emptyTitle: '',
  errorMessage: '',
  errorTitle: '',
  eyebrow: undefined,
  loadingMessage: '',
  loadingTitle: '',
  onDelete: undefined,
  panelState: undefined,
  status: undefined,
  timeZone: undefined,
  unavailableMessage: undefined,
})

const emit = defineEmits<{
  /** `onDelete` resolved after the reader confirmed. Navigate away here. */
  deleted: []
}>()

defineSlots<{
  /** Right-aligned header actions, before the delete button — Edit, Back. */
  actions?(): unknown
  /** Extra content under the record — a related list, an audit trail. */
  default?(): unknown
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

/** Nothing to delete while there is no record on screen. */
const canDelete = computed(() => Boolean(props.onDelete) && reading.value === undefined)

let confirm: ReturnType<typeof useConfirm> | undefined

async function requestDelete(): Promise<void> {
  const handler = props.onDelete
  if (!handler) return
  confirm ??= useConfirm()
  const ok = await confirm({
    confirmLabel: props.deleteLabel,
    title: `Delete ${props.title}?`,
    tone: 'danger',
    ...props.deleteConfirm,
    onConfirm: handler,
  })
  if (ok) emit('deleted')
}
</script>

<template>
  <div data-ne-admin-detail-page class="ne-admin-detail-page min-w-0 space-y-6">
    <NePageHeader
      :title="title"
      :description="description"
      :eyebrow="eyebrow"
      :breadcrumbs="breadcrumbs"
    >
      <template v-if="$slots.actions || canDelete" #actions>
        <slot name="actions" />
        <UButton
          v-if="canDelete"
          data-ne-admin-delete
          type="button"
          color="error"
          variant="soft"
          icon="i-lucide-trash-2"
          :label="deleteLabel"
          @click="requestDelete"
        />
      </template>
    </NePageHeader>

    <NeStatePanel :state="reading" :title="panelTitle" :message="panelMessage">
      <NeDetailView
        :items="items"
        :time-zone="timeZone"
        :unavailable-message="unavailableMessage"
      />
      <slot />
    </NeStatePanel>
  </div>
</template>
