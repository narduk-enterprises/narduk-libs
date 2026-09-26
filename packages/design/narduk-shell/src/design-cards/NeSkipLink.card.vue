<script setup lang="ts">
/*
 * NE Base design card for NeSkipLink (narduk-libs#977).
 *
 * The link is invisible until it has focus, so the card says how to see it:
 * Tab into the row. It is pure CSS (`:focus`), so it works in the statically
 * prerendered gallery with no script. The row is positioned so the revealed
 * link draws over the row's own corner, the way it draws over a layout's.
 * Following it moves focus to the target below, which is how a reviewer checks
 * the behaviour rather than only the look.
 */
import NeSkipLink from '../runtime/components/NeSkipLink.vue'
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ne-skip-link"
    data-name="Skip link"
    data-group="Shell"
  >
    <h2>Skip link</h2>
    <p>
      Hidden until focused. Tab into the row below to reveal it; Enter moves focus to the target,
      not only the scroll position.
    </p>
    <div class="preview-row" style="position: relative; min-height: 3rem">
      <NeSkipLink target="ne-skip-link-card-target" label="Skip to content" />
    </div>
    <div id="ne-skip-link-card-target" class="preview-row">
      <p>The target: focus lands here, and the next Tab continues from here.</p>
    </div>
  </section>
</template>
