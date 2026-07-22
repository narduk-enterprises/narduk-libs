<script setup lang="ts">
import { useAppFetch } from '@narduk-enterprises/narduk-core/app/composables/useAppFetch'
import { formatBuildTimeLocal } from '@narduk-enterprises/narduk-core/app/utils/formatBuildTimeLocal'

const perPage = 20
const page = ref(1)

interface UsersResponse {
  limit: number
  page: number
  total: number
  users: Array<{
    createdAt: string
    email: string
    id: string
    isAdmin: boolean
    name: string | null
  }>
}

const appFetch = useAppFetch()

// Fetch from the layer's generic /api/admin/users endpoint
const { data: usersData, refresh: refreshUsers } = useAsyncData(
  'layer-admin-users',
  () =>
    appFetch<UsersResponse>('/api/admin/users', { query: { page: page.value, limit: perPage } }),
  {
    watch: [page],
    default: () => ({ users: [], page: 1, limit: perPage, total: 0 }),
  },
)

const total = computed(() => usersData.value.total)
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / perPage)))
const paginatedUsers = computed(() => usersData.value.users)
const activeAction = ref<string | null>(null)

function prevPage() {
  if (page.value > 1) page.value -= 1
}
function nextPage() {
  if (page.value < totalPages.value) page.value += 1
}

const toast = useToast()

async function toggleAdmin(userId: string, currentIsAdmin: boolean) {
  activeAction.value = `admin-role:${userId}`
  try {
    await appFetch<{ ok: boolean }>('/api/admin/users/role', {
      method: 'PUT',
      body: { userId, isAdmin: !currentIsAdmin },
    })
    toast.add({ title: 'Success', description: 'User role updated', color: 'success' })
    await refreshUsers()
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    toast.add({
      title: 'Error updating role',
      description: message,
      color: 'error',
    })
  } finally {
    activeAction.value = null
  }
}

function formatJoinDate(dateStr: string) {
  return formatBuildTimeLocal(dateStr, dateStr)
}

function pageRangeStart() {
  return (page.value - 1) * perPage + 1
}
function pageRangeEnd() {
  return Math.min(page.value * perPage, total.value)
}

function handleToggleAdmin(user: { id: string; isAdmin: boolean }) {
  void toggleAdmin(user.id, user.isAdmin)
}
</script>

<template>
  <div class="space-y-4">
    <UCard class="card-base border-default">
      <div class="flex flex-col">
        <div
          class="sticky top-0 z-10 flex flex-col gap-3 border-b border-default bg-default/95 px-4 py-3 backdrop-blur supports-backdrop-filter:bg-default/80"
        >
          <div class="space-y-1">
            <p class="text-xs font-semibold uppercase tracking-wider text-primary">Users</p>
            <h2 class="text-lg font-semibold text-default">Registration and admin roles</h2>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-sm text-muted">
              Showing {{ pageRangeStart() }}-{{ pageRangeEnd() }} of
              {{ total }}
            </p>
            <div class="flex items-center gap-2">
              <UButton
                color="neutral"
                variant="soft"
                size="sm"
                icon="i-lucide-chevron-left"
                :disabled="page <= 1"
                aria-label="Previous page"
                @click="prevPage"
              />
              <span class="min-w-[6ch] text-center text-sm text-muted">
                {{ page }} / {{ totalPages }}
              </span>
              <UButton
                color="neutral"
                variant="soft"
                size="sm"
                icon="i-lucide-chevron-right"
                :disabled="page >= totalPages"
                aria-label="Next page"
                @click="nextPage"
              />
            </div>
          </div>
        </div>

        <div class="max-h-[60vh] overflow-y-auto">
          <div class="space-y-3 p-4">
            <div
              v-for="adminUser in paginatedUsers"
              :key="adminUser.id"
              class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-lg border border-default p-4"
            >
              <div class="flex items-center gap-3">
                <UAvatar :alt="adminUser.name || adminUser.email" size="sm" />
                <div>
                  <p class="font-semibold text-default">{{ adminUser.name || adminUser.email }}</p>
                  <p class="text-sm text-muted">
                    {{ adminUser.email }} • Joined {{ formatJoinDate(adminUser.createdAt) }}
                  </p>
                </div>
              </div>

              <UButton
                color="neutral"
                variant="soft"
                :icon="adminUser.isAdmin ? 'i-lucide-shield-off' : 'i-lucide-shield-check'"
                :loading="activeAction === `admin-role:${adminUser.id}`"
                @click="handleToggleAdmin(adminUser)"
              >
                {{ adminUser.isAdmin ? 'Remove admin' : 'Make admin' }}
              </UButton>
            </div>
          </div>
        </div>
      </div>
    </UCard>
  </div>
</template>
