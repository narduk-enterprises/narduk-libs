<script setup lang="ts">
/* eslint-disable narduk/file-size-budget -- Notification center is a cohesive popover UI (bell + badge + list + empty/loading/error states + actions) that needs state and template co-located for accessibility. */
/**
 * AppNotificationCenter — bell icon + popover notification dropdown.
 *
 * Drop into any header's #actions slot:
 *   <LayerAppHeader>
 *     <template #actions>
 *       <AppNotificationCenter />
 *     </template>
 *   </LayerAppHeader>
 */
import type { AppNotification } from '../../composables/useNotifications'

const {
  notifications,
  unreadCount,
  loading,
  refresh,
  markAsRead,
  markAllAsRead,
  remove,
  pushSupported,
  pushPermission,
  requestPushPermission,
  startPolling,
  stopPolling,
} = useNotifications()

const isOpen = ref(false)
const router = useRouter()

// Start polling on mount, stop on unmount
onMounted(() => {
  startPolling()
})

onUnmounted(() => {
  stopPolling()
})

// Load full list when popover opens
watch(isOpen, (open) => {
  if (open) {
    void refresh()
  }
})

function handleClick(notification: AppNotification) {
  if (!notification.isRead) {
    void markAsRead(notification.id)
  }
  if (notification.actionUrl) {
    isOpen.value = false
    void router.push(notification.actionUrl)
  }
}

function handleMarkAllRead() {
  void markAllAsRead()
}

function handleRemove(id: string) {
  void remove(id)
}

async function handleEnablePush() {
  await requestPushPermission()
}

function formatRelativeTime(dateString: string): string {
  const now = Date.now()
  const then = new Date(dateString).getTime()
  const diffMs = now - then
  const diffMin = Math.floor(diffMs / 60_000)
  const diffHour = Math.floor(diffMs / 3_600_000)
  const diffDay = Math.floor(diffMs / 86_400_000)

  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHour < 24) return `${diffHour}h ago`
  if (diffDay < 30) return `${diffDay}d ago`
  return formatBuildTimeLocal(dateString, dateString)
}

function kindIcon(notification: AppNotification): string {
  if (notification.icon) return notification.icon
  switch (notification.kind) {
    case 'system':
      return 'i-lucide-info'
    case 'reminder':
      return 'i-lucide-bell-ring'
    case 'social':
      return 'i-lucide-users'
    case 'alert':
      return 'i-lucide-alert-triangle'
    default:
      return 'i-lucide-bell'
  }
}
</script>

<template>
  <UPopover v-model:open="isOpen" :content="{ align: 'end', side: 'bottom', sideOffset: 8 }">
    <UChip
      :show="unreadCount > 0"
      :text="unreadCount > 9 ? '9+' : String(unreadCount)"
      color="error"
      size="lg"
    >
      <UButton icon="i-lucide-bell" variant="ghost" color="neutral" aria-label="Notifications" />
    </UChip>

    <template #content>
      <div class="w-80 sm:w-96 max-h-112 flex flex-col">
        <!-- Header -->
        <div class="flex items-center justify-between px-4 py-3 border-b border-default">
          <h3 class="font-semibold text-default text-sm">Notifications</h3>
          <UButton
            v-if="unreadCount > 0"
            variant="ghost"
            color="primary"
            size="xs"
            label="Mark all read"
            @click="handleMarkAllRead"
          />
        </div>

        <!-- Push permission prompt -->
        <div
          v-if="pushSupported && pushPermission === 'default'"
          class="px-4 py-2.5 border-b border-default bg-elevated flex items-center gap-3"
        >
          <UIcon name="i-lucide-bell-plus" class="size-4 text-primary shrink-0" alt="" />
          <p class="text-xs text-muted flex-1">Get notified when things happen</p>
          <UButton
            size="xs"
            variant="soft"
            color="primary"
            label="Enable"
            @click="handleEnablePush"
          />
        </div>

        <!-- Notification list -->
        <div class="overflow-y-auto flex-1">
          <div v-if="loading && !notifications.length" class="p-8 text-center">
            <UIcon name="i-lucide-loader-2" class="size-5 text-muted animate-spin" alt="" />
          </div>

          <div v-else-if="notifications.length === 0" class="p-8 text-center">
            <UIcon name="i-lucide-bell-off" class="size-8 text-dimmed mx-auto mb-2" alt="" />
            <p class="text-sm text-muted">No notifications yet</p>
          </div>

          <template v-else>
            <div
              v-for="notification in notifications"
              :key="notification.id"
              role="button"
              tabindex="0"
              class="group px-4 py-3 flex items-start gap-3 transition-colors cursor-pointer"
              :class="
                notification.isRead ? 'hover:bg-elevated' : 'bg-primary/5 hover:bg-primary/10'
              "
              @click="handleClick(notification)"
              @keydown.enter.prevent="handleClick(notification)"
              @keydown.space.prevent="handleClick(notification)"
            >
              <!-- Icon -->
              <div
                class="mt-0.5 size-8 rounded-lg flex items-center justify-center shrink-0"
                :class="notification.isRead ? 'bg-muted text-muted' : 'bg-primary/10 text-primary'"
              >
                <UIcon :name="kindIcon(notification)" class="size-4" alt="" />
              </div>

              <!-- Content -->
              <div class="flex-1 min-w-0">
                <p
                  class="text-sm leading-tight"
                  :class="notification.isRead ? 'text-muted' : 'text-default font-medium'"
                >
                  {{ notification.title }}
                </p>
                <p class="text-xs text-dimmed mt-0.5 line-clamp-2">{{ notification.body }}</p>
                <p class="text-xs text-toned mt-1">
                  {{ formatRelativeTime(notification.createdAt) }}
                </p>
              </div>

              <!-- Actions -->
              <div
                class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              >
                <UButton
                  v-if="!notification.isRead"
                  icon="i-lucide-check"
                  variant="ghost"
                  color="neutral"
                  size="xs"
                  aria-label="Mark as read"
                  @click.stop="markAsRead(notification.id)"
                />
                <UButton
                  icon="i-lucide-x"
                  variant="ghost"
                  color="neutral"
                  size="xs"
                  aria-label="Remove"
                  @click.stop="handleRemove(notification.id)"
                />
              </div>

              <!-- Unread dot -->
              <div
                v-if="!notification.isRead"
                class="mt-2 size-2 rounded-full bg-primary shrink-0"
              />
            </div>
          </template>
        </div>
      </div>
    </template>
  </UPopover>
</template>
