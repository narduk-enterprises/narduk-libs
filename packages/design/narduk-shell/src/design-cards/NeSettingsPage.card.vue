<script setup lang="ts">
/*
 * NE Base design card for NeSettingsPage — components backlog item 19
 * (narduk-libs#266).
 *
 * The plan's own usage example (docs/plans/components-library-plan.md §2
 * item 19): a page title over one or more NeFormSection groups, with a
 * sticky save bar so the save action stays reachable as sections stack up.
 */
import UFormField from '@nuxt/ui/components/FormField.vue'
import UInput from '@nuxt/ui/components/Input.vue'
import { reactive } from 'vue'

import NeFormSection from '../runtime/components/NeFormSection.vue'
import NeSettingsPage from '../runtime/components/NeSettingsPage.vue'

const state = reactive({ name: 'Ada Lovelace', email: 'ada@example.com' })
async function save() {
  await new Promise((resolve) => setTimeout(resolve, 1000))
}
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ne-settings-page"
    data-name="Settings page"
    data-group="Shell"
  >
    <h2>Settings page</h2>
    <p>
      A page title (<code>NePageHeader</code>) over a sticky-save <code>NeForm</code>, composed from
      one or more <code>NeFormSection</code>s.
    </p>
    <div class="preview-row">
      <NeSettingsPage
        title="Settings"
        description="Manage your account."
        :state="state"
        :on-submit="save"
      >
        <NeFormSection title="Profile" description="Your public account details.">
          <UFormField name="name" label="Name">
            <UInput v-model="state.name" />
          </UFormField>
          <UFormField name="email" label="Email">
            <UInput v-model="state.email" type="email" />
          </UFormField>
        </NeFormSection>
      </NeSettingsPage>
    </div>
  </section>
</template>
