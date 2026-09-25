/**
 * Merge the suite's token classes into a caller's Nuxt UI `ui` prop
 * (components backlog item 21, narduk-libs#268).
 *
 * The marketing sections theme their Nuxt UI primitive through that
 * primitive's own `ui` prop, which is also a prop the caller may pass. For
 * each slot the suite's class goes FIRST and the caller's second: Nuxt UI runs
 * a slot's classes through tailwind-merge, where the later of two conflicting
 * utilities wins, so a caller can always override one suite class without
 * losing the rest. A slot only the caller names passes through untouched.
 *
 * A caller's replacer function (`defaults => '…'`, Nuxt UI 4's `SlotClass`)
 * is passed through ALONE. Nuxt UI keeps any plain classes that sit beside a
 * replacer and merges them after its output, so leaving the suite's class
 * next to it would let the suite beat the caller's explicit replacement.
 */
import type { SlotClass } from '@nuxt/ui'

export type NeUiClasses = Partial<Record<string, SlotClass>>

function hasReplacer(value: unknown): boolean {
  if (typeof value === 'function') return true
  return Array.isArray(value) && value.some((item) => hasReplacer(item))
}

export function withNeClasses(
  suite: Readonly<Record<string, string>>,
  caller?: NeUiClasses,
): NeUiClasses {
  const merged: NeUiClasses = { ...caller }
  for (const [slot, classes] of Object.entries(suite)) {
    const own = caller?.[slot]
    if (own === undefined || own === null || own === '') merged[slot] = classes
    else if (hasReplacer(own)) merged[slot] = own
    else merged[slot] = [classes, own] as SlotClass
  }
  return merged
}
