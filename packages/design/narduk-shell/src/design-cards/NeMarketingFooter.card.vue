<script setup lang="ts">
/*
 * NE Base design card for NeMarketingFooter — components backlog item 21
 * (narduk-libs#268). Link columns in `#top` (Nuxt UI's `UFooterColumns`,
 * imported explicitly because the renderer mounts this card outside the Nuxt
 * module) and the left / centre / right row below the `--ne-hairline` rule.
 * No `to` on the links: the card is prerendered outside any router.
 */
import UButton from '@nuxt/ui/components/Button.vue'
import UFooterColumns from '@nuxt/ui/components/FooterColumns.vue'

import NeMarketingFooter from '../runtime/components/NeMarketingFooter.vue'

const columns = [
  {
    children: [{ label: 'Breakers' }, { label: 'Transformers' }, { label: 'Switchgear' }],
    label: 'Catalog',
  },
  { children: [{ label: 'About' }, { label: 'Contact' }], label: 'Company' },
]
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ne-marketing-footer"
    data-name="Marketing footer"
    data-group="Marketing"
  >
    <h2>Marketing footer</h2>
    <p>
      <code>UFooter</code> under a <code>--ne-hairline</code> rule. Columns are
      <code>UFooterColumns</code> in <code>#top</code>.
    </p>

    <div class="preview-row">
      <NeMarketingFooter>
        <template #top>
          <UFooterColumns :columns="columns" />
        </template>
        <template #left>
          <p class="text-sm text-muted">© 2026 Example Co.</p>
        </template>
        <template #right>
          <UButton label="Contact" color="neutral" variant="ghost" />
        </template>
      </NeMarketingFooter>
      <p class="mono">#top columns · #left · #right</p>
    </div>
  </section>
</template>
