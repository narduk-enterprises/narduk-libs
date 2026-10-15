/**
 * useSlashFocus(target) — press "/" anywhere outside a text field to focus a
 * search box, the Notion / GitHub / Linear habit.
 *
 * This is the only shortcut helper the feel set adds. Everything else
 * (Cmd+K, `g-d` chains, per-page keys) is Nuxt UI's `defineShortcuts`, already
 * auto-imported in an app: do not wrap it again.
 *
 * ```ts
 * const search = useTemplateRef('search')
 * useSlashFocus(search) // <UInput ref="search" /> or a plain <input ref="search">
 * ```
 *
 * `target` is an element, a component instance (its root element or the first
 * input inside it is used, so a `UInput` ref works) or a getter for either. A
 * "/" typed into a field is typing, and `defineShortcuts` already leaves it
 * alone. Nothing happens when the target is not mounted yet.
 *
 * It does not claim the key alone: `useCommandPaletteShortcuts()` also opens
 * the palette on "/" unless told `{ slash: false }`. An app with both picks one.
 */
import { defineShortcuts } from '@nuxt/ui/composables/defineShortcuts'
import { toValue } from 'vue'

import type { MaybeRefOrGetter } from 'vue'

export type NeSlashFocusTarget = Element | { $el?: Element | null } | null | undefined

const FOCUSABLE_FIELD = 'input:not([type="hidden"]), textarea, select, [contenteditable="true"]'

/** The element to focus: the target itself when it is a field, else the first field in it. */
export function resolveFocusTarget(target: NeSlashFocusTarget): HTMLElement | null {
  const root = target && '$el' in target ? target.$el : (target as Element | null | undefined)
  if (!root || typeof (root as Element).matches !== 'function') return null
  const element = root as Element
  const field = element.matches(FOCUSABLE_FIELD) ? element : element.querySelector(FOCUSABLE_FIELD)
  return (field as HTMLElement | null) ?? null
}

export function useSlashFocus(
  target: MaybeRefOrGetter<NeSlashFocusTarget>,
  options: { key?: string } = {},
): void {
  defineShortcuts({
    [options.key ?? '/']: () => {
      const field = resolveFocusTarget(toValue(target))
      if (!field) return
      field.focus()
      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) field.select()
    },
  })
}
