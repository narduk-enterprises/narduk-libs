<script setup lang="ts">
import { readRuntimeConfigString } from '../../utils/readRuntimeConfigString'

/**
 * A highly configurable, responsive layer application footer.
 */

const props = withDefaults(
  defineProps<{
    appName?: string
    showCopyright?: boolean
  }>(),
  {
    appName: '',
    showCopyright: true,
  },
)

const resolvedAppName = computed(() => {
  if (props.appName) return props.appName
  const config = useRuntimeConfig()
  return readRuntimeConfigString(config.public.appName, 'Nuxt 4 App')
})
</script>

<template>
  <!-- eslint-disable-next-line narduk/no-native-layout -- layer scaffold: semantic landmark element -->
  <footer class="border-t border-default py-6">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <slot>
        <div class="flex flex-col md:flex-row items-center justify-between gap-4">
          <p v-if="showCopyright" class="text-sm text-muted text-center md:text-left">
            &copy; <NuxtTime :datetime="new Date()" year="numeric" /> {{ resolvedAppName }}. All
            rights reserved.
          </p>
          <div class="flex items-center gap-4 text-sm text-muted">
            <slot name="links">
              <span>{{ resolvedAppName }}</span>
              <span>&middot;</span>
              <span>Nuxt UI 4</span>
              <span>&middot;</span>
              <span>Cloudflare Workers</span>
            </slot>
          </div>
        </div>
      </slot>
    </div>
  </footer>
</template>
