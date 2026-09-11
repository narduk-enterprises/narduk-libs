import { useOverlay } from '@nuxt/ui/composables/useOverlay'
import type { Component } from 'vue'

import NeConfirmDialog from '../components/NeConfirmDialog.vue'
import type { NeConfirmTone } from '../components/ne-confirm-dialog-types'

/** What `confirm()` accepts. Everything except `onConfirm` is a dialog prop. */
export interface NeConfirmOptions {
  /** Dialog heading and accessible name. */
  title?: string
  /** One-line consequence and accessible description. */
  message?: string
  /** Confirm button label. Defaults to `Confirm`. */
  confirmLabel?: string
  /** Cancel button label. Defaults to `Cancel`. */
  cancelLabel?: string
  /** `danger` colours the confirm button `error` and focuses Cancel first. */
  tone?: NeConfirmTone
  /** A component rendered in the dialog body. */
  body?: Component
  /** Props handed to `body`. */
  props?: Record<string, unknown>
  /**
   * Optional work to run when the user confirms. While it is in flight the
   * dialog stays open and pending (confirm button loading, cancel disabled,
   * Escape and outside clicks off). It closes and resolves `true` when the
   * handler settles. If it rejects the dialog STAYS OPEN, leaves pending, and
   * surfaces the rejection through the `error` prop — the user can retry or
   * cancel, and `confirm()` only resolves once they do.
   */
  onConfirm?: () => unknown | Promise<unknown>
}

const FALLBACK_ERROR = 'Something went wrong. Please try again.'

function toMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return FALLBACK_ERROR
}

/**
 * `useConfirm()` — the programmatic half of `NeConfirmDialog`
 * (components backlog item 16, narduk-libs#263).
 *
 * ```ts
 * const confirm = useConfirm()
 * const ok = await confirm({
 *   title: 'Close all positions?',
 *   message: 'This closes every open position at the current market price.',
 *   confirmLabel: 'Close all',
 *   tone: 'danger',
 * })
 * if (!ok) return
 * ```
 *
 * Built on Nuxt UI's `useOverlay`, so the dialog needs a `UApp` (or a bare
 * `UOverlayProvider`) somewhere above it — which every Narduk app already has.
 *
 * One handle drives one dialog at a time: call `useConfirm()` once per setup
 * and await each `confirm()` before starting the next.
 */
export function useConfirm() {
  const overlay = useOverlay()
  const dialog = overlay.create(NeConfirmDialog)

  return async function confirm(options: NeConfirmOptions = {}): Promise<boolean> {
    const { onConfirm, ...dialogProps } = options

    const opened = dialog.open({
      ...dialogProps,
      // Always reset: the same overlay instance is reused across calls, so a
      // previous failure's pending/error state would otherwise leak forward.
      pending: false,
      error: '',
      // A prop named `onConfirm` IS the listener for the component's `confirm`
      // emit, which is how the composable gets a say without the overlay
      // machinery forwarding arbitrary events.
      onConfirm: async () => {
        if (!onConfirm) {
          dialog.close(true)
          return
        }

        dialog.patch({ pending: true, error: '' })
        try {
          await onConfirm()
          dialog.close(true)
        } catch (error) {
          dialog.patch({ pending: false, error: toMessage(error) })
        }
      },
    })

    // `close(value)` resolves with whatever the component emitted: `true` from
    // the confirm path above, `false` from cancel / Escape / outside click.
    const result: unknown = await opened
    return result === true
  }
}
