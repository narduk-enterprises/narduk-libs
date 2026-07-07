<script setup lang="ts">
/* eslint-disable narduk/file-size-budget -- Settings profile card owns schema + form state + avatar upload + save flow in one cohesive surface. */
/**
 * AppSettingsProfile — Reusable profile editing card.
 *
 * Provides name editing, email display, and optional avatar upload.
 * Emits a 'save' event with the updated profile data.
 *
 * Usage:
 *   <AppSettingsProfile
 *     :initial-name="user.name"
 *     :email="user.email"
 *     :initial-avatar-url="user.avatarUrl"
 *     :show-avatar="true"
 *     :saving="isSaving"
 *     @save="handleSave"
 *   />
 */

const props = withDefaults(
  defineProps<{
    /** Current user email (read-only display). */
    email?: string
    /** Current avatar URL. */
    initialAvatarUrl?: string
    /** Current user name. */
    initialName?: string
    /** Max avatar file size in bytes. */
    maxAvatarSize?: number
    /** Whether a save is in progress. */
    saving?: boolean
    /** Additional settings links to show. */
    settingsLinks?: Array<{ icon: string; label: string; to: string }>
    /** Whether to show the avatar upload section. */
    showAvatar?: boolean
    /** Card subtitle. */
    subtitle?: string
    /** Card title. */
    title?: string
  }>(),
  {
    initialName: '',
    email: '',
    initialAvatarUrl: '',
    showAvatar: true,
    saving: false,
    title: 'Your identity',
    subtitle: 'Profile',
    maxAvatarSize: 2 * 1024 * 1024,
    settingsLinks: () => [],
  },
)

const emit = defineEmits<{
  save: [data: { avatarUrl: string; name: string }]
}>()

const formName = ref('')
const previewAvatarUrl = ref('')
const avatarError = ref('')

// Sync from parent when props change
watch(
  () => props.initialName,
  (val) => {
    formName.value = val
  },
  { immediate: true },
)

watch(
  () => props.initialAvatarUrl,
  (val) => {
    previewAvatarUrl.value = val
  },
  { immediate: true },
)

const initials = computed(() => {
  const name = formName.value || props.email || ''
  if (!name) return '?'
  const parts = name.split(/[\s@]+/)
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
  return name.slice(0, 2).toUpperCase()
})

function onFileSelect(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return

  avatarError.value = ''

  if (!file.type.startsWith('image/')) {
    avatarError.value = 'Please select an image file.'
    return
  }

  if (file.size > props.maxAvatarSize) {
    const maxMb = Math.round(props.maxAvatarSize / 1024 / 1024)
    avatarError.value = `Image must be under ${maxMb}MB.`
    return
  }

  const reader = new FileReader()
  reader.onload = () => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const size = 128
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      // Crop to square center
      const srcSize = Math.min(img.width, img.height)
      const srcX = (img.width - srcSize) / 2
      const srcY = (img.height - srcSize) / 2
      ctx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, size, size)

      previewAvatarUrl.value = canvas.toDataURL('image/webp', 0.8)
    }
    img.src = reader.result as string
  }
  reader.readAsDataURL(file)
}

function removeAvatar() {
  previewAvatarUrl.value = ''
}

function handleSave() {
  // Don't emit if the trimmed name is empty — callers receive whatever we emit.
  if (!formName.value.trim()) return
  emit('save', {
    name: formName.value.trim(),
    avatarUrl: previewAvatarUrl.value,
  })
}

const fileInputRef = ref<HTMLInputElement | null>(null)
</script>

<template>
  <div class="grid gap-4 xl:grid-cols-2">
    <UCard>
      <div class="space-y-5">
        <div class="space-y-1">
          <p class="text-xs font-semibold uppercase tracking-wider text-muted">{{ subtitle }}</p>
          <h2 class="text-lg font-semibold text-default">{{ title }}</h2>
        </div>

        <!-- Avatar section -->
        <div v-if="showAvatar" class="flex items-center gap-4">
          <div class="shrink-0">
            <span
              v-if="previewAvatarUrl"
              class="size-16 rounded-full overflow-hidden ring-2 ring-default block"
            >
              <img :src="previewAvatarUrl" alt="Avatar preview" class="size-full object-cover" />
            </span>
            <span
              v-else
              class="size-16 rounded-full bg-primary/10 text-primary flex items-center justify-center text-lg font-bold ring-2 ring-default"
            >
              {{ initials }}
            </span>
          </div>

          <div class="space-y-2">
            <div class="flex flex-wrap gap-2">
              <UButton
                color="neutral"
                variant="soft"
                size="sm"
                icon="i-lucide-upload"
                @click="fileInputRef?.click()"
              >
                Upload photo
              </UButton>
              <UButton
                v-if="previewAvatarUrl"
                color="error"
                variant="soft"
                size="sm"
                icon="i-lucide-trash-2"
                @click="removeAvatar"
              >
                Remove
              </UButton>
            </div>
            <p v-if="avatarError" class="text-xs text-error">{{ avatarError }}</p>
            <p v-else class="text-xs text-dimmed">
              Square images work best. Max {{ Math.round(maxAvatarSize / 1024 / 1024) }}MB.
            </p>
            <!-- eslint-disable-next-line narduk/no-native-input -- hidden file input for avatar upload -->
            <input
              ref="fileInputRef"
              type="file"
              accept="image/*"
              class="hidden"
              aria-label="Choose profile photo file"
              @change="onFileSelect"
            />
          </div>
        </div>

        <!-- Name field -->
        <UFormField name="name" label="Display name">
          <UInput v-model="formName" class="w-full" placeholder="Your name" />
        </UFormField>

        <!-- Email field (read-only) -->
        <UFormField v-if="email" name="email" label="Email">
          <UInput :model-value="email" class="w-full" disabled />
        </UFormField>

        <slot name="extra-fields" />

        <UButton color="primary" icon="i-lucide-save" :loading="saving" @click="handleSave">
          Save changes
        </UButton>
      </div>
    </UCard>

    <!-- Settings links sidebar (optional) -->
    <UCard v-if="settingsLinks.length > 0 || $slots['settings-sidebar']">
      <div class="space-y-4">
        <div class="space-y-1">
          <p class="text-xs font-semibold uppercase tracking-wider text-muted">Quick links</p>
          <h2 class="text-lg font-semibold text-default">Other settings</h2>
        </div>

        <div class="space-y-1">
          <UButton
            v-for="link in settingsLinks"
            :key="link.to"
            :to="link.to"
            color="neutral"
            variant="ghost"
            :icon="link.icon"
            class="w-full justify-start"
          >
            {{ link.label }}
          </UButton>
        </div>

        <slot name="settings-sidebar" />
      </div>
    </UCard>
  </div>
</template>
