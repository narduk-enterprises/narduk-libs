<script setup lang="ts">
import { useMcpOAuthConsent } from '../../composables/useMcpOAuthConsent'

// Default MCP OAuth consent page. An app replaces it by defining its own page
// at the same path (`nardukAuth.mcpOAuth.consentPath`) with useMcpOAuthConsent().
definePageMeta({ layout: 'auth' })
useSeoMeta({ title: 'Connect an app', referrer: 'no-referrer', robots: 'noindex, nofollow' })
const { state, loading, busy, failure, approve, deny, returnToClient } = useMcpOAuthConsent()
</script>

<template>
  <UCard class="mx-auto w-full max-w-md">
    <template #header><h1 class="text-xl font-semibold">Connect an app</h1></template>
    <p v-if="loading || state?.status === 'login'" class="text-muted">Loading…</p>
    <div v-else-if="state?.status === 'error'" class="space-y-4">
      <UAlert color="error" :title="state.message" />
      <UButton v-if="state.redirectTo" block variant="outline" @click="returnToClient">
        Return to the app
      </UButton>
    </div>
    <div v-else-if="state?.status === 'consent'" class="space-y-4">
      <p>
        <strong>{{ state.client.name }}</strong> wants to use your account
        <span v-if="state.account.name">({{ state.account.name }}, {{ state.account.email }})</span>
        <span v-else>({{ state.account.email }})</span>.
      </p>
      <p class="text-muted text-sm">
        <template v-if="state.client.domain">Published by {{ state.client.domain }}. </template>
        <template v-else>This app named itself; its name is not verified. </template>
        Access goes to <strong>{{ state.redirectHost }}</strong
        >.
      </p>
      <UAlert
        v-if="state.redirectIsLoopback"
        color="warning"
        title="This sends access to an app on this computer. Continue only if you just started connecting from it."
      />
      <ul v-if="state.scopes.length" class="text-sm">
        <li v-for="scope in state.scopes" :key="scope">{{ scope }}</li>
      </ul>
      <div class="flex gap-2">
        <UButton :loading="busy" @click="approve">Allow</UButton>
        <UButton variant="ghost" :disabled="busy" @click="deny">Deny</UButton>
      </div>
      <UAlert v-if="failure" color="error" :title="failure" />
    </div>
  </UCard>
</template>
