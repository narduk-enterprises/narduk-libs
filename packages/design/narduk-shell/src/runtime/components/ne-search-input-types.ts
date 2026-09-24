/**
 * NeSearchInput's public shapes (narduk-libs#261).
 *
 * Separate from the SFC for the same reason `ne-filter-bar-types.ts` is: a
 * consumer that only wants the prop type should not have to import a component
 * to get it.
 */

/**
 * The debounce window applied to `v-model` when this field is standalone.
 *
 * Same number `useCollection` uses for `q` (`NE_COLLECTION_DEBOUNCE_MS`): one
 * request for "GTM1500". The two constants are asserted equal in the mount
 * suite so they cannot drift. Bind `v-model="c.q"` with `:debounce="0"` —
 * `c.q` is the keystroke value, and a second window here would wait twice.
 */
export const NE_SEARCH_DEBOUNCE_MS = 250

export type NeSearchInputSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

export interface NeSearchInputProps {
  /**
   * How long a keystroke waits before `v-model` updates, in ms. `0` emits on
   * every keystroke — the binding `useCollection`'s `c.q` wants, because that
   * composable already applies its own window.
   */
  debounce?: number
  /** The field cannot be typed or cleared. */
  disabled?: boolean
  /**
   * The field's accessible name (`aria-label` on the input). Required: a
   * search whose only name is its placeholder disappears the moment someone
   * types, and a filter toolbar that also has chips cannot borrow their
   * group's name.
   */
  label: string
  /**
   * Hard ceiling on what can be typed. Defaults to the list-query contract's
   * own maximum (`LIST_QUERY_DEFAULT_MAX_QUERY_LENGTH`, 200) so a value that
   * cannot travel is never entered. Override only when the route's ceiling
   * differs.
   */
  maxLength?: number
  /**
   * The applied term. The box shows the keystroke; this updates after
   * `debounce` ms. `''` is "no search", never `null` — the contract's `q` is
   * a string, and `useCollection` omits it from the wire when it is empty.
   */
  modelValue?: string
  /** Native `name`, for a field that submits with a form. */
  name?: string
  /**
   * The collection is in flight for this term. Forwards to `UInput`'s
   * `loading` and sets `aria-busy` on the field, so a spinner is not the only
   * signal.
   */
  pending?: boolean
  /** Hint shown while the field is empty. Not the accessible name — `label` is. */
  placeholder?: string
  /**
   * When true, a live region names the applied term under the field. Off by
   * default: a toolbar that already shows the term in the box does not need
   * it said twice. Turn it on when the applied term can lag the box (a
   * non-zero debounce) and a reader needs to know what the list is matching.
   */
  showSummary?: boolean
  size?: NeSearchInputSize
}
