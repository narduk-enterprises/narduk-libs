<script setup lang="ts">
/*
 * NE Base design card for NeCommandPaletteTrigger: the header button that
 * looks like a search field and opens the palette. Shown full width, compact
 * (icon only, for a phone header) and as the no-JS form. The shortcut hint is
 * written after mount, so the server markup has no hint and the gallery cannot
 * mismatch on hydrate. Shortcuts are off in the card (the palette card owns
 * them).
 */
import NeCommandPaletteTrigger from '../runtime/components/NeCommandPaletteTrigger.vue'
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ne-command-palette-trigger"
    data-name="Command palette trigger"
    data-group="Shell"
  >
    <h2>Command palette trigger</h2>
    <p>
      A button that reads as a search field. It opens the palette rather than taking typing, so one
      input exists on the page and a phone tap opens the sheet. The hint is hidden on touch screens.
    </p>
    <div class="preview-row">
      <NeCommandPaletteTrigger placeholder="Find a river, town or gauge" :shortcuts="false" />
      <p class="mono">default · hint is ⌘K on a Mac, Ctrl K elsewhere</p>
    </div>
    <div class="preview-row">
      <NeCommandPaletteTrigger compact placeholder="Search" :shortcuts="false" />
      <p class="mono">compact · icon only, labelled for assistive tech</p>
    </div>
    <div class="preview-row">
      <NeCommandPaletteTrigger
        fallback-action="/search"
        placeholder="Find a river, town or gauge"
        :shortcuts="false"
      />
      <p class="mono">fallbackAction · a GET form until the script has run</p>
    </div>
  </section>
</template>
