/**
 * `useCommandPalette()` and `useCommandPaletteShortcuts()` — the palette's
 * open state and its keyboard shortcuts.
 *
 * Both are small on purpose. The palette itself (`NeCommandPalette`) is the
 * heavy part and an app loads it lazily; these are what stay in the first
 * bundle so the header button and Cmd/Ctrl+K work before the palette code has
 * arrived:
 *
 * - `open()` sets `armed` along with `open`. An app mounts the lazy palette
 *   behind `v-if="palette.armed.value"`, so the chunk is fetched by the first
 *   open, and the palette opens itself the moment it mounts.
 * - `preload()` sets only `armed`: the palette mounts closed. A button calls it
 *   on pointer-enter or focus, so the chunk is usually in by the click.
 *
 * ## Why `useState`
 *
 * Per-request shared state: the header button, the shortcut and the palette
 * all see the same flags, and nothing is shared between two requests on the
 * server. The flags are only ever set in the browser.
 */
import { computed, getCurrentInstance, onBeforeUnmount, onMounted } from 'vue'

import { useState } from '#imports'

export const NE_COMMAND_PALETTE_STATE_KEY = 'narduk-shell:command-palette'

interface PaletteFlags {
  armed: boolean
  open: boolean
}

export function useCommandPalette() {
  const flags = useState<PaletteFlags>(NE_COMMAND_PALETTE_STATE_KEY, () => ({
    armed: false,
    open: false,
  }))
  return {
    /** The lazy palette should be mounted (it may still be closed). */
    armed: computed(() => flags.value.armed),
    close() {
      flags.value = { ...flags.value, open: false }
    },
    isOpen: computed(() => flags.value.open),
    open() {
      flags.value = { armed: true, open: true }
    },
    /** Mount the palette closed, ahead of the first open. */
    preload() {
      if (!flags.value.armed) flags.value = { ...flags.value, armed: true }
    },
    toggle() {
      flags.value = { armed: true, open: !flags.value.open }
    },
  }
}

export type NeCommandPaletteControls = ReturnType<typeof useCommandPalette>

/** True for a field where typing a "/" is typing, not a shortcut. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return false
  const element = target as HTMLElement
  if (element.isContentEditable) return true
  const tag = element.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag !== 'INPUT') return false
  const type = (element as HTMLInputElement).type
  return ![
    'button',
    'checkbox',
    'color',
    'file',
    'image',
    'radio',
    'range',
    'reset',
    'submit',
  ].includes(type)
}

export interface NeCommandShortcutsOptions {
  /** Open on "/" outside a text field. Default true. */
  slash?: boolean
}

/**
 * What a keydown does to the palette: `toggle` for Cmd/Ctrl+K, `open` for "/"
 * outside a field, `none` for everything else. Pure, so it is unit tested.
 */
export function shortcutFor(
  event: Pick<
    KeyboardEvent,
    'altKey' | 'ctrlKey' | 'isComposing' | 'key' | 'metaKey' | 'shiftKey' | 'target'
  >,
  options: NeCommandShortcutsOptions = {},
): 'none' | 'open' | 'toggle' {
  if (event.isComposing) return 'none'
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && key === 'k') {
    return 'toggle'
  }
  if (
    options.slash !== false &&
    key === '/' &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !isEditableTarget(event.target)
  ) {
    return 'open'
  }
  return 'none'
}

/**
 * One window listener for the whole page, however many components ask for it:
 * the first binder adds it, the last to unmount removes it.
 */
let binders = 0
let listener: ((event: KeyboardEvent) => void) | null = null

export function useCommandPaletteShortcuts(options: NeCommandShortcutsOptions = {}) {
  const palette = useCommandPalette()
  if (!getCurrentInstance()) return palette

  onMounted(() => {
    binders += 1
    if (listener) return
    listener = (event: KeyboardEvent) => {
      const action = shortcutFor(event, options)
      if (action === 'none') return
      event.preventDefault()
      if (action === 'toggle') palette.toggle()
      else palette.open()
    }
    window.addEventListener('keydown', listener)
  })

  onBeforeUnmount(() => {
    binders = Math.max(0, binders - 1)
    if (binders === 0 && listener) {
      window.removeEventListener('keydown', listener)
      listener = null
    }
  })

  return palette
}
