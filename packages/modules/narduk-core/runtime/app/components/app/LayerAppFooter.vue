<script setup lang="ts">
import { footerAfterComponents } from '../../utils/footerExtensions'
import { readRuntimeConfigString } from '../../utils/readRuntimeConfigString'

/**
 * A highly configurable, responsive layer application footer.
 *
 * Below its content it renders the `after` slot. By default that slot renders
 * the global components listed in `appConfig.nardukCore.footer.after`, so a
 * module can add a row without copying this component (narduk-libs#743).
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

// Read the clock once on the server and hydrate with the same value: a
// `new Date()` in the template renders twice, and the two reads disagree
// across a year boundary (narduk/no-render-clock).
const copyrightNow = useSsrNow('layer-app-footer')

const resolvedAppName = computed(() => {
  if (props.appName) return props.appName
  const config = useRuntimeConfig()
  return readRuntimeConfigString(config.public.appName, 'Nuxt 4 App')
})

const afterComponents = computed(() => footerAfterComponents(useAppConfig()))
</script>

<template>
  <!-- eslint-disable-next-line vue/no-restricted-html-elements -- layer scaffold: semantic landmark element -->
  <footer class="border-t border-default">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <slot>
        <div class="flex flex-col md:flex-row items-center justify-between gap-4">
          <p v-if="showCopyright" class="text-sm text-muted text-center md:text-left">
            &copy; <NuxtTime :datetime="copyrightNow" year="numeric" /> {{ resolvedAppName }}. All
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
    <slot name="after">
      <component :is="name" v-for="name in afterComponents" :key="name" />
    </slot>
  </footer>
</template>
