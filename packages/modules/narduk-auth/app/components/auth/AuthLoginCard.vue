<script setup lang="ts">
import { browserSupportsWebAuthn } from '@simplewebauthn/browser'
import { z } from 'zod'

import { resolveLoginSubtitle } from '../../utils/loginCopy'
import { resolveLocalRedirectRequest, withLocalRedirectQuery } from '../../utils/safeRedirectPath'
import { toUserFacingError } from '../../utils/toUserFacingError'

const props = withDefaults(
  defineProps<{
    redirectPath?: string
    subtitle?: string
    title?: string
  }>(),
  {
    title: 'Welcome back',
    subtitle: undefined,
    redirectPath: undefined,
  },
)

const emit = defineEmits<{
  success: [user: { email: string; id: string; name: string | null }]
}>()

const config = useRuntimeConfig()
const route = useRoute()
const { login, startOAuth, signInWithPasskey } = useAuth()

const { data: authRuntime } = useAuthRuntimePublic()

const schema = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(1, 'Password is required.'),
})

const state = reactive({
  email: '',
  password: '',
})

const loading = ref(false)
const appleLoading = ref(false)
const passkeyLoading = ref(false)
// WebAuthn is a browser API: on the server this is always false, so the button
// renders only after hydration rather than flashing an affordance the visiting
// browser cannot honour.
const browserHasWebAuthn = ref(false)
onMounted(() => {
  browserHasWebAuthn.value = browserSupportsWebAuthn()
})
const errorMsg = ref('')
const infoMsg = ref('')

const effectiveAuthBackend = computed(
  () => authRuntime.value?.authBackend ?? config.public.authBackend,
)
const effectiveAuthProviders = computed(
  () => authRuntime.value?.authProviders ?? config.public.authProviders,
)
const canUseApple = computed(
  () => effectiveAuthBackend.value === 'supabase' && effectiveAuthProviders.value.includes('apple'),
)
// `passkeysEnabled` is the server's own answer to "would a ceremony succeed?" —
// backend, provider opt-in AND a valid Relying Party binding. Falling back to
// the provider list alone would show a button that 501s on the first click, so
// an unresolved runtime answer hides the affordance rather than guessing.
const canUsePasskey = computed(
  () => browserHasWebAuthn.value && authRuntime.value?.passkeysEnabled === true,
)
const resolvedSubtitle = computed(() =>
  resolveLoginSubtitle(canUseApple.value, props.subtitle, canUsePasskey.value),
)
const canRegister = computed(() => config.public.authPublicSignup)
const redirectRequest = computed(() =>
  resolveLocalRedirectRequest(props.redirectPath, route.query.next, config.public.authRedirectPath),
)
const resolvedRedirectPath = computed(() => redirectRequest.value.path)
const registerLink = computed(() =>
  withLocalRedirectQuery(config.public.authRegisterPath, redirectRequest.value),
)
const resetLink = computed(() =>
  withLocalRedirectQuery(config.public.authResetPath, redirectRequest.value),
)

watchEffect(() => {
  if (typeof route.query.email === 'string' && !state.email) {
    state.email = route.query.email
  }

  if (route.query.checkEmail === '1') {
    infoMsg.value = `Check ${state.email !== '' ? state.email : 'your email'} to confirm the account.`
    return
  }

  if (route.query.reset === '1') {
    infoMsg.value = 'Your password was updated. Sign in with the new password.'
    return
  }

  infoMsg.value = ''
})

async function onSubmit() {
  loading.value = true
  errorMsg.value = ''

  try {
    const result = await login({
      email: state.email,
      password: state.password,
    })

    if (result.user) {
      emit('success', result.user)
      await navigateTo(result.redirectTo ?? resolvedRedirectPath.value, { replace: true })
      return
    }

    errorMsg.value = result.message ?? 'Sign-in did not complete.'
  } catch (error) {
    errorMsg.value = toUserFacingError(error, 'Invalid email or password.')
  } finally {
    loading.value = false
  }
}

async function onPasskeySignIn() {
  passkeyLoading.value = true
  errorMsg.value = ''

  try {
    await signInWithPasskey()
    await navigateTo(resolvedRedirectPath.value, { replace: true })
  } catch (error) {
    // A user who dismisses the platform sheet gets no error banner: cancelling
    // is a choice, not a failure.
    if (
      error instanceof Error &&
      (error.name === 'NotAllowedError' || error.name === 'AbortError')
    ) {
      return
    }
    errorMsg.value = toUserFacingError(error, 'Passkey sign-in did not complete.')
  } finally {
    passkeyLoading.value = false
  }
}

async function onAppleSignIn() {
  appleLoading.value = true
  errorMsg.value = ''

  try {
    const result = await startOAuth({
      provider: 'apple',
      next: resolvedRedirectPath.value,
    })
    await navigateTo(result.url, { external: true })
  } catch (error) {
    errorMsg.value = toUserFacingError(error, 'Unable to start Sign in with Apple.')
  } finally {
    appleLoading.value = false
  }
}
</script>

<template>
  <UCard class="w-full max-w-md">
    <template #header>
      <div class="space-y-2 text-center">
        <h1 class="text-2xl font-bold">
          {{ title }}
        </h1>
        <p class="text-sm text-toned">
          {{ resolvedSubtitle }}
        </p>
      </div>
    </template>

    <UAlert
      v-if="infoMsg"
      color="success"
      variant="subtle"
      title="Check your inbox"
      :description="infoMsg"
      class="mb-4"
    />

    <UAlert
      v-if="errorMsg"
      color="error"
      variant="subtle"
      title="Sign-in failed"
      :description="errorMsg"
      class="mb-4"
      data-testid="auth-login-error"
    />

    <div class="space-y-4">
      <UButton
        v-if="canUseApple"
        color="neutral"
        variant="solid"
        class="w-full justify-center"
        :loading="appleLoading"
        @click="onAppleSignIn"
      >
        Continue with Apple
      </UButton>

      <UButton
        v-if="canUsePasskey"
        color="primary"
        variant="soft"
        icon="i-lucide-fingerprint"
        class="w-full justify-center"
        :loading="passkeyLoading"
        data-testid="auth-login-passkey"
        @click="onPasskeySignIn"
      >
        Sign in with a passkey
      </UButton>

      <div
        v-if="canUseApple || canUsePasskey"
        class="flex items-center gap-3 text-xs uppercase tracking-[0.18em] text-dimmed"
      >
        <span class="h-px flex-1 bg-default" />
        <span>Or continue with email</span>
        <span class="h-px flex-1 bg-default" />
      </div>

      <UForm :schema="schema" :state="state" class="space-y-4" @submit="onSubmit">
        <UFormField name="email" label="Email">
          <UInput
            v-model="state.email"
            type="email"
            autocomplete="email"
            placeholder="you@example.com"
            class="w-full"
            data-testid="auth-login-email"
          />
        </UFormField>

        <UFormField name="password" label="Password">
          <UInput
            v-model="state.password"
            type="password"
            autocomplete="current-password"
            placeholder="••••••••"
            class="w-full"
            data-testid="auth-login-password"
          />
        </UFormField>

        <div class="flex justify-end">
          <ULink :to="resetLink" class="text-xs text-toned hover:text-primary">
            Forgot your password?
          </ULink>
        </div>

        <UButton
          type="submit"
          color="primary"
          class="w-full justify-center"
          :loading="loading"
          data-testid="auth-login-submit"
        >
          Sign In
        </UButton>
      </UForm>
    </div>

    <template #footer>
      <p class="text-center text-sm text-toned">
        <template v-if="canRegister">
          Don&apos;t have an account?
          <ULink :to="registerLink" class="font-medium text-primary hover:underline">
            Sign up
          </ULink>
        </template>
        <template v-else> Need access? Contact an administrator for an invite. </template>
      </p>
    </template>
  </UCard>
</template>
