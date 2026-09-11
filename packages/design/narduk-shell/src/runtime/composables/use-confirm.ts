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
 * One `confirm()` call. A handle keeps at most one of these `active`, because
 * the overlay underneath it can only resolve one promise at a time.
 */
interface ConfirmCall {
  /** True from the moment `onConfirm` starts until it settles. */
  running: boolean
  /** Set by `settle`, so the first settlement wins and later ones are no-ops. */
  settled: boolean
  /** Resolve this call's `confirm()` promise. Idempotent. */
  settle: (value: boolean) => void
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
 * Built on Nuxt UI's `useOverlay`. That is the host — `open()` mounts
 * `NeConfirmDialog` into the overlay stack, so the app never wires a host
 * component. The stack lives on `UApp` (or a bare `UOverlayProvider`), which
 * every Narduk app already has (`LayerAppShell` wraps the tree in `UApp`).
 *
 * ## One dialog, and what a second call does to the first
 *
 * A handle owns exactly one overlay, so it shows one dialog at a time. Nuxt UI
 * keeps a single resolver per overlay — `open()` runs
 * `overlay.resolvePromise = resolve` unconditionally on every call
 * (`@nuxt/ui/dist/runtime/composables/useOverlay.js`) — so a second `open()`
 * on the same handle drops the first resolver on the floor. Left alone that is
 * a permanent hang: the first `await confirm(...)` never resolves, never
 * rejects and never times out. The realistic trigger is a double-click on a
 * row-level "Delete?", which is exactly what this composable is for.
 *
 * So a second `confirm()` **supersedes** the first rather than racing it:
 *
 * - The new options take the dialog over, which is what the user sees.
 * - The superseded call resolves `false` — the user is being asked a different
 *   question now, so they did not confirm the old one, and the caller's
 *   `if (!ok) return` does the safe thing with no new branch to write.
 * - The one exception is a superseded call whose `onConfirm` is still in
 *   flight. That work cannot be unrun, so answering `false` would be a lie; it
 *   keeps its promise and settles with the real outcome when the work does
 *   (`true` when it succeeds, `false` when it fails, since the dialog it would
 *   have offered a retry in now belongs to the newer call).
 *
 * Superseding is the only re-entrancy rule: no caller is left holding a promise
 * that cannot settle, and no in-flight handler writes to a dialog it no longer
 * owns. `test/use-confirm.test.ts` pins both. Sequential calls — await one,
 * then start the next — are unaffected.
 */
export function useConfirm() {
  const overlay = useOverlay()
  const dialog = overlay.create(NeConfirmDialog)

  // The call the visible dialog currently belongs to, or null between calls.
  // Every listener below checks it before touching the shared overlay, so a
  // superseded call can neither close nor repaint a dialog it no longer owns.
  let active: ConfirmCall | null = null

  return function confirm(options: NeConfirmOptions = {}): Promise<boolean> {
    const { onConfirm, ...dialogProps } = options

    let resolveCall!: (value: boolean) => void
    const settled = new Promise<boolean>((resolve) => {
      resolveCall = resolve
    })

    const call: ConfirmCall = {
      running: false,
      settled: false,
      settle(value: boolean) {
        if (call.settled) return
        call.settled = true
        if (active === call) active = null
        resolveCall(value)
      },
    }

    // Take the dialog over before opening it, so an in-flight handler from the
    // superseded call sees that it lost ownership the moment it looks.
    const superseded = active
    active = call
    if (superseded && !superseded.running) superseded.settle(false)

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
        // A listener left over from a superseded call. The dialog on screen
        // belongs to someone else now, so neither close nor patch it.
        if (call.settled || active !== call) return

        if (!onConfirm) {
          dialog.close(true)
          return
        }

        call.running = true
        dialog.patch({ pending: true, error: '' })
        try {
          await onConfirm()
          call.running = false
          // Still ours: closing resolves this call through the overlay.
          // Superseded mid-flight: settle here instead, with the truth, and
          // leave the newer call's dialog untouched.
          if (active === call) dialog.close(true)
          else call.settle(true)
        } catch (error) {
          call.running = false
          if (active === call) dialog.patch({ pending: false, error: toMessage(error) })
          // No dialog left to retry in, so the caller gets the same `false` a
          // cancel would have given it.
          else call.settle(false)
        }
      },
    })

    // `close(value)` resolves with whatever the component emitted: `true` from
    // the confirm path above, `false` from cancel / Escape / outside click.
    // A superseded call's `opened` never resolves — `settle` already did it.
    void Promise.resolve(opened).then((result: unknown) => call.settle(result === true))

    return settled
  }
}
