<script setup lang="ts">
// `privacyPolicyTemplate` is auto-imported by the narduk-shell module.
// Placeholder sections only: the page stays a draft until approved wording
// replaces every one of them.
const privacy = privacyPolicyTemplate({
  appName: 'Example App',
  companyName: 'Example Co',
  contactEmail: 'privacy@example.test',
  processors: [{ name: 'Example Analytics', purpose: 'analytics' }],
})
</script>

<template>
  <NeLegalPage :title="privacy.title" :sections="privacy.sections" last-updated="2026-03-08" />
</template>
