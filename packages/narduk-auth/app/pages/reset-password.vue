<script setup lang="ts">
import { z } from 'zod'

import { sanitizeLocalRedirectPath } from '../utils/safeRedirectPath'
import { toUserFacingError } from '../utils/toUserFacingError'

const config = useRuntimeConfig()
const route = useRoute()
const { user, changePassword, completeLocalEmailPassword, requestPasswordReset } = useAuth()

useSeoMeta({
  title: 'Reset Password',
  description: 'Request a password reset link or set a new password after recovery.',
  robots: 'noindex, nofollow',
})

const requestSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
})

const updateSchema = z
  .object({
    currentPassword: z.string().optional(),
    newPassword: z
      .string()
      .min(8, 'Password must be at least 8 characters.')
      .max(200, 'Password must be 200 characters or fewer.'),
    confirmPassword: z
      .string()
      .min(8, 'Confirm your new password.')
      .max(200, 'Password must be 200 characters or fewer.'),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match.',
  })

const requestState = reactive({
  email: typeof route.query.email === 'string' ? route.query.email : '',
})

const updateState = reactive({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
})

const loading = ref(false)
const successMsg = ref('')
const errorMsg = ref('')
const selfServeLink = ref('')

const localEmailToken = computed(() =>
  typeof route.query.token === 'string' ? route.query.token : '',
)
const isLocalEmailRecovery = computed(() => Boolean(localEmailToken.value))
const isRecoveryMode = computed(() => route.query.recovery === '1' || isLocalEmailRecovery.value)
const needsCurrentPassword = computed(
  () => !isLocalEmailRecovery.value && !user.value?.needsPasswordSetup && !isRecoveryMode.value,
)
const resolvedNextPath = computed(() =>
  sanitizeLocalRedirectPath(route.query.next, config.public.authRedirectPath),
)

async function onRequestReset() {
  loading.value = true
  errorMsg.value = ''
  successMsg.value = ''
  selfServeLink.value = ''

  try {
    const result = await requestPasswordReset({
      email: requestState.email,
      next: resolvedNextPath.value,
    })
    successMsg.value = result.message ?? 'Check your email for the reset link.'
    selfServeLink.value = result.selfServeLink ?? ''
  } catch (error) {
    errorMsg.value = toUserFacingError(error, 'Unable to send the reset email.')
  } finally {
    loading.value = false
  }
}

async function onUpdatePassword() {
  if (needsCurrentPassword.value && !updateState.currentPassword) {
    errorMsg.value = 'Current password is required before setting a new one.'
    return
  }

  loading.value = true
  errorMsg.value = ''
  successMsg.value = ''

  try {
    if (isLocalEmailRecovery.value) {
      const result = await completeLocalEmailPassword({
        token: localEmailToken.value,
        newPassword: updateState.newPassword,
      })
      await navigateTo(result.redirectTo ?? resolvedNextPath.value, { replace: true })
      return
    }

    await changePassword({
      currentPassword: updateState.currentPassword || undefined,
      newPassword: updateState.newPassword,
    })
    await navigateTo(
      {
        path: config.public.authLoginPath,
        query: { reset: '1' },
      },
      { replace: true },
    )
  } catch (error) {
    errorMsg.value = toUserFacingError(error, 'Unable to update the password.')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div
    class="mx-auto flex min-h-[calc(100vh-8rem)] max-w-xl items-center justify-center px-4 py-12"
  >
    <UCard class="w-full">
      <template #header>
        <div class="space-y-2 text-center">
          <h1 class="text-2xl font-bold">
            {{ isRecoveryMode ? 'Choose a new password' : 'Reset your password' }}
          </h1>
          <p class="text-sm text-muted">
            {{
              isRecoveryMode
                ? 'Finish recovery on this app without leaving your current domain.'
                : 'We will send a password reset link to your email address.'
            }}
          </p>
        </div>
      </template>

      <UAlert
        v-if="successMsg"
        color="success"
        variant="subtle"
        title="Email sent"
        :description="successMsg"
        class="mb-4"
      />

      <UButton
        v-if="selfServeLink"
        :to="selfServeLink"
        class="mb-4 w-full justify-center"
        color="neutral"
        variant="soft"
      >
        Continue with local setup link
      </UButton>

      <UAlert
        v-if="errorMsg"
        color="error"
        variant="subtle"
        title="Request failed"
        :description="errorMsg"
        class="mb-4"
      />

      <UForm
        v-if="!isRecoveryMode"
        :schema="requestSchema"
        :state="requestState"
        class="space-y-4"
        @submit="onRequestReset"
      >
        <UFormField name="email" label="Email">
          <UInput v-model="requestState.email" type="email" class="w-full" />
        </UFormField>

        <UButton type="submit" class="w-full justify-center" :loading="loading">
          Send reset link
        </UButton>
      </UForm>

      <UForm
        v-else
        :schema="updateSchema"
        :state="updateState"
        class="space-y-4"
        @submit="onUpdatePassword"
      >
        <UFormField v-if="needsCurrentPassword" name="currentPassword" label="Current password">
          <UInput v-model="updateState.currentPassword" type="password" class="w-full" />
        </UFormField>

        <UFormField name="newPassword" label="New password">
          <UInput v-model="updateState.newPassword" type="password" class="w-full" />
        </UFormField>

        <UFormField name="confirmPassword" label="Confirm new password">
          <UInput v-model="updateState.confirmPassword" type="password" class="w-full" />
        </UFormField>

        <UButton type="submit" class="w-full justify-center" :loading="loading">
          Save new password
        </UButton>
      </UForm>

      <template #footer>
        <div class="flex justify-center">
          <UButton
            :to="isRecoveryMode ? resolvedNextPath : config.public.authLoginPath"
            color="neutral"
            variant="ghost"
          >
            {{ isRecoveryMode ? 'Back to app' : 'Back to sign in' }}
          </UButton>
        </div>
      </template>
    </UCard>
  </div>
</template>
