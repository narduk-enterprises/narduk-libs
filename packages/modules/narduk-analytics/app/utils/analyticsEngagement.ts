import type { AnalyticsProperties } from './analyticsTransport'

interface EngagementOptions {
  emit: (event: 'page_engagement' | 'scroll_depth_reached', properties: AnalyticsProperties) => void
  idleMs?: number
  initialVisible?: boolean
  now?: () => number
  visitId?: () => string
}

/** Measures foreground activity, emitting deltas so repeated flushes cannot double-count. */
export function createAnalyticsEngagement(options: EngagementOptions) {
  const now = options.now ?? (() => performance.now())
  const idleMs = options.idleMs ?? 30_000
  let visitId = (options.visitId ?? (() => crypto.randomUUID()))()
  let lastActivity = now()
  let measuredAt = lastActivity
  let activeMs = 0
  let visible = options.initialVisible ?? true
  const milestones = new Set<number>()

  function measure() {
    const at = now()
    if (visible) activeMs += Math.max(0, Math.min(at, lastActivity + idleMs) - measuredAt)
    measuredAt = at
  }

  function flush() {
    measure()
    const delta = Math.floor(activeMs)
    activeMs -= delta
    if (delta > 0) options.emit('page_engagement', { active_ms: delta, page_visit_id: visitId })
  }

  return {
    activity() {
      measure()
      lastActivity = now()
    },
    visibility(value: boolean) {
      flush()
      visible = value
      measuredAt = now()
      // Becoming visible is an explicit new foreground interaction.
      if (value) lastActivity = measuredAt
    },
    scroll(depth: number, scrollable: boolean) {
      if (!visible || !scrollable) return
      for (const milestone of [25, 50, 75, 100]) {
        if (depth < milestone || milestones.has(milestone)) continue
        milestones.add(milestone)
        options.emit('scroll_depth_reached', { depth: milestone, page_visit_id: visitId })
      }
    },
    flush,
    navigate() {
      flush()
      visitId = (options.visitId ?? (() => crypto.randomUUID()))()
      milestones.clear()
      activeMs = 0
      lastActivity = now()
      measuredAt = lastActivity
    },
  }
}
