import {
  TRAFFIC_CLAIM_COOKIE,
  TRAFFIC_CLAIM_DEV_COOKIE,
  verifyOwnerClassClaim,
} from '../../server/utils/traffic/trafficClaim'
import {
  hasUnsignedOwnerFlag,
  parseAutomationMarker,
  readCookieValue,
  resolveTrafficProperties,
} from '../../server/utils/traffic/trafficClass'

import type { TrafficPublicJwk } from '../../server/utils/traffic/trafficClaim'
import type { TrafficProperties } from '../../server/utils/traffic/trafficClass'

export interface BrowserTrafficInputs {
  /** Resolves true when an owner-only app has a signed-in session. */
  authenticatedOwner?: () => Promise<boolean>
  cookie: string
  origin: string
  userAgent: string
}

/**
 * Classify this browser from what it already holds: the user agent, the
 * verified class-claim cookie and the legacy owner flag. Makes no request.
 */
export async function resolveBrowserTrafficProperties(
  inputs: BrowserTrafficInputs,
  options: { keys?: Readonly<Record<string, TrafficPublicJwk>>; nowMs?: number } = {},
): Promise<TrafficProperties> {
  const automationTool = parseAutomationMarker(inputs.userAgent)
  if (automationTool) return resolveTrafficProperties({ automationTool })
  const claim =
    readCookieValue(inputs.cookie, TRAFFIC_CLAIM_COOKIE) ??
    readCookieValue(inputs.cookie, TRAFFIC_CLAIM_DEV_COOKIE)
  const signedOwner = await verifyOwnerClassClaim(claim, inputs.origin, options)
  const authenticatedOwner =
    !signedOwner && inputs.authenticatedOwner ? await inputs.authenticatedOwner() : false
  return resolveTrafficProperties({
    signedOwner,
    authenticatedOwner,
    unsignedOwner: hasUnsignedOwnerFlag(inputs.cookie),
  })
}

let pageTraffic: Promise<TrafficProperties> | undefined
let authenticatedOwnerSignal: (() => Promise<boolean>) | undefined

/**
 * Set by the `analytics-owner-session` plugin, which runs before the PostHog
 * and GA4 plugins on apps that opt in with `nardukAnalytics.authenticatedOwner`.
 */
export function setAuthenticatedOwnerSignal(signal: () => Promise<boolean>): void {
  authenticatedOwnerSignal = signal
}

/**
 * One classification per page load, shared by the PostHog and GA4 plugins so
 * both send the same class. Never rejects: a failure classifies as unmarked.
 */
export function pageTrafficProperties(): Promise<TrafficProperties> {
  pageTraffic ??= resolveBrowserTrafficProperties({
    cookie: typeof document === 'undefined' ? '' : document.cookie,
    origin: typeof window === 'undefined' ? '' : window.location.origin,
    userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
    authenticatedOwner: authenticatedOwnerSignal,
  }).catch(() => resolveTrafficProperties({}))
  return pageTraffic
}

/** Tests only. */
export function resetPageTrafficProperties(): void {
  pageTraffic = undefined
  authenticatedOwnerSignal = undefined
}
