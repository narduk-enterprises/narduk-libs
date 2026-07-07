import { defineNuxtPlugin, useHead, useRuntimeConfig } from '#imports'

import { formatBuildTimeLocal } from '../utils/formatBuildTimeLocal'
import { readRuntimeConfigString } from '../utils/readRuntimeConfigString'

/**
 * Injects build metadata into the document head (SSR + client) so the active
 * deployment can be verified from page source, devtools, or curl.
 */
export default defineNuxtPlugin((nuxtApp) => {
  const config = useRuntimeConfig().public
  const appVersion = readRuntimeConfigString(config.appVersion)
  const buildVersion = readRuntimeConfigString(config.buildVersion, appVersion)
  const buildTime = readRuntimeConfigString(config.buildTime)
  const buildTimeLocal = import.meta.client ? formatBuildTimeLocal(buildTime) : ''

  // `useHead()` needs the Vue app's provide/inject context, not only Nuxt's async context.
  nuxtApp.vueApp.runWithContext(() => {
    useHead({
      meta: [
        { name: 'app-version', content: appVersion },
        { name: 'build-version', content: buildVersion },
        { name: 'build-time', content: buildTime },
        ...(buildTimeLocal ? [{ name: 'build-time-local', content: buildTimeLocal }] : []),
      ],
    })
  })
})
