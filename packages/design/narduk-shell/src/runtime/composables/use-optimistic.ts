/**
 * useOptimistic() — apply a change on screen at once, then confirm it with the
 * server; put the old value back, and say so, if the server refuses.
 *
 * The rule it serves: no spinner between a click and the result. A toggle, a
 * rename, a reorder or a delete shows its outcome on the next frame; the
 * request runs behind it.
 *
 * ```ts
 * const starred = ref(row.starred)
 * const optimistic = useOptimistic(starred, { errorTitle: 'Could not star the row' })
 *
 * function toggle() {
 *   return optimistic.mutate(
 *     (current) => !current,
 *     (next) => $fetch(`/api/rows/${row.id}`, { method: 'PATCH', body: { starred: next } }),
 *   )
 * }
 * ```
 *
 * `mutate(update, action)`:
 *
 * 1. `update(current)` returns the next value, which is written to `state` at
 *    once. Return a NEW value (a spread, a `map`); mutating `current` in place
 *    leaves nothing to roll back to.
 * 2. `action(next)` runs. It may be sync or async.
 * 3. On success the value stays and `mutate` resolves `{ ok: true, value }`.
 * 4. On failure `state` goes back to what it was before step 1, `error` holds
 *    the thrown value, a toast names the failure, and `mutate` resolves
 *    `{ ok: false, error }`. Action failures do not reject. Programming errors
 *    thrown by `update`, the toast handler or `onError` still propagate.
 *
 * ## Concurrent calls
 *
 * Calls may overlap (two quick toggles). Only the newest call rolls back: an
 * older call that fails after a newer one started leaves `state` alone, as the
 * newer call has already built on it. Await each call when the saves must be
 * strictly ordered.
 *
 * ## The toast
 *
 * Failure raises Nuxt UI's `useToast()` toast (colour `error`) when the
 * composable runs in a component's setup. `toast: false` turns it off, and
 * `onError` runs either way, for an app that surfaces errors its own way.
 * Called outside a component there is no toast (Nuxt UI's `useToast` reads an
 * injection that only exists in setup): pass `onError`.
 */
import { useToast } from '@nuxt/ui/composables/useToast'
import { computed, getCurrentInstance, ref, shallowRef } from 'vue'

import type { ComputedRef, Ref, ShallowRef } from 'vue'

export interface NeOptimisticOptions {
  /** Runs on every failure, after the rollback. */
  onError?: (error: unknown) => void
  /** Toast title on failure. Default: "That change did not save". */
  errorTitle?: string
  /** Raise the failure toast. Default `true`. */
  toast?: boolean
}

export type NeOptimisticResult<R> = { ok: true; value: R } | { ok: false; error: unknown }

export interface NeOptimistic<T> {
  /** The last failure, `null` until one happens and again at the next `mutate`. */
  error: ShallowRef<unknown>
  /** Apply `update` now, run `action`, roll back if it throws. */
  mutate: <R>(
    update: (current: T) => T,
    action: (next: T) => R | Promise<R>,
  ) => Promise<NeOptimisticResult<Awaited<R>>>
  /** `true` while any `action` is still running. For a quiet cue, not a spinner. */
  pending: ComputedRef<boolean>
}

/** A one-line description of whatever was thrown, for the toast body. */
function describeError(error: unknown): string | undefined {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  const statusMessage = (error as { statusMessage?: unknown } | null)?.statusMessage
  return typeof statusMessage === 'string' && statusMessage ? statusMessage : undefined
}

export function useOptimistic<T>(
  state: Ref<T>,
  options: NeOptimisticOptions = {},
): NeOptimistic<T> {
  const toaster = options.toast !== false && getCurrentInstance() ? useToast() : undefined
  const error = shallowRef<unknown>(null)
  const inFlight = ref(0)
  let latest = 0

  async function mutate<R>(
    update: (current: T) => T,
    action: (next: T) => R | Promise<R>,
  ): Promise<NeOptimisticResult<Awaited<R>>> {
    const ticket = ++latest
    const previous = state.value
    const next = update(previous)
    error.value = null
    state.value = next
    inFlight.value += 1
    try {
      const value = await action(next)
      return { ok: true, value }
    } catch (failure) {
      if (ticket === latest) state.value = previous
      error.value = failure
      toaster?.add({
        title: options.errorTitle ?? 'That change did not save',
        description: describeError(failure),
        color: 'error',
      })
      options.onError?.(failure)
      return { ok: false, error: failure }
    } finally {
      inFlight.value -= 1
    }
  }

  return { error, mutate, pending: computed(() => inFlight.value > 0) }
}
