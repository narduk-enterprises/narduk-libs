import { defineNuxtPlugin, useAppConfig, useRouter } from '#imports'

import {
  type ChunkReloadEnvironment,
  type ChunkReloadStorage,
  isChunkLoadError,
  isChunkReloadEnabled,
  reloadForChunkError,
} from '../../shared/chunk-reload'

function readSessionStorage(): ChunkReloadStorage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

/**
 * Recovers a tab that survived a deploy. The previous build's hashed chunks
 * are gone, so the next navigation fails with "Importing a module script
 * failed" (Safari), "Failed to fetch dynamically imported module" (Chrome) or
 * "error loading dynamically imported module" (Firefox). One hard reload to
 * the page being opened fetches the new build; `chunk-reload.ts` holds the
 * 10 second guard that keeps a genuinely broken deploy from looping.
 *
 * Opt out with `appConfig.narduk.chunkReload = false`.
 */
export default defineNuxtPlugin({
  name: 'narduk-chunk-reload',
  setup() {
    if (!isChunkReloadEnabled(useAppConfig())) return

    const router = useRouter()
    const env: ChunkReloadEnvironment = {
      now: () => Date.now(),
      reload: (url) => {
        if (new URL(url, window.location.href).href === window.location.href) {
          window.location.reload()
        } else {
          window.location.assign(url)
        }
      },
      storage: readSessionStorage(),
    }

    // Route errors carry the failed destination. Global preload/chunk events
    // also cover optional async components: leave those rejections available
    // to a local error boundary instead of reloading a working page.
    router.onError((error, to) => {
      if (isChunkLoadError(error)) reloadForChunkError(env, router.resolve(to.fullPath).href)
    })
  },
})
