import { removeResponseHeader, setResponseHeader } from 'h3'

import type { H3Event } from 'h3'

/** Nuxt's `render:html` payload: the HTML fragments Nitro joins into the page. */
export interface RenderHtmlParts {
  head: string[]
  bodyPrepend: string[]
  body: string[]
  bodyAppend: string[]
}

const HAS_NONCE = /\snonce\s*=/i

/** Index of the `>` closing the tag whose attributes start at `from`, or -1 if a quote or the tag never closes. */
function tagEnd(html: string, from: number): number {
  let quote = ''
  for (let i = from; i < html.length; i++) {
    const ch = html[i]
    if (quote) {
      if (ch === quote) quote = ''
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === '>') {
      return i
    }
  }
  return -1
}

/** 128 random bits, base64: a fresh value per call. */
export function mintCspNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
}

/** Adds `nonce` to every `<script>` open tag that lacks one; nothing else changes. One linear pass. */
export function stampScriptNonce(html: string, nonce: string): string {
  const lower = html.toLowerCase()
  let out = ''
  let last = 0
  let at = lower.indexOf('<script')
  while (at !== -1) {
    const attrsFrom = at + '<script'.length
    const next = html[attrsFrom]
    const end = next !== undefined && /[\s>/]/.test(next) ? tagEnd(html, attrsFrom) : -1
    if (end === -1) {
      at = lower.indexOf('<script', attrsFrom)
      continue
    }
    if (!HAS_NONCE.test(html.slice(attrsFrom, end))) {
      out += `${html.slice(last, attrsFrom)} nonce="${nonce}"`
      last = attrsFrom
    }
    at = lower.indexOf('<script', end)
  }
  return out + html.slice(last)
}

/** The request's CSP nonce, minted on first use so the header and the page stamp agree. */
export function getCspNonce(event: H3Event): string {
  return (event.context.cspNonce ??= mintCspNonce()) as string
}

interface NitroRouteRules {
  cache?: unknown
  swr?: unknown
  isr?: unknown
  prerender?: unknown
}

/** Throws when a response cannot carry a per-request nonce: a Nitro cache would replay it, a prerender bakes it in. */
function assertUncachedRender(event: H3Event): void {
  const rules = (event.context._nitro as { routeRules?: NitroRouteRules } | undefined)?.routeRules
  const prerendering = Boolean(event.node.req.headers['x-nitro-prerender'])
  const cached = rules && (rules.cache || rules.swr || rules.isr || rules.prerender)
  if (!cached && !prerendering) return
  throw new Error(
    `narduk-app csp-nonce: ${event.path} is prerendered or cached (routeRules cache/swr/isr/prerender), so one nonce would be replayed to every visitor and the page's scripts would be blocked. Nonce CSP needs uncached SSR: remove the rule, or serve that route without a nonce.`,
  )
}

/**
 * Stamps the request's nonce on the scripts Nuxt and unhead render into the
 * head, `bodyPrepend` and `bodyAppend` (module entry, import map, hydration
 * payload, `useHead` scripts) and makes that HTML `private, no-store`: a cached
 * page would replay one nonce to every visitor. The `body` part is the app's
 * own markup and is never stamped, so a `<script>` that reaches it through
 * `v-html` or raw HTML stays blocked. Pages are stamped only when the app asked
 * for a nonce (`getCspNonce`) earlier in the request; a prerendered or
 * route-rule-cached page throws instead, see {@link assertUncachedRender}.
 *
 * Call from a Nitro plugin.
 */
export function installCspNonce(nitroApp: {
  hooks: {
    hook(
      name: 'render:html',
      handler: (html: RenderHtmlParts, context: { event: H3Event }) => void,
    ): unknown
    hook(name: 'beforeResponse', handler: (event: H3Event) => void): unknown
  }
}): void {
  nitroApp.hooks.hook('render:html', (html, { event }) => {
    const nonce = event.context.cspNonce as string | undefined
    if (!nonce) return
    assertUncachedRender(event)
    for (const key of ['head', 'bodyPrepend', 'bodyAppend'] as const) {
      html[key] = html[key].map((part) => stampScriptNonce(part, nonce))
    }
    event.context.cspNonceStamped = true
  })
  nitroApp.hooks.hook('beforeResponse', (event) => {
    if (!event.context.cspNonceStamped) return
    setResponseHeader(event, 'cache-control', 'private, no-store')
    removeResponseHeader(event, 'cdn-cache-control')
    removeResponseHeader(event, 'cloudflare-cdn-cache-control')
  })
}
