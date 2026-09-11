<script setup lang="ts">
/*
 * NE Base design card for NeForm — components backlog item 19
 * (narduk-libs#266).
 *
 * A real, working example: submitting waits a second (so the loading-auto
 * spinner is visible to a reviewer, not just implied), then clears the
 * "Unsaved changes" note. The second row shows the validation-failure path
 * (submit it to see the field focus and the error message land).
 */
import UFormField from '@nuxt/ui/components/FormField.vue'
import UInput from '@nuxt/ui/components/Input.vue'
import { reactive } from 'vue'

import NeForm from '../runtime/components/NeForm.vue'

const profile = reactive({ name: 'Ada Lovelace' })
async function saveProfile() {
  await new Promise((resolve) => setTimeout(resolve, 1000))
}

const required = reactive({ name: '' })
function validateRequired(state: Record<string, unknown>) {
  return state.name ? [] : [{ name: 'name', message: 'Name is required' }]
}
</script>

<template>
  <section class="preview-card" data-design-card="ne-form" data-name="Form" data-group="Shell">
    <h2>Form</h2>
    <p>
      Wraps <code>UForm</code> with a save bar that cannot double-submit, a dirty note that only
      clears once the save actually succeeds, and a spinner on the button that needs no ref of its
      own (<code>loading-auto</code>).
    </p>
    <div class="preview-row">
      <NeForm :state="profile" :on-submit="saveProfile">
        <UFormField name="name" label="Name">
          <UInput v-model="profile.name" />
        </UFormField>
      </NeForm>
    </div>
    <p class="mono">Submit with an empty name to see validation focus the field:</p>
    <div class="preview-row">
      <NeForm :state="required" :validate="validateRequired" :on-submit="() => {}">
        <UFormField name="name" label="Name">
          <UInput v-model="required.name" />
        </UFormField>
      </NeForm>
    </div>
  </section>
</template>
