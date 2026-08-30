export type AnalyticsLoadStrategy = 'immediate' | 'idle' | 'interaction' | 'off'

const VALID_ANALYTICS_LOAD_STRATEGIES = new Set<AnalyticsLoadStrategy>([
  'immediate',
  'idle',
  'interaction',
  'off',
])

type BrowserWindow = Window & {
  addEventListener: EventTarget['addEventListener']
  removeEventListener: EventTarget['removeEventListener']
  requestIdleCallback?: Window['requestIdleCallback']
  setTimeout: Window['setTimeout']
}

export function normalizeAnalyticsLoadStrategy(value: unknown): AnalyticsLoadStrategy {
  if (typeof value !== 'string') return 'idle'

  const normalized = value.trim().toLowerCase()
  return VALID_ANALYTICS_LOAD_STRATEGIES.has(normalized as never)
    ? (normalized as AnalyticsLoadStrategy)
    : 'idle'
}

export function runWithAnalyticsLoadStrategy(
  strategy: AnalyticsLoadStrategy,
  callback: () => void,
): void {
  if (strategy === 'off') return

  if (strategy === 'immediate') {
    callback()
    return
  }

  const browserWindow = window as BrowserWindow

  if (strategy === 'idle') {
    if (typeof browserWindow.requestIdleCallback === 'function') {
      browserWindow.requestIdleCallback(callback, { timeout: 3000 })
      return
    }

    browserWindow.setTimeout(callback, 1500)
    return
  }

  const runOnce = () => {
    for (const eventName of interactionEvents) {
      browserWindow.removeEventListener(eventName, runOnce)
    }
    callback()
  }

  for (const eventName of interactionEvents) {
    browserWindow.addEventListener(eventName, runOnce, listenerOptions)
  }
}

export function isLocalAnalyticsHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '[::1]' ||
    h === '::1' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local')
  )
}

export type AnalyticsDeploymentTarget = 'preview' | 'production' | 'staging' | undefined

/**
 * True for hosts that are never the canonical production origin: legacy
 * Cloudflare Pages previews (`*.pages.dev`) and the Workers-first fleet's
 * preview aliases (`*.workers.dev`). Matching only `.pages.dev` missed every
 * `*.workers.dev` preview once the fleet moved off Pages, silently tagging
 * that traffic as production in PostHog.
 */
export function isPreviewAnalyticsHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return h.endsWith('.pages.dev') || h.endsWith('.workers.dev')
}

/**
 * Whether traffic should be tagged `is_internal_user` in PostHog: any
 * non-production deployment target (from narduk-core's runtime-public
 * overlay), or a known preview-alias hostname as a fallback for apps whose
 * deployment target is unset/misconfigured.
 */
export function isInternalAnalyticsTraffic(
  hostname: string,
  deploymentTarget: AnalyticsDeploymentTarget,
): boolean {
  if (deploymentTarget && deploymentTarget !== 'production') return true
  return isPreviewAnalyticsHost(hostname)
}

/**
 * Resolves the PostHog `environment` super-property: `development` for
 * local hosts, the resolved deployment target when it is non-production,
 * `preview` for a known preview-alias hostname with no explicit deployment
 * target, and `production` otherwise.
 */
export function resolveAnalyticsEnvironment(
  hostname: string,
  deploymentTarget: AnalyticsDeploymentTarget,
): 'development' | 'preview' | 'production' | 'staging' {
  if (isLocalAnalyticsHost(hostname)) return 'development'
  if (deploymentTarget === 'staging' || deploymentTarget === 'preview') return deploymentTarget
  if (isPreviewAnalyticsHost(hostname)) return 'preview'
  return 'production'
}

const interactionEvents = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const
const listenerOptions = { once: true, passive: true } satisfies AddEventListenerOptions
