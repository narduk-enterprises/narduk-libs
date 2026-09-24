/**
 * useCurrentLocation -- one consent-first read of the browser's position, for
 * "near me" features (narduk-libs#385).
 *
 * THE CONSENT BOUNDARY
 * --------------------
 * - Nothing is read until the app calls `locate()`, and the app calls it from a
 *   user gesture. Setup only asks the Permissions API what the answer already
 *   is, which never prompts.
 * - It is one `getCurrentPosition` per `locate()`. It never calls
 *   `watchPosition`, never polls, and never sends a coordinate anywhere: what
 *   the app does with `coords` is the app's decision, and an analytics event
 *   carrying one needs its own consent.
 * - Server rendering is a no-op. The state starts `idle` on both sides, so
 *   hydration matches.
 *
 * FOUR WAYS TO NOT GET A POSITION, KEPT APART
 * -------------------------------------------
 * `denied` means the person said no. `blocked` means the page's own
 * Permissions-Policy forbids geolocation, so no prompt was possible and the fix
 * is the app's configuration, not the person's settings. Chromium reports both
 * as `PERMISSION_DENIED`, so `blocked` is decided first, from
 * `document.permissionsPolicy` / `document.featurePolicy`. Safari and Firefox
 * do not enforce a Permissions-Policy on geolocation and expose neither, so for
 * them the policy is taken as allowing. `unavailable` means no position could be
 * had (no API, or `POSITION_UNAVAILABLE`), and `timeout` means none arrived in
 * time. An app that collapses these into one fallback cannot tell a person why
 * "near me" did nothing.
 *
 * Named `useCurrentLocation`, not `useGeolocation`: VueUse's `useGeolocation`
 * watches continuously, and `@vueuse/nuxt` auto-imports it under that name.
 *
 * @example
 * ```vue
 * <script setup>
 * const { status, coords, locate } = useCurrentLocation()
 * </script>
 * <template>
 *   <UButton :loading="status === 'locating'" @click="locate">Near me</UButton>
 * </template>
 * ```
 */
import { onMounted, readonly, ref } from 'vue'

import type { Ref } from 'vue'

/** What the browser will say before anyone asks. `unknown` until checked. */
export type LocationPermission = 'unknown' | 'prompt' | 'granted' | 'denied' | 'blocked'

export type LocationStatus =
  'idle' | 'locating' | 'located' | 'denied' | 'blocked' | 'unavailable' | 'timeout'

export interface CurrentLocation {
  /** Metres, as the browser reports it. */
  accuracy: number
  latitude: number
  longitude: number
  /** Epoch milliseconds the position was taken. */
  timestamp: number
}

export interface CurrentLocationOptions {
  /** Default `false`: coarse is enough for "nearest X" and answers faster. */
  enableHighAccuracy?: boolean
  /** Default 60 000 ms: a position this recent is reused rather than re-read. */
  maximumAgeMs?: number
  /** Default 10 000 ms. */
  timeoutMs?: number
}

/** The browser surface this composable touches. Injected in tests. */
export interface LocationEnvironment {
  geolocation?: Pick<Geolocation, 'getCurrentPosition'>
  permissions?: Pick<Permissions, 'query'>
  /** `document.permissionsPolicy ?? document.featurePolicy`, where present. */
  policy?: { allowsFeature(feature: string): boolean }
}

function browserEnvironment(): LocationEnvironment {
  if (typeof navigator === 'undefined') return {}
  const doc = (typeof document === 'undefined' ? {} : document) as {
    featurePolicy?: LocationEnvironment['policy']
    permissionsPolicy?: LocationEnvironment['policy']
  }
  return {
    geolocation: 'geolocation' in navigator ? navigator.geolocation : undefined,
    permissions: 'permissions' in navigator ? navigator.permissions : undefined,
    policy: doc.permissionsPolicy ?? doc.featurePolicy,
  }
}

function policyBlocks(env: LocationEnvironment): boolean {
  try {
    return env.policy ? !env.policy.allowsFeature('geolocation') : false
  } catch {
    return false
  }
}

const BLOCKED_HINT =
  "useCurrentLocation: this page's Permissions-Policy forbids geolocation. Set " +
  "NUXT_PUBLIC_ALLOW_GEOLOCATION=true at build time, or narduk-core's security.headers.permissionsPolicy.geolocation to ['self']."

/**
 * `environment` is the browser surface, read at each call so a test (or a
 * component rendered before hydration) never captures a stale one.
 */
export function useCurrentLocation(
  options: CurrentLocationOptions = {},
  environment: () => LocationEnvironment = browserEnvironment,
) {
  const status: Ref<LocationStatus> = ref('idle')
  const permission: Ref<LocationPermission> = ref('unknown')
  const coords: Ref<CurrentLocation | null> = ref(null)
  let inFlight: Promise<CurrentLocation | null> | null = null

  /** Reads what the browser would answer. Never prompts. */
  async function refreshPermission(): Promise<LocationPermission> {
    const env = environment()
    if (policyBlocks(env)) return (permission.value = 'blocked')
    if (!env.permissions) return permission.value
    try {
      const result = await env.permissions.query({ name: 'geolocation' })
      permission.value = result.state
    } catch {
      // Some browsers reject the query for geolocation; the answer stays unknown.
    }
    return permission.value
  }

  function settle(next: LocationStatus): null {
    status.value = next
    return null
  }

  /** One position read. Call it from a user gesture. Concurrent calls share one read. */
  function locate(): Promise<CurrentLocation | null> {
    if (inFlight) return inFlight
    const env = environment()
    if (policyBlocks(env)) {
      permission.value = 'blocked'
      if (import.meta.dev) console.warn(BLOCKED_HINT)
      return Promise.resolve(settle('blocked'))
    }
    if (!env.geolocation) return Promise.resolve(settle('unavailable'))
    const geolocation = env.geolocation
    status.value = 'locating'
    inFlight = new Promise<CurrentLocation | null>((resolve) => {
      geolocation.getCurrentPosition(
        (position) => {
          const located: CurrentLocation = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: position.timestamp,
          }
          coords.value = located
          permission.value = 'granted'
          status.value = 'located'
          resolve(located)
        },
        (error) => {
          if (error.code === 1) {
            permission.value = 'denied'
            resolve(settle('denied'))
          } else resolve(settle(error.code === 3 ? 'timeout' : 'unavailable'))
        },
        {
          enableHighAccuracy: options.enableHighAccuracy ?? false,
          timeout: options.timeoutMs ?? 10_000,
          maximumAge: options.maximumAgeMs ?? 60_000,
        },
      )
    }).finally(() => {
      inFlight = null
    })
    return inFlight
  }

  // Server rendering never mounts, so this asks the browser only on the client.
  onMounted(() => {
    void refreshPermission()
  })

  return {
    status: readonly(status),
    permission: readonly(permission),
    coords: readonly(coords),
    locate,
    refreshPermission,
  }
}
