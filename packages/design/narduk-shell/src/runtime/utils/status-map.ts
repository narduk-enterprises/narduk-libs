/**
 * `NeStatusBadge`'s tone vocabulary and the `defineStatusMap` helper that
 * turns a domain-specific status union (a flood stage, an order status, a
 * sync state) into the `{ tone, label }` pair the component accepts with
 * `v-bind`, once, in one place.
 *
 * This is exactly the pattern operator-portal#156 documents the estate
 * re-deriving by hand in every app: a `switch`/lookup from an app's own
 * status enum to a colour and a word, duplicated per component, per app.
 * `defineStatusMap` is the single place that mapping lives.
 */

/** The fixed tone vocabulary every `NeStatusBadge` renders as. */
export type NeStatusTone = 'ok' | 'warn' | 'error' | 'info' | 'neutral' | 'pending'

export interface NeStatusDescriptor {
  tone: NeStatusTone
  label: string
}

/**
 * Builds a typed `key -> { tone, label }` lookup from a `Record` that must
 * cover every value of `T` -- TypeScript rejects a call that omits one, so
 * the mapping is exhaustive at the type level (see `test/status-map.test.ts`
 * for the `@ts-expect-error` proof).
 *
 * The returned function still has to handle a value it was never typed for:
 * an API can hand back a status this app's union does not (yet, or no
 * longer) know about. That runtime miss falls back to
 * `{ tone: 'neutral', label: String(key) }` rather than throwing, so an
 * unrecognised status renders as a plain, visible badge instead of crashing
 * the page it's on.
 */
export function defineStatusMap<T extends string>(
  map: Record<T, [NeStatusTone, string]>,
): (key: T) => NeStatusDescriptor {
  return (key: T): NeStatusDescriptor => {
    const entry = (map as Record<string, [NeStatusTone, string] | undefined>)[key]
    if (!entry) return { tone: 'neutral', label: String(key) }
    const [tone, label] = entry
    return { tone, label }
  }
}
