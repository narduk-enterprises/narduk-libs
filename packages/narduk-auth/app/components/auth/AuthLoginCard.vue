<script setup lang="ts">
import { z } from 'zod'

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
    subtitle: 'Sign in with Apple first, or use email if you prefer.',
    redirectPath: undefined,
  },
)

const emit = defineEmits<{
  success: [user: { email: string; id: string; name: string | null }]
}>()

const config = useRuntimeConfig()
const route = useRoute()
const { login, startOAuth } = useAuth()

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
        <p class="text-sm text-muted">
          {{ subtitle }}
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

      <div
        v-if="canUseApple"
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
            placeholder="you@example.com"
            class="w-full"
            data-testid="auth-login-email"
          />
        </UFormField>

        <UFormField name="password" label="Password">
          <UInput
            v-model="state.password"
            type="password"
            placeholder="••••••••"
            class="w-full"
            data-testid="auth-login-password"
          />
        </UFormField>

        <div class="flex justify-end">
          <ULink :to="resetLink" class="text-xs text-muted hover:text-primary">
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
      <p class="text-center text-sm text-muted">
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
