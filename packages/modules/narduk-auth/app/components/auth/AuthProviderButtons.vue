<script setup lang="ts">
import { toRef } from 'vue'

import { useCardOAuthStart } from '../../internal/auth-card-actions'

/**
 * "Continue with Apple / Google" for the login and register cards
 * (narduk-libs#164, #1951). The card decides which providers are on; a start
 * failure lands in the card's `v-model:error`.
 */
const props = defineProps<{ apple: boolean; google: boolean; next: string }>()
const errorMsg = defineModel<string>('error', { required: true })

const { startOAuth } = useAuth()
const oauth = useCardOAuthStart({
  errorMsg,
  navigate: (url) => navigateTo(url, { external: true }),
  next: toRef(props, 'next'),
  startOAuth,
})
</script>

<template>
  <div v-if="apple || google" class="space-y-4">
    <UButton
      v-if="apple"
      color="neutral"
      variant="solid"
      class="w-full justify-center"
      :loading="oauth.loading.value === 'apple'"
      @click="oauth.start('apple')"
    >
      Continue with Apple
    </UButton>

    <UButton
      v-if="google"
      color="neutral"
      variant="outline"
      class="w-full justify-center"
      :loading="oauth.loading.value === 'google'"
      data-testid="auth-google"
      @click="oauth.start('google')"
    >
      Continue with Google
    </UButton>
  </div>
</template>
