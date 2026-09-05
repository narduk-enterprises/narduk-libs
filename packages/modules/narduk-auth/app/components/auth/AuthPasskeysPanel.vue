<script setup lang="ts">
import { browserSupportsWebAuthn } from '@simplewebauthn/browser'

import { type AuthPasskeySummary, useAuthApi } from '../../composables/useAuthApi'
import { toUserFacingError } from '../../utils/toUserFacingError'

const toast = useToast()
const { registerPasskey } = useAuth()
const { listPasskeys, revokePasskey } = useAuthApi()
const { data: authRuntime } = useAuthRuntimePublic()

const passkeys = shallowRef<AuthPasskeySummary[]>([])
const loading = shallowRef(true)
const registering = shallowRef(false)
const revokingId = shallowRef<string | null>(null)
const errorMessage = shallowRef('')
const newPasskeyName = ref('')
const browserHasWebAuthn = ref(false)

onMounted(() => {
  browserHasWebAuthn.value = browserSupportsWebAuthn()
})

const serverSupportsPasskeys = computed(() => authRuntime.value?.passkeysEnabled === true)
const canRegister = computed(() => browserHasWebAuthn.value && serverSupportsPasskeys.value)

async function refresh() {
  loading.value = true
  errorMessage.value = ''
  try {
    passkeys.value = await listPasskeys()
  } catch (error) {
    errorMessage.value = toUserFacingError(error, 'Could not load your passkeys.')
  } finally {
    loading.value = false
  }
}

async function onRegister() {
  registering.value = true
  errorMessage.value = ''
  try {
    await registerPasskey({ name: newPasskeyName.value.trim() || null })
    newPasskeyName.value = ''
    toast.add({ title: 'Passkey added', color: 'success' })
    await refresh()
  } catch (error) {
    // Dismissing the platform sheet is a choice, not a failure.
    if (
      error instanceof Error &&
      (error.name === 'NotAllowedError' || error.name === 'AbortError')
    ) {
      return
    }
    errorMessage.value = toUserFacingError(error, 'Could not add that passkey.')
  } finally {
    registering.value = false
  }
}

async function onRevoke(passkey: AuthPasskeySummary) {
  revokingId.value = passkey.id
  errorMessage.value = ''
  try {
    await revokePasskey(passkey.id)
    toast.add({ title: 'Passkey removed', color: 'success' })
    await refresh()
  } catch (error) {
    errorMessage.value = toUserFacingError(error, 'Could not remove that passkey.')
  } finally {
    revokingId.value = null
  }
}

onMounted(refresh)
</script>

<template>
  <UCard>
    <template #header>
      <div class="space-y-1">
        <h2 class="text-lg font-semibold text-highlighted">Passkeys</h2>
        <p class="text-sm text-toned">
          A passkey signs you in with Touch ID, Face ID, Windows Hello, or a security key. Your
          email and password keep working, so a lost passkey never locks you out.
        </p>
      </div>
    </template>

    <UAlert
      v-if="errorMessage"
      color="error"
      variant="subtle"
      title="Passkeys"
      :description="errorMessage"
      class="mb-4"
      data-testid="auth-passkeys-error"
    />

    <UAlert
      v-else-if="!loading && !serverSupportsPasskeys"
      color="neutral"
      variant="subtle"
      title="Passkeys are not enabled for this app"
      description="An administrator must set AUTH_LOCAL_PROVIDERS, AUTH_WEBAUTHN_RP_ID and AUTH_WEBAUTHN_ORIGIN before passkeys can be used here."
      class="mb-4"
    />

    <UAlert
      v-else-if="!loading && !browserHasWebAuthn"
      color="neutral"
      variant="subtle"
      title="This browser does not support passkeys"
      description="Open this page in a browser with WebAuthn support to add a passkey."
      class="mb-4"
    />

    <div class="space-y-4">
      <div v-if="loading" class="text-sm text-toned">Loading passkeys…</div>

      <p v-else-if="passkeys.length === 0" class="text-sm text-toned">No passkeys yet.</p>

      <ul v-else class="divide-y divide-default" data-testid="auth-passkeys-list">
        <li
          v-for="passkey in passkeys"
          :key="passkey.id"
          class="flex items-center justify-between gap-4 py-3"
        >
          <div class="min-w-0 space-y-1">
            <p class="truncate text-sm font-medium text-highlighted">
              {{ passkey.name ?? 'Unnamed passkey' }}
            </p>
            <p class="text-xs text-toned">
              Added {{ passkey.createdAt }} ·
              {{ passkey.lastUsedAt ? `last used ${passkey.lastUsedAt}` : 'never used' }} ·
              {{ passkey.backedUp ? 'synced' : 'device-bound' }}
            </p>
          </div>
          <UButton
            color="error"
            variant="ghost"
            size="sm"
            :loading="revokingId === passkey.id"
            @click="onRevoke(passkey)"
          >
            Remove
          </UButton>
        </li>
      </ul>

      <div v-if="canRegister" class="flex flex-col gap-2 sm:flex-row sm:items-center">
        <UInput
          v-model="newPasskeyName"
          placeholder="Name this passkey (optional)"
          class="w-full sm:max-w-xs"
          :maxlength="100"
        />
        <UButton
          color="primary"
          icon="i-lucide-fingerprint"
          :loading="registering"
          data-testid="auth-passkeys-add"
          @click="onRegister"
        >
          Add a passkey
        </UButton>
      </div>
    </div>
  </UCard>
</template>
