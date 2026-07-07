<script setup lang="ts">
definePageMeta({ middleware: ['auth'] })

useSeoMeta({
  title: 'Dashboard',
  description: 'Your account dashboard.',
})

const { user, logout } = useAuth()

async function signOut() {
  await logout()
  await navigateTo('/login', { replace: true })
}
</script>

<template>
  <UPage>
    <UPageHero
      title="Welcome back"
      :description="user?.email ? `Signed in as ${user.email}` : 'Your session is active.'"
    >
      <template #links>
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-log-out"
          data-testid="auth-signout"
          @click="signOut"
        >
          Sign out
        </UButton>
      </template>
    </UPageHero>

    <UPageSection
      title="Protected route confirmed"
      description="This shared dashboard exists so every template app and derived app has a stable post-login destination."
    >
      <UCard data-testid="auth-dashboard" class="max-w-2xl">
        <div class="space-y-3">
          <div>
            <p class="text-sm text-muted">Current user</p>
            <p class="font-medium" data-testid="auth-user-email">
              {{ user?.email || 'Unknown user' }}
            </p>
          </div>

          <div>
            <p class="text-sm text-muted">Display name</p>
            <p class="font-medium" data-testid="auth-user-name">{{ user?.name || 'User' }}</p>
          </div>
        </div>
      </UCard>
    </UPageSection>
  </UPage>
</template>
