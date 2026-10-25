import { removeResponseHeader, setResponseHeader } from 'h3'

import type { H3Event } from 'h3'

/** Nuxt's `render:html` payload: the HTML fragments Nitro joins into the page. */
export interface RenderHtmlParts {
  head: string[]
  bodyPrepend: string[]
  body: string[]
  bodyAppend: string[]
}

const SCRIPT_OPEN = /<script(?=[\s>/])((?:[^>"']|"[^"]*"|'[^']*')*)>/gi
const HAS_NONCE = /\snonce\s*=/i

/** 128 random bits, base64: a fresh value per call. */
export function mintCspNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
}

/** Adds `nonce` to every `<script>` open tag that lacks one; nothing else changes. */
export function stampScriptNonce(html: string, nonce: string): string {
  return html.replaceAll(SCRIPT_OPEN, (tag, attrs: string) =>
    HAS_NONCE.test(attrs) ? tag : `<script nonce="${nonce}"${attrs}>`,
  )
}

/** The request's CSP nonce, minted on first use so the header and the page stamp agree. */
export function getCspNonce(event: H3Event): string {
  return (event.context.cspNonce ??= mintCspNonce()) as string
}

/**
 * Stamps the request's nonce on every script of a Nuxt-rendered page, inline
 * hydration payload included, and refuses shared caching of that HTML: a cached
 * page would replay one nonce to every visitor. Pages are stamped only when the
 * app asked for a nonce (`getCspNonce`) earlier in the request.
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
    for (const key of ['head', 'bodyPrepend', 'body', 'bodyAppend'] as const) {
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
