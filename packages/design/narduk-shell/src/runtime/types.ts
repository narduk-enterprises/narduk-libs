/**
 * Public runtime types for the `Ne*` suite.
 *
 * These are re-exported from the package entry (`src/index.ts`, the `.`
 * subpath — narduk-libs#295 moved it off `src/module.ts`) as type-only
 * exports, so an app writes
 * `import type { NeStateValue } from '@narduk-enterprises/narduk-shell'`
 * without importing the Nuxt module for its side effects.
 *
 * Keep this file type-only. `src/index.ts` re-exports it with
 * `export type { ... } from './runtime/types'`, which is erased at build time;
 * adding a runtime value here would either be unreachable through that
 * re-export or would pull component code into the barrel's Node-side graph.
 */

/**
 * The five readings `NeStatePanel` renders. They are deliberately five and not
 * three: the whole point of the component is that *unknown is not zero*.
 *
 * - `loading` — the read has not answered yet.
 * - `empty` — the read answered and found nothing. A set with no members.
 * - `absent` — no producer publishes this fact at all. Not a zero, not a
 *   failure, and not something a refresh will fix.
 * - `blocked` — a read this surface depends on did not answer.
 * - `error` — the read failed.
 */
export type NeStateValue = 'empty' | 'loading' | 'error' | 'blocked' | 'absent'

/**
 * Nuxt's `useAsyncData()` / `useFetch()` `status` ref, so a caller can bind it
 * straight through instead of hand-mapping it at every call site. See
 * `NeStatePanel`'s README section for the mapping table; `success` is not a
 * state — it renders the default slot.
 */
export type NeAsyncDataStatus = 'idle' | 'pending' | 'success' | 'error'

/**
 * One named provisioning gap, ported from operator-portal's `StatePanel`.
 * Rendered as a list item, never folded into prose: a gap the producer itself
 * names is the difference between "nothing here" and "nothing here *because*".
 */
export interface NeStateGap {
  /** Short machine-ish identifier, e.g. `runners.heartbeat`. */
  id: string
  /** What is missing, in the producer's own words. */
  need: string
}

/**
 * `NeStatePanel`'s props. Exported so an app can type a wrapper or a props
 * object without re-declaring the shape.
 */
export interface NeStatePanelProps {
  /** Element the panel renders as. `section` when the panel *is* the section. */
  as?: string
  /**
   * Short state label rendered as text above the body. Defaults to the state's
   * own name, which is what keeps the reading off colour alone.
   */
  eyebrow?: string
  /** Named provisioning gaps. Plain strings are accepted for the simple case. */
  gaps?: ReadonlyArray<string | NeStateGap>
  /** Icon name; defaults to the state's own icon. `loading` has none. */
  icon?: string
  /** The sentence under the title. */
  message?: string
  /**
   * The state to render. Takes precedence over `status` whenever it is set, so
   * `:state="rows.length ? undefined : 'empty'"` composes with a bound status.
   */
  state?: NeStateValue
  /** `useAsyncData()`'s status, mapped onto a state. Ignored when `state` is set. */
  status?: NeAsyncDataStatus
  /** The headline. */
  title?: string
  /** Optional link for the unblocking condition or its reference. */
  unblocksHref?: string
  /** The condition that would end this state, e.g. "a runner reports in". */
  unblocksOn?: string
  /** An issue or file reference beside the condition, e.g. `operator-portal#152`. */
  unblocksRef?: string
}
