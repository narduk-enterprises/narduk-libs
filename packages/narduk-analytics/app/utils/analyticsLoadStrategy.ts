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

const interactionEvents = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const
const listenerOptions = { once: true, passive: true } satisfies AddEventListenerOptions
