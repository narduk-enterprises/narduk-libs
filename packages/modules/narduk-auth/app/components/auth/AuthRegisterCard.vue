<script setup lang="ts">
import { z } from 'zod'

import { cardOAuthOffers } from '../../internal/auth-card-actions'
import { resolveLocalRedirectRequest, withLocalRedirectQuery } from '../../utils/safeRedirectPath'
import { toUserFacingError } from '../../utils/toUserFacingError'

import AuthProviderButtons from './AuthProviderButtons.vue'

const props = withDefaults(
  defineProps<{
    redirectPath?: string
    subtitle?: string
    title?: string
  }>(),
  {
    title: 'Create an account',
    subtitle: 'Start with Apple, then fall back to email when needed.',
    redirectPath: undefined,
  },
)

const emit = defineEmits<{
  success: [user: { email: string; id: string; name: string | null }]
}>()

const config = useRuntimeConfig()
const route = useRoute()
const { register } = useAuth()

const { data: authRuntime } = useAuthRuntimePublic()

const schema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters.'),
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
})

const state = reactive({
  name: '',
  email: '',
  password: '',
})

const loading = ref(false)
const errorMsg = ref('')

const oauthOffers = computed(() => cardOAuthOffers(authRuntime.value, config.public))
const redirectRequest = computed(() =>
  resolveLocalRedirectRequest(props.redirectPath, route.query.next, config.public.authRedirectPath),
)
const resolvedRedirectPath = computed(() => redirectRequest.value.path)
const loginLink = computed(() =>
  withLocalRedirectQuery(config.public.authLoginPath, redirectRequest.value),
)

async function onSubmit() {
  loading.value = true
  errorMsg.value = ''

  try {
    const result = await register({
      name: state.name,
      email: state.email,
      password: state.password,
      next: resolvedRedirectPath.value,
    })

    if (result.user) {
      emit('success', result.user)
      await navigateTo(result.redirectTo ?? resolvedRedirectPath.value, { replace: true })
      return
    }

    if (result.nextStep === 'email_confirmation') {
      await navigateTo(
        withLocalRedirectQuery(config.public.authLoginPath, redirectRequest.value, {
          checkEmail: '1',
          email: state.email,
        }),
        { replace: true },
      )
      return
    }

    errorMsg.value = result.message ?? 'Signup did not complete.'
  } catch (error) {
    errorMsg.value = toUserFacingError(error, 'Unable to create the account.')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UCard class="w-full max-w-md">
    <template #header>
      <div class="space-y-2 text-center">
        <h1 class="text-2xl font-bold text-highlighted">
          {{ title }}
        </h1>
        <p class="text-sm text-muted">
          {{ subtitle }}
        </p>
      </div>
    </template>

    <UAlert
      v-if="errorMsg"
      color="error"
      variant="subtle"
      title="Signup failed"
      :description="errorMsg"
      class="mb-4"
      data-testid="auth-register-error"
    />

    <div class="space-y-4">
      <AuthProviderButtons
        v-model:error="errorMsg"
        :apple="oauthOffers.apple"
        :google="oauthOffers.google"
        :next="resolvedRedirectPath"
      />

      <div
        v-if="oauthOffers.apple || oauthOffers.google"
        class="flex items-center gap-3 text-xs uppercase tracking-[0.18em] text-dimmed"
      >
        <span class="h-px flex-1 bg-default" />
        <span>Or sign up with email</span>
        <span class="h-px flex-1 bg-default" />
      </div>

      <UForm :schema="schema" :state="state" class="space-y-4" @submit="onSubmit">
        <UFormField name="name" label="Name">
          <UInput
            v-model="state.name"
            autocomplete="name"
            placeholder="Jane Doe"
            class="w-full"
            data-testid="auth-register-name"
          />
        </UFormField>

        <UFormField name="email" label="Email">
          <UInput
            v-model="state.email"
            type="email"
            autocomplete="email"
            placeholder="you@example.com"
            class="w-full"
            data-testid="auth-register-email"
          />
        </UFormField>

        <UFormField name="password" label="Password">
          <UInput
            v-model="state.password"
            type="password"
            autocomplete="new-password"
            placeholder="Create a strong password"
            class="w-full"
            data-testid="auth-register-password"
          />
        </UFormField>

        <UButton
          type="submit"
          color="primary"
          class="w-full justify-center"
          :loading="loading"
          data-testid="auth-register-submit"
        >
          Create Account
        </UButton>
      </UForm>
    </div>

    <template #footer>
      <p class="text-center text-sm text-muted">
        Already have an account?
        <ULink :to="loginLink" class="font-medium text-primary hover:underline"> Sign in </ULink>
      </p>
    </template>
  </UCard>
</template>
