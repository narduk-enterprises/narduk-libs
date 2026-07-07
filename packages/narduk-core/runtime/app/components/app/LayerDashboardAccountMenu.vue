<script setup lang="ts">
import { readRuntimeConfigString } from '../../utils/readRuntimeConfigString'

interface DashboardSessionUser {
  email?: string | null
  name?: string | null
}

const config = useRuntimeConfig()
const csrfFetch = useCsrfFetch()
const { loggedIn, user, clear } = useUserSession()

const isOpen = shallowRef(false)

const loginPath = computed(() => readRuntimeConfigString(config.public.authLoginPath, '/login'))

const sessionUser = computed(() => user.value as DashboardSessionUser | null)
const accountLinks = [{ label: 'API Tokens', to: '/settings/api-keys', icon: 'i-lucide-key-round' }]

const displayName = computed(() => sessionUser.value?.name ?? sessionUser.value?.email ?? 'Account')

const initials = computed(() => {
  const name = displayName.value
  if (!name) return '?'
  const parts = name.split(/[\s@]+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0]![0]!}${parts[1]![0]!}`.toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
})

async function signOut() {
  isOpen.value = false

  try {
    await csrfFetch('/api/auth/logout', { method: 'POST' })
  } catch {
    // Clearing the local session is the important part for client navigation.
  } finally {
    await clear()
  }

  await navigateTo(loginPath.value, { replace: true })
}
</script>

<template>
  <ClientOnly>
    <UPopover
      v-if="loggedIn"
      v-model:open="isOpen"
      :content="{ align: 'end', side: 'bottom', sideOffset: 8 }"
    >
      <UButton
        color="neutral"
        variant="ghost"
        size="sm"
        aria-label="User menu"
        data-testid="dashboard-account-menu"
        class="flex items-center gap-2 rounded-full pl-1 pr-2.5"
      >
        <span
          class="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
        >
          {{ initials }}
        </span>
        <span class="hidden max-w-40 truncate text-sm font-medium text-default sm:inline">
          {{ displayName }}
        </span>
        <!-- eslint-disable-next-line vuejs-accessibility/alt-text -- UIcon is decorative; button shows account name -->
        <UIcon name="i-lucide-chevron-down" class="size-3 text-dimmed" />
      </UButton>

      <template #content>
        <div class="w-64">
          <div class="flex items-center gap-3 border-b border-default px-4 py-3">
            <span
              class="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
            >
              {{ initials }}
            </span>
            <div class="min-w-0">
              <p class="truncate text-sm font-semibold text-default">{{ displayName }}</p>
              <p class="truncate text-xs text-muted">{{ sessionUser?.email }}</p>
            </div>
          </div>

          <div class="py-1">
            <ULink
              v-for="link in accountLinks"
              :key="link.to"
              :to="link.to"
              class="flex items-center gap-3 px-4 py-2 text-sm text-muted hover:bg-elevated hover:text-default transition-colors"
              @click="isOpen = false"
            >
              <!-- eslint-disable-next-line vuejs-accessibility/alt-text -- UIcon is decorative; link text follows -->
              <UIcon :name="link.icon" class="size-4" />
              <span>{{ link.label }}</span>
            </ULink>
          </div>

          <div class="border-t border-default py-1">
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              icon="i-lucide-log-out"
              class="w-full justify-start px-4"
              @click="signOut"
            >
              Sign out
            </UButton>
          </div>
        </div>
      </template>
    </UPopover>
  </ClientOnly>
</template>
