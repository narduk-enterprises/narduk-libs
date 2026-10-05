<script setup lang="ts">
/**
 * NeCommandPaletteTrigger — the header button that opens `NeCommandPalette`.
 *
 * It looks like a search field (an icon, the placeholder, and the shortcut
 * hint) but is a button: clicking it opens the palette, it does not take
 * typing itself. That keeps one input on the page, and on a phone the tap
 * opens the full-screen sheet instead of a cramped header field.
 *
 * ## Small on purpose
 *
 * It is the part of the palette that ships in the first bundle, so it carries
 * no palette code. It binds Cmd/Ctrl+K and "/" (turn that off with
 * `:shortcuts="false"` when a layout binds them itself) and calls `preload()`
 * on pointer-enter, focus and touch, so the lazy palette's chunk is usually in
 * by the click.
 *
 * ## The shortcut hint is not on touch screens
 *
 * "⌘K" on a Mac, "Ctrl K" elsewhere, decided after mount (the server cannot
 * know the platform, and a hint chosen at render would hydrate wrong). Hidden
 * on a touch screen by CSS.
 *
 * ## Before the page has hydrated
 *
 * Give `fallbackAction` (a search page path) and the button sits in a GET form:
 * pressed before the script has run it submits to that page, and once it has
 * run the click opens the palette instead.
 */
import UIcon from '@nuxt/ui/components/Icon.vue'
import { onMounted, ref } from 'vue'

import { useCommandPalette, useCommandPaletteShortcuts } from '../composables/use-command-palette'

import type { NeCommandPaletteTriggerProps } from './ne-command-palette-types'

const props = withDefaults(defineProps<NeCommandPaletteTriggerProps>(), {
  compact: false,
  fallbackAction: undefined,
  label: undefined,
  placeholder: 'Search',
  shortcuts: true,
})

// Class and attributes go to the button, not to the layout-free wrapper.
defineOptions({ inheritAttrs: false })

const palette = useCommandPalette()
if (props.shortcuts) useCommandPaletteShortcuts()

const hint = ref('')
onMounted(() => {
  const platform = navigator.platform || navigator.userAgent
  hint.value = /mac|iphone|ipad|ipod/i.test(platform) ? '⌘K' : 'Ctrl K'
})

function onClick(event: MouseEvent) {
  event.preventDefault()
  palette.open()
}
</script>

<template>
  <component
    :is="fallbackAction ? 'form' : 'div'"
    class="ne-cmd-trigger-wrap"
    v-bind="fallbackAction ? { action: fallbackAction, method: 'get', role: 'search' } : {}"
  >
    <button
      v-bind="$attrs"
      :type="fallbackAction ? 'submit' : 'button'"
      class="ne-cmd-trigger"
      :class="{ 'is-compact': compact }"
      data-ne-command-trigger
      :aria-label="label ?? placeholder"
      aria-haspopup="dialog"
      :aria-expanded="palette.isOpen.value"
      aria-keyshortcuts="Control+K Meta+K"
      @click="onClick"
      @pointerenter="palette.preload()"
      @focus="palette.preload()"
      @touchstart.passive="palette.preload()"
    >
      <UIcon name="i-lucide-search" class="ne-cmd-trigger__icon" aria-hidden="true" />
      <span class="ne-cmd-trigger__text">{{ placeholder }}</span>
      <kbd v-if="hint" class="ne-cmd-trigger__hint" aria-hidden="true">{{ hint }}</kbd>
    </button>
  </component>
</template>

<style scoped>
.ne-cmd-trigger-wrap {
  display: contents;
}

.ne-cmd-trigger {
  display: inline-flex;
  min-width: 0;
  min-height: 2.25rem;
  align-items: center;
  gap: 0.5rem;
  padding: 0 0.75rem;
  border: 1px solid var(--ne-hairline);
  border-radius: var(--ne-radius-control);
  background: var(--ne-surface);
  color: var(--ne-ink-muted);
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.ne-cmd-trigger:hover {
  border-color: var(--ne-line-strong);
}

.ne-cmd-trigger:focus-visible {
  outline: 2px solid var(--ne-accent);
  outline-offset: 2px;
}

.ne-cmd-trigger__icon {
  flex: none;
}

.ne-cmd-trigger__text {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ne-cmd-trigger__hint {
  flex: none;
  padding: 0.0625rem 0.375rem;
  border: 1px solid var(--ne-line-strong);
  border-radius: var(--ne-radius-base);
  background: var(--ne-surface-muted);
  font-family: var(--ne-font-mono);
  font-size: 0.6875rem;
}

/* Icon only: the label stays for assistive tech through aria-label. */
.ne-cmd-trigger.is-compact {
  width: 2.75rem;
  min-height: 2.75rem;
  justify-content: center;
  padding: 0;
}

.ne-cmd-trigger.is-compact .ne-cmd-trigger__text,
.ne-cmd-trigger.is-compact .ne-cmd-trigger__hint {
  display: none;
}

/* Touch screens have no shortcut to hint at. */
@media (hover: none) and (pointer: coarse) {
  .ne-cmd-trigger__hint {
    display: none;
  }
}
</style>
