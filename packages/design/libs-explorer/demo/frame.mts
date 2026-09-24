/**
 * Viewport presets and the message protocol between a demo page and its
 * preview frames.
 *
 * A preview renders inside a same-origin `<iframe>` of `/frame/<id>`, so the
 * preset width is the frame document's real viewport and a component's media
 * queries (NeDataTable's phone column switch, say) respond to it. The page
 * stays the owner of the shareable URL; the frame owns nothing but what it
 * draws. They talk through `postMessage`, and both sides check the origin and
 * the sender before trusting a message.
 */

export const VIEWPORTS = { full: null, tablet: 768, phone: 375 } as const
export type Viewport = keyof typeof VIEWPORTS

export function parseViewport(value: string | null): Viewport {
  return value === 'tablet' || value === 'phone' ? value : 'full'
}

/** What a frame shows: the interactive demo, the design card, or the usage source rendered live. */
export const SURFACES = ['demo', 'card', 'usage'] as const
export type Surface = (typeof SURFACES)[number]

export function parseSurface(value: string | null): Surface | null {
  return (SURFACES as readonly string[]).includes(value ?? '') ? (value as Surface) : null
}

export type ColorScheme = 'light' | 'dark'

/** Page → frame. */
export type ToFrame =
  | { type: 'explorer:theme'; scheme: ColorScheme }
  /** Apply this demo state; the frame answers with its canonical query. */
  | { type: 'explorer:query'; query: Record<string, string> }

/**
 * Frame → page. `cause` says who changed the state: `user` for a control in
 * the frame (the page records a history entry), `sync` for the frame's
 * canonical answer to a load or an `explorer:query` (the page only rewrites
 * its URL in place, so a malformed link is corrected without a new entry).
 */
export type FromFrame =
  | { type: 'explorer:ready'; surface: Surface }
  | { type: 'explorer:height'; surface: Surface; height: number }
  | { type: 'explorer:event'; surface: Surface; name: string; detail: unknown }
  | {
      type: 'explorer:state'
      surface: Surface
      cause: 'user' | 'sync'
      query: Record<string, string>
    }

function isRecordOfStrings(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  )
}

export function readFromFrame(data: unknown): FromFrame | null {
  if (typeof data !== 'object' || data === null) return null
  const message = data as Record<string, unknown>
  const surface = parseSurface(typeof message.surface === 'string' ? message.surface : null)
  if (!surface) return null
  switch (message.type) {
    case 'explorer:ready':
      return { type: message.type, surface }
    case 'explorer:height':
      return typeof message.height === 'number' && Number.isFinite(message.height)
        ? { type: message.type, surface, height: message.height }
        : null
    case 'explorer:event':
      return typeof message.name === 'string'
        ? { type: message.type, surface, name: message.name, detail: message.detail }
        : null
    case 'explorer:state':
      return (message.cause === 'user' || message.cause === 'sync') &&
        isRecordOfStrings(message.query)
        ? { type: message.type, surface, cause: message.cause, query: message.query }
        : null
    default:
      return null
  }
}

export function readToFrame(data: unknown): ToFrame | null {
  if (typeof data !== 'object' || data === null) return null
  const message = data as Record<string, unknown>
  if (message.type === 'explorer:theme') {
    return message.scheme === 'light' || message.scheme === 'dark'
      ? { type: message.type, scheme: message.scheme }
      : null
  }
  if (message.type === 'explorer:query') {
    return isRecordOfStrings(message.query) ? { type: message.type, query: message.query } : null
  }
  return null
}

/**
 * A route query as plain strings, or `null` when any parameter is repeated or
 * valueless: such a query is never canonical, whatever its first values say.
 */
export function plainQuery(
  query: Readonly<Record<string, unknown>>,
): Record<string, string> | null {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(query)) {
    if (typeof value !== 'string') return null
    out[key] = value
  }
  return out
}

/** Order-insensitive equality for two canonical queries. */
export function sameQuery(left: Record<string, string>, right: Record<string, string>): boolean {
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key])
}

/** A page's query minus the page's own parameters: the part the demo owns. */
export function demoPart(
  query: Readonly<Record<string, unknown>>,
  pageParameters: readonly string[] = ['width'],
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(query)) {
    if (pageParameters.includes(key)) continue
    const first = Array.isArray(value) ? value[0] : value
    if (typeof first === 'string') out[key] = first
  }
  return out
}

/**
 * Every preview-frame route the build must prerender. The link crawler does
 * not follow an iframe's `src`, so these are listed explicitly, and
 * `check:package` requires each one in the output.
 */
export function frameRoutes(
  examples: readonly { id: string; interactive?: boolean; card?: string | null }[],
): string[] {
  return examples.flatMap(({ id, interactive, card }) => [
    ...(interactive ? [`/frame/${id}/demo`] : []),
    `/frame/${id}/usage`,
    ...(card ? [`/frame/${id}/card`] : []),
  ])
}
