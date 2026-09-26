<script setup lang="ts">
/*
 * NE Base design card for NeLegalPage (narduk-libs#388). The template's
 * sections are placeholders by decision ("Build, wording later"), so the card
 * shows the draft state a reviewer must be able to recognise at a glance.
 */
import NeLegalPage from '../runtime/components/NeLegalPage.vue'
import { privacyPolicyTemplate } from '../runtime/utils/legal-templates'

const draft = privacyPolicyTemplate({
  appName: 'Example App',
  companyName: 'Example Co',
  contactEmail: 'privacy@example.test',
  processors: [{ name: 'Example Analytics', purpose: 'analytics' }],
})
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ne-legal-page"
    data-name="Legal page"
    data-group="Shell"
  >
    <h2>Legal page</h2>
    <p>
      Title, last-updated date, contents and anchored sections. Template sections are placeholders
      and keep the page a draft until approved wording replaces them.
    </p>

    <div class="preview-row">
      <NeLegalPage
        :title="draft.title"
        :sections="draft.sections.slice(0, 3)"
        last-updated="2026-03-08"
      />
      <p class="mono">draft · placeholder sections from privacyPolicyTemplate()</p>
    </div>
  </section>
</template>
