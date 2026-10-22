/**
 * useUndoToast() — the Gmail "Conversation archived. Undo" toast: a destructive
 * or hard-to-reverse action shows its result at once and stays undoable for a
 * few seconds, instead of asking "are you sure?" first.
 *
 * ```ts
 * const undo = useUndoToast()
 *
 * async function removeFromWatchlist(row: Row) {
 *   rows.value = rows.value.filter((r) => r.id !== row.id) // show the result now
 *   const outcome = await undo.show({ title: `Removed ${row.symbol}` })
 *   if (outcome === 'undone') rows.value = restore(row)
 *   else await $fetch(`/api/watchlist/${row.id}`, { method: 'DELETE' })
 * }
 * ```
 *
 * `show(options)` raises a Nuxt UI toast (the same toast system `useOptimistic`
 * and every other shell notice use) with an **Undo** action, a visible
 * countdown bar, and a longer life than an ordinary toast (7 seconds). Nuxt UI
 * pauses the countdown while the pointer is over the toasts or focus is inside
 * one, so nobody loses the Undo while reaching for it. The promise resolves
 * once, with:
 *
 * - `'undone'` — the Undo action was pressed.
 * - `'committed'` — anything else closed the toast: the countdown ran out, the
 *   close button, a swipe, Escape, or `useToast().remove(id)` (the toast
 *   leaving the toaster's list counts as a close).
 *
 * It never rejects. `onUndo` / `onCommit` run just before it resolves, for a
 * caller who prefers callbacks to `await`.
 *
 * ## What it does not do
 *
 * - **The commit lives in the page.** Closing the tab inside the window drops a
 *   deferred commit. For an action that must survive that, commit eagerly and
 *   make `'undone'` the reversing call.
 * - **It needs a mounted toaster.** Nuxt UI renders toasts inside its app
 *   wrapper (the `UApp` shell); without one the toast never opens or closes
 *   and the promise stays pending.
 * - **Reduced motion** is the toast's own business: the countdown bar is a
 *   timer readout, not decoration, so it keeps running.
 *
 * Call it in a component's setup, like `useOptimistic`: Nuxt UI's `useToast`
 * reads an injection that only exists there.
 */
import { useToast } from '@nuxt/ui/composables/useToast'
import { watch } from 'vue'

/** How long the Undo stays offered, in milliseconds (the 6-8 second band). */
export const NE_UNDO_DURATION_MS = 7000

/** What became of the toast: `undone` if Undo was pressed, otherwise `committed`. */
export type NeUndoOutcome = 'committed' | 'undone'

export interface NeUndoToastOptions {
  /** The toast's headline: what just happened. `Removed AAPL`. */
  title: string
  /** A second line, e.g. where the item went. */
  description?: string
  /** Milliseconds the Undo stays offered. Default {@link NE_UNDO_DURATION_MS}. */
  duration?: number
  /** The action's label. Default `Undo`. */
  undoLabel?: string
  /** An icon name for the toast, e.g. `i-lucide-trash-2`. */
  icon?: string
  /** Runs when Undo is pressed, before `show` resolves `'undone'`. */
  onUndo?: () => void | Promise<void>
  /** Runs when the toast closes any other way, before `show` resolves `'committed'`. */
  onCommit?: () => void | Promise<void>
}

export interface NeUndoToast {
  /** Offer the undo. Resolves exactly once; never rejects. */
  show: (options: NeUndoToastOptions) => Promise<NeUndoOutcome>
}

export function useUndoToast(): NeUndoToast {
  const toaster = useToast()

  function show(options: NeUndoToastOptions): Promise<NeUndoOutcome> {
    return new Promise<NeUndoOutcome>((resolve) => {
      let settled = false
      let stopWatching: (() => void) | undefined

      async function settle(outcome: NeUndoOutcome) {
        if (settled) return
        settled = true
        stopWatching?.()
        try {
          await (outcome === 'undone' ? options.onUndo?.() : options.onCommit?.())
        } finally {
          resolve(outcome)
        }
      }

      const toast = toaster.add({
        title: options.title,
        description: options.description,
        icon: options.icon,
        color: 'neutral',
        duration: options.duration ?? NE_UNDO_DURATION_MS,
        // A host that turns progress off for ordinary toasts (`<UApp
        // :toaster="{ progress: false }">`) still gets the countdown here: the
        // bar is how a person knows how long Undo has left.
        progress: true,
        actions: [
          {
            label: options.undoLabel ?? 'Undo',
            color: 'neutral',
            variant: 'outline',
            onClick: () => {
              void settle('undone')
            },
          },
        ],
        // Pressing the action closes the toast too, and in a real Nuxt UI
        // toaster the close is reported BEFORE the action's own `onClick` (Reka's
        // ToastAction runs the toast's close first). Reading `open: false` as a
        // commit on the spot would therefore beat every Undo press. The close
        // is deferred one macrotask, so the same click's `onClick` settles
        // 'undone' first; a close nobody claims is then a commit.
        'onUpdate:open': (open: boolean) => {
          if (!open) setTimeout(() => void settle('committed'), 0)
        },
      })

      // `useToast().remove(id)` drops the toast without a close event, so also
      // watch the list: leaving it is a close.
      stopWatching = watch(
        () => toaster.toasts.value.some((entry) => entry.id === toast.id),
        (present) => {
          if (!present) setTimeout(() => void settle('committed'), 0)
        },
      )
    })
  }

  return { show }
}
