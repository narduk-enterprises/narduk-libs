<script setup lang="ts">
/**
 * AppUserMenu — Authenticated user dropdown menu.
 *
 * Shows an avatar/initials trigger that opens a popover with configurable
 * menu links and a sign-out button. Uses `useAuth()` from the layer.
 *
 * Usage:
 *   <LayerAppHeader>
 *     <template #actions>
 *       <AppNotificationCenter />
 *       <AppUserMenu :menu-links="myLinks" />
 *     </template>
 *   </LayerAppHeader>
 */

interface MenuLink {
  badge?: string | number
  icon: string
  label: string
  to: string
}

const props = withDefaults(
  defineProps<{
    /** Path to admin page. */
    adminPath?: string
    /** Optional avatar URL override. */
    avatarUrl?: string
    /** Where to redirect after sign out. */
    logoutRedirect?: string
    /** Navigation links shown in the dropdown. */
    menuLinks?: MenuLink[]
    /** Show the admin link if user is admin. */
    showAdminLink?: boolean
  }>(),
  {
    menuLinks: () => [
      { label: 'Dashboard', to: '/dashboard', icon: 'i-lucide-layout-dashboard' },
      { label: 'API Tokens', to: '/settings/api-keys', icon: 'i-lucide-key-round' },
    ],
    logoutRedirect: '/login',
    showAdminLink: true,
    adminPath: '/admin',
    avatarUrl: '',
  },
)

const { user, loggedIn, logout } = useAuth()

const isOpen = ref(false)

const displayName = computed(() => {
  const u = user.value
  if (!u) return 'User'
  const name = u.name?.trim()
  if (name) return name
  const email = u.email.trim()
  return email !== '' ? email : 'User'
})

const initials = computed(() => {
  const name = displayName.value
  if (!name) return '?'
  const parts = name.split(/[\s@]+/)
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
  return name.slice(0, 2).toUpperCase()
})

const isAdmin = computed(() => !!user.value?.isAdmin)

const resolvedLinks = computed(() => {
  const links = [...props.menuLinks]

  if (props.showAdminLink && isAdmin.value) {
    const alreadyHasAdmin = links.some((l) => l.to === props.adminPath)
    if (!alreadyHasAdmin) {
      links.push({ label: 'Admin', to: props.adminPath, icon: 'i-lucide-shield-check' })
    }
  }

  return links
})

async function signOut() {
  isOpen.value = false
  await logout()
  await navigateTo(props.logoutRedirect, { replace: true })
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
        class="flex items-center gap-2"
      >
        <!-- Avatar or initials -->
        <span
          v-if="avatarUrl"
          class="size-7 rounded-full overflow-hidden shrink-0 ring-1 ring-default"
        >
          <img :src="avatarUrl" alt="" class="size-full object-cover" />
        </span>
        <span
          v-else
          class="size-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0"
        >
          {{ initials }}
        </span>
        <span class="text-sm font-medium text-default hidden sm:inline truncate max-w-32">{{
          displayName
        }}</span>
        <UIcon name="i-lucide-chevron-down" class="size-3 text-dimmed" alt="" />
      </UButton>

      <template #content>
        <div class="w-64">
          <!-- User info header -->
          <div class="flex items-center gap-3 px-4 py-3 border-b border-default">
            <span
              v-if="avatarUrl"
              class="size-10 rounded-full overflow-hidden shrink-0 ring-1 ring-default"
            >
              <img :src="avatarUrl" alt="" class="size-full object-cover" />
            </span>
            <span
              v-else
              class="size-10 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold shrink-0"
            >
              {{ initials }}
            </span>
            <div class="min-w-0">
              <p class="font-semibold text-default text-sm truncate">{{ displayName }}</p>
              <p class="text-xs text-muted truncate">{{ user?.email }}</p>
            </div>
          </div>

          <!-- Menu links -->
          <div class="py-1">
            <ULink
              v-for="link in resolvedLinks"
              :key="link.to"
              :to="link.to"
              class="flex items-center gap-3 px-4 py-2 text-sm text-muted hover:text-default hover:bg-elevated transition-colors"
              @click="isOpen = false"
            >
              <UIcon :name="link.icon" class="size-4" alt="" />
              <span class="flex-1">{{ link.label }}</span>
              <UBadge v-if="link.badge" color="primary" variant="soft" size="xs">
                {{ link.badge }}
              </UBadge>
            </ULink>
          </div>

          <!-- Sign out -->
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
