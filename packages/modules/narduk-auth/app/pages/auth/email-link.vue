<script setup lang="ts">
import { FULL_PAGE_LOAD, signInLandingPath } from '../../utils/fullPageLoad'
import { sanitizeLocalRedirectPath } from '../../utils/safeRedirectPath'
import { toUserFacingError } from '../../utils/toUserFacingError'

useSeoMeta({
  title: 'Sign In',
  description: 'Finish signing in with your email link.',
  robots: 'noindex, nofollow',
})

const config = useRuntimeConfig()
const route = useRoute()
const { signInWithEmailLink } = useAuth()

// The link carries its token in the fragment (`#token=…`), which never reaches
// a server log. Loading this page only reads it: the link is spent by the POST
// behind the button, so a mail scanner that opens the link cannot use it up.
const token = computed(() => {
  const fromHash = new URLSearchParams(route.hash.replace(/^#/u, '')).get('token')
  return fromHash ?? ''
})
const nextPath = computed(() =>
  sanitizeLocalRedirectPath(route.query.next, config.public.authRedirectPath),
)
const loading = ref(false)
const errorMsg = ref('')

async function onSignIn() {
  loading.value = true
  errorMsg.value = ''

  try {
    const result = await signInWithEmailLink({ token: token.value })
    await navigateTo(signInLandingPath(result.redirectTo, nextPath.value), FULL_PAGE_LOAD)
  } catch (error) {
    errorMsg.value = toUserFacingError(error, 'This sign-in link could not be used.')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="flex min-h-[calc(100dvh-8rem)] items-center justify-center px-4 py-12">
    <UCard class="w-full max-w-md">
      <template #header>
        <div class="space-y-2 text-center">
          <h1 class="text-2xl font-bold text-highlighted">Finish signing in</h1>
          <p class="text-sm text-toned">Your sign-in link works once.</p>
        </div>
      </template>

      <UAlert
        v-if="errorMsg"
        color="error"
        variant="subtle"
        title="Sign-in failed"
        :description="errorMsg"
        class="mb-4"
        data-testid="auth-email-link-error"
      />
      <UAlert
        v-if="!token"
        color="warning"
        variant="subtle"
        title="This link is incomplete"
        description="Open the link from your email again, or request a new one."
        class="mb-4"
      />

      <UButton
        color="primary"
        class="w-full justify-center"
        :disabled="!token"
        :loading="loading"
        data-testid="auth-email-link-submit"
        @click="onSignIn"
      >
        Sign in
      </UButton>

      <template #footer>
        <p class="text-center text-sm text-toned">
          <ULink :to="config.public.authLoginPath" class="font-medium text-primary hover:underline">
            Back to sign in
          </ULink>
        </p>
      </template>
    </UCard>
  </div>
</template>
