<script setup lang="ts">
import type { NativeAuthorizationRequest } from '../../../shared/types/native-auth'

definePageMeta({ layout: 'auth' })
useSeoMeta({ title: 'Connect your app', referrer: 'no-referrer' })
const route = useRoute()
const { user, loggedIn, fetch: refreshSession } = useUserSession()
const request = computed(
  () =>
    ({
      clientId: route.query.clientId,
      redirectUri: route.query.redirectUri,
      codeChallenge: route.query.codeChallenge,
      codeChallengeMethod: route.query.codeChallengeMethod,
      state: route.query.state,
    }) as NativeAuthorizationRequest,
)
const { data, error } = await useFetch('/api/auth/native/request', { query: request })
const busy = ref(false)
const failure = ref('')
const loginPath = computed(() => `/login?next=${encodeURIComponent(route.fullPath)}`)
onMounted(refreshSession)

async function connect() {
  busy.value = true
  failure.value = ''
  try {
    const result = await $fetch<{ redirectTo: string }>('/api/auth/native/authorize', {
      method: 'POST',
      body: request.value,
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
    if (import.meta.client) window.location.assign(result.redirectTo)
  } catch {
    failure.value = 'The app could not connect. Sign in again and retry.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UCard class="mx-auto w-full max-w-md">
    <template #header><h1 class="text-xl font-semibold">Connect your app</h1></template>
    <UAlert
      v-if="error"
      color="error"
      title="This sign-in link is invalid. Start again in your app."
    />
    <div v-else-if="data" class="space-y-5">
      <p>
        Connect <strong>{{ data.clientName }}</strong> to your account.
      </p>
      <template v-if="loggedIn">
        <p class="text-muted">
          Signed in as {{ user?.email }}. The app will have your account’s access.
        </p>
        <UButton block :loading="busy" @click="connect">Connect {{ data.clientName }}</UButton>
        <UButton block variant="ghost" to="/">Cancel</UButton>
      </template>
      <UButton v-else block :to="loginPath">Sign in to continue</UButton>
      <UAlert v-if="failure" color="error" :title="failure" />
    </div>
  </UCard>
</template>
