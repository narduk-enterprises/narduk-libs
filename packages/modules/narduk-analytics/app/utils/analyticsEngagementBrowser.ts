import { createAnalyticsEngagement } from './analyticsEngagement'

import type { AnalyticsTransport } from './analyticsTransport'

interface EngagementRouter {
  currentRoute: { value: { path: string } }
}
interface CleanupHost {
  onUnmount: (handler: () => void) => unknown
}

/** Passive listeners, no timers or network heartbeat; at most four scroll events per visit. */
export function installAnalyticsEngagement(
  transport: AnalyticsTransport,
  router: EngagementRouter,
  host: CleanupHost,
) {
  let visitContext = transport.context()
  let currentPath = router.currentRoute.value.path
  const engagement = createAnalyticsEngagement({
    initialVisible: document.visibilityState !== 'hidden',
    emit: (event, properties) => {
      transport.capture(event, properties, visitContext)
    },
  })
  const activity = () => engagement.activity()
  const visibility = () => engagement.visibility(document.visibilityState !== 'hidden')
  const flush = () => engagement.flush()
  const pagehide = () => engagement.visibility(false)
  const scroll = () => {
    activity()
    const height = document.documentElement.scrollHeight - window.innerHeight
    engagement.scroll(height > 0 ? Math.min(100, (window.scrollY / height) * 100) : 0, height > 0)
  }
  const registrations: Array<[EventTarget, string, EventListener]> = [
    [window, 'pointerdown', activity],
    [window, 'keydown', activity],
    [window, 'touchstart', activity],
    [window, 'scroll', scroll],
    [window, 'pagehide', pagehide],
    [window, 'pageshow', visibility],
    [document, 'visibilitychange', visibility],
  ]
  for (const [target, name, listener] of registrations)
    target.addEventListener(name, listener, { passive: true })
  host.onUnmount(() => {
    flush()
    for (const [target, name, listener] of registrations) target.removeEventListener(name, listener)
  })
  return {
    navigate(path = router.currentRoute.value.path, context = transport.context()) {
      if (path === currentPath) return
      engagement.navigate()
      currentPath = path
      visitContext = context
    },
  }
}
