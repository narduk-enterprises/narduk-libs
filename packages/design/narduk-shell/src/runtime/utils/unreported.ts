/**
 * The unreported treatment's shared vocabulary (narduk-libs#602).
 *
 * A figure with no producer is neither zero nor stale. Every `Ne*` component
 * that renders a figure decides "unreported" with `isUnreported` and names it
 * with `NE_UNREPORTED_TEXT`, so the suite says it one way. The look — the
 * `--ne-hatch` material and its CSS contract — is in `theme.css` and README.md
 * § The unreported treatment.
 */

/** The accessible text for a figure with no producer. Never `0`, never blank. */
export const NE_UNREPORTED_TEXT = 'Not reported'

/**
 * True when nothing produced a number: `null`, `undefined`, or a number that
 * is not finite (`NaN` is what a failed parse or a `0 / 0` upstream becomes,
 * and it is no more a measurement than `null` is). A string is a caller's own
 * formatted figure and is never unreported here.
 */
export function isUnreported(value: unknown): boolean {
  return (
    value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value))
  )
}
