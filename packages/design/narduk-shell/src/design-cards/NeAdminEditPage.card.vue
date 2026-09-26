<script setup lang="ts">
/*
 * NE Base design card for NeAdminEditPage — components backlog item 20
 * (narduk-libs#267): a page header over NeForm with a sticky save bar and a
 * cancel action. Cancel is an `onCancel` button rather than `cancelTo` here,
 * because this card server-renders with no router.
 */
import UFormField from '@nuxt/ui/components/FormField.vue'
import UInput from '@nuxt/ui/components/Input.vue'
import { reactive } from 'vue'

import NeAdminEditPage from '../runtime/components/NeAdminEditPage.vue'
import NeFormSection from '../runtime/components/NeFormSection.vue'

const state = reactive({ name: 'runner-01', pool: 'ord-1' })

async function save() {
  await new Promise((resolve) => setTimeout(resolve, 1000))
}

function cancel() {}
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ne-admin-edit-page"
    data-name="Admin edit page"
    data-group="Shell"
  >
    <h2>Admin edit page</h2>
    <p>
      <code>NePageHeader</code> over a sticky-save <code>NeForm</code> with a cancel action, held
      behind <code>NeStatePanel</code> until the record has loaded.
    </p>

    <div class="preview-row">
      <NeAdminEditPage
        title="Edit runner"
        eyebrow="Runners"
        :state="state"
        save-label="Save runner"
        :on-submit="save"
        :on-cancel="cancel"
      >
        <NeFormSection title="General">
          <UFormField name="name" label="Name">
            <UInput v-model="state.name" />
          </UFormField>
          <UFormField name="pool" label="Pool">
            <UInput v-model="state.pool" />
          </UFormField>
        </NeFormSection>
      </NeAdminEditPage>
      <p class="mono">editing · Cancel never submits</p>
    </div>

    <div class="preview-row">
      <NeAdminEditPage
        title="Edit runner"
        :state="state"
        status="pending"
        loading-title="Loading runner"
      />
      <p class="mono">loading · no form until the record is here</p>
    </div>
  </section>
</template>
