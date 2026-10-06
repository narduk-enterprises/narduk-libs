/**
 * Traffic classification (classification_version 1).
 *
 * Every analytics event this module sends carries `traffic_class` and
 * `classification_version`, so a reader can tell Logan's own browsers and our
 * automation apart from real visitors. Nothing is dropped: marked traffic is
 * tagged and the reader filters (`traffic_class` missing on an event means it
 * was sent before this version shipped, which a reader treats as unmarked).
 *
 * Precedence, strongest evidence first:
 *   1. `automation` — the user agent carries `NardukAutomation/<tool>`, which
 *      our own tools append (Lighthouse, live probes).
 *   2. `owner`, `signed_enrollment` — a verified, origin-bound class claim the
 *      operator portal minted for this browser (see `trafficClaim.ts`).
 *   3. `owner`, `authenticated_session` — a signed-in session on an app that
 *      declares every account is the owner (`nardukAnalytics.authenticatedOwner`).
 *   4. `owner`, `unsigned_claim` — the legacy client-set `narduk_owner=true`
 *      cookie. Anyone can set it, so it is lower evidence and labelled so.
 *   5. `unmarked` — everybody else.
 *
 * Only low-cardinality values leave the browser: no token, header, IP or
 * identity is ever put on an event.
 */

export const TRAFFIC_CLASSIFICATION_VERSION = 1

export type TrafficClass = 'automation' | 'owner' | 'unmarked'
export type TrafficEvidence =
  'authenticated_session' | 'none' | 'signed_enrollment' | 'ua_marker' | 'unsigned_claim'

export interface TrafficProperties {
  [key: string]: unknown
  automation_tool?: string
  classification_version: typeof TRAFFIC_CLASSIFICATION_VERSION
  traffic_class: TrafficClass
  traffic_evidence: TrafficEvidence
}

export interface TrafficSignals {
  /**
   * A narduk-auth session on an app that declares every account is the owner
   * (`nardukAnalytics.authenticatedOwner`), e.g. the operator portal.
   */
  authenticatedOwner?: boolean
  /** The `<tool>` of a `NardukAutomation/<tool>` user-agent marker, if any. */
  automationTool?: string | null
  /** A verified signed enrollment claim for this origin. */
  signedOwner?: boolean
  /** The legacy unsigned `narduk_owner=true` cookie. */
  unsignedOwner?: boolean
}

/** The user-agent marker our automation appends. */
export const AUTOMATION_UA_MARKER = /NardukAutomation\/([\w.-]+)/u

/** Tool names are a closed, low-cardinality vocabulary in practice; cap them anyway. */
const MAX_TOOL_LENGTH = 40

/** The tool named by a `NardukAutomation/<tool>` user-agent marker, lowercased, or null. */
export function parseAutomationMarker(userAgent: string | null | undefined): string | null {
  if (typeof userAgent !== 'string' || !userAgent) return null
  const match = AUTOMATION_UA_MARKER.exec(userAgent)
  const tool = match?.[1]?.toLowerCase().slice(0, MAX_TOOL_LENGTH)
  return tool || null
}

/** Strongest evidence wins: automation, then a signed owner claim, then the unsigned flag. */
export function resolveTrafficProperties(signals: TrafficSignals): TrafficProperties {
  const base = { classification_version: TRAFFIC_CLASSIFICATION_VERSION } as const
  if (signals.automationTool) {
    return {
      ...base,
      traffic_class: 'automation',
      traffic_evidence: 'ua_marker',
      automation_tool: signals.automationTool,
    }
  }
  if (signals.signedOwner) {
    return { ...base, traffic_class: 'owner', traffic_evidence: 'signed_enrollment' }
  }
  if (signals.authenticatedOwner) {
    return { ...base, traffic_class: 'owner', traffic_evidence: 'authenticated_session' }
  }
  if (signals.unsignedOwner) {
    return { ...base, traffic_class: 'owner', traffic_evidence: 'unsigned_claim' }
  }
  return { ...base, traffic_class: 'unmarked', traffic_evidence: 'none' }
}

/** The legacy owner flag, as `posthog.client` has always read it. */
export function hasUnsignedOwnerFlag(cookieHeader: string | null | undefined): boolean {
  if (!cookieHeader) return false
  return cookieHeader.split(';').some((cookie) => cookie.trim() === 'narduk_owner=true')
}

/** One cookie's raw value from a `Cookie` header or `document.cookie`. */
export function readCookieValue(
  cookieHeader: string | null | undefined,
  name: string,
): string | undefined {
  if (!cookieHeader) return undefined
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    if (part.slice(0, separator).trim() !== name) continue
    const value = part.slice(separator + 1).trim()
    try {
      return decodeURIComponent(value)
    } catch {
      return value
    }
  }
  return undefined
}
