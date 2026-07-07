<script setup lang="ts">
import { toUserFacingError } from '../../utils/toUserFacingError'

const props = withDefaults(
  defineProps<{
    description?: string
    title?: string
  }>(),
  {
    title: 'Finishing sign-in',
    description: 'We are validating the auth callback and creating your app session.',
  },
)

const config = useRuntimeConfig()
const route = useRoute()
const { exchangeSession } = useAuth()

const status = ref<'loading' | 'error'>('loading')
const errorMsg = ref('')

onMounted(async () => {
  const code = typeof route.query.code === 'string' ? route.query.code : ''
  const next = typeof route.query.next === 'string' ? route.query.next : undefined
  const providerError =
    typeof route.query.error_description === 'string'
      ? route.query.error_description
      : typeof route.query.error === 'string'
        ? route.query.error
        : ''

  if (!code) {
    status.value = 'error'
    errorMsg.value = providerError !== '' ? providerError : 'The auth callback is missing its code.'
    return
  }

  try {
    const result = await exchangeSession({ code, next })
    await navigateTo(result.redirectTo ?? config.public.authRedirectPath, { replace: true })
  } catch (error) {
    status.value = 'error'
    errorMsg.value = toUserFacingError(error, 'The callback could not be exchanged for a session.')
  }
})
</script>

<template>
  <UCard class="w-full max-w-lg">
    <template #header>
      <div class="space-y-2 text-center">
        <h1 class="text-2xl font-bold">
          {{ props.title }}
        </h1>
        <p class="text-sm text-muted">
          {{ props.description }}
        </p>
      </div>
    </template>

    <div v-if="status === 'loading'" class="space-y-4 py-4 text-center">
      <UIcon
        name="i-lucide-loader-circle"
        class="mx-auto size-8 animate-spin text-primary"
        alt=""
      />
      <p class="text-sm text-muted">Creating your first-party session on this app…</p>
    </div>

    <UAlert
      v-else
      color="error"
      variant="subtle"
      title="Auth callback failed"
      :description="errorMsg"
    />

    <template v-if="status === 'error'" #footer>
      <div class="flex justify-center">
        <UButton :to="config.public.authLoginPath" color="primary" variant="soft">
          Back to sign in
        </UButton>
      </div>
    </template>
  </UCard>
</template>
