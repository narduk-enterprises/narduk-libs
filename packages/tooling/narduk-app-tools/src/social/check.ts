import { readFileSync } from 'node:fs'

import { parse, Parser } from 'parse5'
import type { DefaultTreeAdapterMap } from 'parse5'

import { checkRouteInventory, publicUrl } from './config.js'
import type { SocialPreviewConfig } from './config.js'
import { defaultImageFile, inspectSocialImage, MAX_IMAGE_BYTES } from './images.js'

export const CRAWLER_AGENTS = {
  twitter: 'Twitterbot/1.0',
  apple: 'Mozilla/5.0 (compatible; Applebot/0.1; +http://www.apple.com/go/applebot)',
} as const
const MAX_HTML_BYTES = 1_000_000
const REQUEST_TIMEOUT_MS = 10_000
const CONCURRENCY = 4

export interface SocialPreviewReport {
  schemaVersion: 1
  ok: boolean
  mode: 'offline' | 'live'
  pages: number
  samples: number
  errors: string[]
  targetOrigin?: string
  canonicalOrigin?: string
}

export function socialMeta(html: string): Map<string, string[]> {
  const result = new Map<string, string[]>()
  function walk(node: DefaultTreeAdapterMap['node'], inHead = false): void {
    const head = inHead || ('tagName' in node && node.tagName === 'head')
    if (head && 'tagName' in node && node.tagName === 'meta') {
      const attrs = Object.fromEntries(node.attrs.map(({ name, value }) => [name, value]))
      const key = (attrs.property ?? attrs.name)?.toLowerCase()
      if (key?.startsWith('og:') || key?.startsWith('twitter:')) {
        result.set(key, [...(result.get(key) ?? []), attrs.content?.trim() ?? ''])
      }
    }
    if ('childNodes' in node) for (const child of node.childNodes) walk(child, head)
  }
  walk(parse(html))
  return result
}

/** No cookies/credentials; bounded redirects, bytes, and total request time.
 * HTML probes cancel after the parsed head; SSR data in the body is irrelevant.
 */
async function fetchBytes(
  url: URL,
  agent: string,
  origins: Set<string>,
  limit: number,
  runSignal: AbortSignal,
  headOnly = false,
): Promise<{ bytes: Uint8Array; mime: string }> {
  const signal = AbortSignal.any([runSignal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
  let current = url
  for (let hop = 0; hop <= 3; hop++) {
    if (!origins.has(current.origin))
      throw new Error('Request or redirect left the declared origins')
    const response = await fetch(current, {
      headers: { 'user-agent': agent, accept: '*/*' },
      credentials: 'omit',
      redirect: 'manual',
      signal,
    })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      await response.body?.cancel()
      if (!location) throw new Error('Redirect is missing Location')
      current = publicUrl(new URL(location, current).href, true)
      continue
    }
    if (response.status !== 200) {
      await response.body?.cancel()
      throw new Error(`HTTP ${response.status}`)
    }
    if (!headOnly && Number(response.headers.get('content-length')) > limit) {
      await response.body?.cancel()
      throw new Error('Response exceeds byte limit')
    }
    if (!response.body) throw new Error('Empty response body')
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    const decoder = new TextDecoder()
    const parser = headOnly
      ? new Parser<DefaultTreeAdapterMap>({ sourceCodeLocationInfo: true })
      : null
    let headComplete = false
    if (parser) {
      const onEndTag = parser.onEndTag.bind(parser)
      parser.onEndTag = (token) => {
        onEndTag(token)
        if (token.tagName !== 'head') return
        const html = parser.document.childNodes.find(
          (node) => 'tagName' in node && node.tagName === 'html',
        )
        const head =
          html && 'childNodes' in html
            ? html.childNodes.find((node) => 'tagName' in node && node.tagName === 'head')
            : undefined
        // The tree builder must have closed the real head. Literal/scripted or
        // template-contained </head> text must not hide later duplicate metadata.
        if (head && 'tagName' in head && head.sourceCodeLocation?.endTag) {
          headComplete = true
          parser.tokenizer.pause()
        }
      }
    }
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        const bytes = headOnly ? chunk.value.subarray(0, limit - size) : chunk.value
        size += bytes.byteLength
        if (size > limit) throw new Error('Response exceeds byte limit')
        chunks.push(bytes)
        parser?.tokenizer.write(decoder.decode(bytes, { stream: true }), false)
        if (headComplete) break
        if (headOnly && size >= limit) throw new Error('HTML head exceeds byte limit')
      }
    } finally {
      await reader.cancel()
      reader.releaseLock()
    }
    return { bytes: Buffer.concat(chunks), mime: response.headers.get('content-type') ?? '' }
  }
  throw new Error('Too many redirects')
}

function oneMeta(meta: Map<string, string[]>, key: string): string {
  const values = meta.get(key)
  if (values?.length !== 1 || !values[0])
    throw new Error(`Expected exactly one nonempty ${key} in the server-rendered head`)
  return values[0]
}

interface ProbeContext {
  signal: AbortSignal
  site: URL
  target: URL
  local: boolean
  origins: Set<string>
  imageHashes: Map<string, Promise<string>>
}

function imageHash(url: URL, agent: string, context: ProbeContext): Promise<string> {
  // A local probe reads canonical-origin assets from the explicitly selected server.
  const target = new URL(url)
  if (url.origin === context.site.origin) {
    target.protocol = context.target.protocol
    target.host = context.target.host
  }
  const key = agent + '\n' + target.href
  let promise = context.imageHashes.get(key)
  if (!promise) {
    promise = fetchBytes(target, agent, context.origins, MAX_IMAGE_BYTES, context.signal).then(
      ({ bytes, mime }) => inspectSocialImage(bytes, mime),
    )
    context.imageHashes.set(key, promise)
  }
  return promise
}

async function probePage(
  path: string,
  agent: string,
  context: ProbeContext,
): Promise<{ image: string; hash: string }> {
  const url = new URL(path, context.target)
  const { bytes, mime } = await fetchBytes(
    url,
    agent,
    new Set([context.target.origin]),
    MAX_HTML_BYTES,
    context.signal,
    true,
  )
  if (!/^text\/html(?:;|$)/iu.test(mime)) throw new Error('Page is not text/html')
  const meta = socialMeta(new TextDecoder().decode(bytes))
  for (const key of ['og:title', 'og:description', 'og:type', 'og:image:alt']) oneMeta(meta, key)
  const canonical = publicUrl(oneMeta(meta, 'og:url'), context.local)
  if (
    canonical.origin !== context.site.origin ||
    canonical.pathname !== new URL(path, context.site).pathname
  ) {
    const expected = new URL(path, context.site).href
    // Named so a local `--base-url` run doesn't read as "eighteen identical
    // lines with no hint" (narduk-libs#587): the target (where pages are
    // fetched) and the canonical origin (siteUrl) are deliberately different
    // things, and a local dev server renders whatever `useSiteConfig()`
    // resolves to -- which is not automatically the configured `siteUrl`
    // unless something forces it. `NUXT_PUBLIC_SITE_URL` is nuxt-site-config's
    // own env override (see its `envSiteConfig`, which reads `NUXT_SITE_*` /
    // `NUXT_PUBLIC_SITE_*` prefixes only); a bare `SITE_URL` is a different,
    // narduk-core-only convention and does not affect this.
    const hint = context.local
      ? ` A local dev server must render the canonical origin: NUXT_PUBLIC_SITE_URL=${context.site.origin} <dev command>.`
      : ''
    throw new Error(`og:url is ${canonical.href}; expected ${expected} (siteUrl).${hint}`)
  }
  if (oneMeta(meta, 'og:image:width') !== '1200' || oneMeta(meta, 'og:image:height') !== '630') {
    throw new Error('Expected declared image dimensions 1200x630')
  }
  // Open Graph is the whole contract: X reads `og:*` when no `twitter:*` tag is
  // present, and the estate stopped emitting them because Unhead 3 reports every
  // `twitter:*` name as deprecated (narduk-libs#349). A page that still carries
  // them is not rejected here -- the browser-console contract owns that.
  const image = publicUrl(oneMeta(meta, 'og:image'), context.local)
  if (image.origin !== context.site.origin && !context.origins.has(image.origin))
    throw new Error('Image origin is not declared in imageOrigins')
  return { image: image.href, hash: await imageHash(image, agent, context) }
}

export async function checkSocialPreviews(
  config: SocialPreviewConfig,
  root: string,
  options: { live?: boolean; baseUrl?: string; timeoutMs?: number } = {},
): Promise<SocialPreviewReport> {
  const report: SocialPreviewReport = {
    schemaVersion: 1,
    ok: false,
    mode: options.live ? 'live' : 'offline',
    pages: config.routes.length,
    samples: 0,
    errors: [],
  }
  let defaultHash = ''
  try {
    report.errors.push(...checkRouteInventory(config, root))
    defaultHash = await inspectSocialImage(readFileSync(defaultImageFile(config, root)))
  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error))
  }
  if (!options.live || report.errors.length > 0) {
    report.ok = report.errors.length === 0
    return report
  }
  const site = publicUrl(config.siteUrl, Boolean(options.baseUrl))
  const target = publicUrl(options.baseUrl ?? config.siteUrl, Boolean(options.baseUrl))
  if (site.pathname !== '/' || target.pathname !== '/' || site.search || target.search)
    throw new Error('siteUrl and base-url must be origins')
  const context: ProbeContext = {
    signal: AbortSignal.timeout(Math.max(1, Math.min(options.timeoutMs ?? 120_000, 120_000))),
    site,
    target,
    local: Boolean(options.baseUrl),
    origins: new Set([target.origin, ...config.imageOrigins]),
    imageHashes: new Map(),
  }
  report.targetOrigin = target.origin
  report.canonicalOrigin = site.origin
  const checks = Object.entries(CRAWLER_AGENTS).flatMap(([profile, agent]) => {
    return [
      async () => {
        const hash = await imageHash(new URL(config.defaultImage.path, site), agent, context)
        if (hash !== defaultHash)
          throw new Error('Deployed default image differs from the checked local asset')
      },
      ...config.routes
        .filter((route) => route.kind !== 'private')
        .map((route) => async () => {
          const hashes = new Set<string>()
          for (const path of route.paths) {
            if (context.signal.aborted) break
            report.samples++
            try {
              const result = await probePage(path, agent, context)
              if (
                route.kind === 'default' &&
                result.image !== new URL(config.defaultImage.path, site).href
              )
                throw new Error('Default route did not select defaultImage.path')
              if (
                route.kind === 'dynamic' &&
                (result.hash === defaultHash || hashes.has(result.hash))
              )
                throw new Error(
                  'Dynamic route reused the default image or identical pixels across samples',
                )
              hashes.add(result.hash)
            } catch (error) {
              report.errors.push(
                `${profile} ${path}: ${error instanceof Error ? error.message : String(error)}`,
              )
            }
          }
        }),
    ].map((check) => async () => {
      try {
        await check()
      } catch (error) {
        report.errors.push(
          `${profile} default image: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    })
  })
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, checks.length) }, async () => {
      while (next < checks.length && !context.signal.aborted) await checks[next++]?.()
    }),
  )
  if (context.signal.aborted)
    report.errors.push('Live preview check exceeded its total time budget')
  report.errors.sort()
  report.ok = report.errors.length === 0
  return report
}
