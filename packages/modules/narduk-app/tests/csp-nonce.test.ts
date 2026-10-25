import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createApp, eventHandler, toWebHandler } from 'h3'
import { describe, expect, it } from 'vitest'

import {
  getCspNonce,
  installCspNonce,
  mintCspNonce,
  stampScriptNonce,
  type RenderHtmlParts,
} from '../src/server/csp-nonce'
import { applySecurityHeaders, buildSecurityHeaders } from '../src/server/security-headers'

describe('mintCspNonce', () => {
  it('is fresh per call and base64 of 128 bits', () => {
    const [a, b] = [mintCspNonce(), mintCspNonce()]
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[a-z0-9+/]{22}==$/i)
  })
})

describe('stampScriptNonce', () => {
  it('stamps inline, json, external and module scripts but not lookalikes', () => {
    const html = [
      '<script>window.__NUXT__={}</script>',
      '<script type="application/json" data-nuxt-data="nuxt-app" id="__NUXT_DATA__">[1]</script>',
      '<script type="module" src="/_nuxt/entry.js" crossorigin></script>',
      '<script src="/a?x=>1"></script>',
      '<scripty>no</scripty>',
    ].join('')
    const out = stampScriptNonce(html, 'N')
    expect(out.match(/<script\b[^>]*>/g)).toEqual([
      '<script nonce="N">',
      '<script nonce="N" type="application/json" data-nuxt-data="nuxt-app" id="__NUXT_DATA__">',
      '<script nonce="N" type="module" src="/_nuxt/entry.js" crossorigin>',
      '<script nonce="N" src="/a?x=>',
    ])
    expect(out).toContain('<script nonce="N" src="/a?x=>1"></script>')
    expect(out).toContain('<scripty>no</scripty>')
  })

  it('stays linear and leaves a tag with an unclosed quote alone', () => {
    const hostile = `<script src="${'"x'.repeat(50_000)}`
    const started = Date.now()
    expect(stampScriptNonce(hostile, 'N')).toBe(hostile)
    expect(Date.now() - started).toBeLessThan(500)
    expect(stampScriptNonce('<SCRIPT src="a">x</SCRIPT>', 'N')).toBe(
      '<SCRIPT nonce="N" src="a">x</SCRIPT>',
    )
  })

  it('leaves an already-stamped script alone', () => {
    const tag = '<script nonce="other" src="/x.js"></script>'
    expect(stampScriptNonce(tag, 'N')).toBe(tag)
  })
})

describe('buildSecurityHeaders with a nonce', () => {
  const csp = {
    'script-src': ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", 'https://*.apple-mapkit.com'],
    'frame-ancestors': ["'none'"],
  }

  it('puts the nonce on script-src of both policies and drops unsafe-inline', () => {
    const headers = buildSecurityHeaders(
      { csp, reportOnlyCsp: { 'default-src': ["'self'"], ...csp } },
      { https: true, nonce: 'abc' },
    )
    const enforced = headers['content-security-policy']!
    expect(enforced).toBe(
      "script-src 'self' 'wasm-unsafe-eval' https://*.apple-mapkit.com 'nonce-abc'; frame-ancestors 'none'",
    )
    expect(enforced).not.toContain('unsafe-inline')
    expect(headers['content-security-policy-report-only']).toContain("'nonce-abc'")
  })

  it('is unchanged without a nonce, and leaves a policy with no script-src alone', () => {
    expect(buildSecurityHeaders({ csp }, { https: false })['content-security-policy']).toContain(
      "'unsafe-inline'",
    )
    expect(
      buildSecurityHeaders({ csp: { 'object-src': ["'none'"] } }, { https: false, nonce: 'abc' })[
        'content-security-policy'
      ],
    ).toBe("object-src 'none'")
  })
})

describe('installCspNonce', () => {
  const render = async (optIn: boolean, routeRules?: Record<string, unknown>) => {
    const handlers: Record<string, Array<(...args: never[]) => void>> = {}
    const hooks = {
      hook: (name: string, handler: (...args: never[]) => void) =>
        (handlers[name] ??= []).push(handler),
      callHook: async (name: string, ...args: unknown[]) => {
        for (const handler of handlers[name] ?? []) (handler as (...a: unknown[]) => void)(...args)
      },
    }
    installCspNonce({ hooks } as never)
    const app = createApp()
    app.use(
      eventHandler(async (event) => {
        if (routeRules) event.context._nitro = { routeRules }
        const nonce = optIn ? getCspNonce(event) : undefined
        applySecurityHeaders(event, { csp: { 'script-src': ["'self'"] } }, { nonce })
        event.node.res.setHeader('content-type', 'text/html')
        event.node.res.setHeader('cache-control', 'public, s-maxage=600')
        const html: RenderHtmlParts = {
          head: ['<script type="module" src="/_nuxt/e.js"></script>'],
          bodyPrepend: [],
          body: ['<div id="__nuxt"><script>steal()</script></div>'],
          bodyAppend: [
            '<script type="application/json" id="__NUXT_DATA__">[]</script><script>window.__NUXT__={}</script>',
          ],
        }
        await hooks.callHook('render:html', html, { event })
        await hooks.callHook('beforeResponse', event)
        return [...html.head, ...html.body, ...html.bodyAppend].join('')
      }),
    )
    const response = await toWebHandler(app)(new Request('http://example.test/'))
    return { response, body: await response.text() }
  }

  it('stamps every script with the nonce the header carries, and no-stores the page', async () => {
    const { response, body } = await render(true)
    const nonce = /'nonce-([^']+)'/.exec(response.headers.get('content-security-policy')!)![1]
    const tags = body.match(/<script\b[^>]*>/g)!
    expect(tags).toHaveLength(4)
    expect(tags.filter((tag) => tag.includes(`nonce="${nonce}"`))).toHaveLength(3)
    expect(body).toContain('<div id="__nuxt"><script>steal()</script></div>')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('refuses a route that is cached or prerendered, since the nonce would be replayed', async () => {
    for (const rules of [
      { swr: 60 },
      { cache: { maxAge: 5 } },
      { isr: true },
      { prerender: true },
    ]) {
      const { response, body } = await render(true, rules)
      expect(response.status).toBe(500)
      expect(body).not.toContain('nonce=')
    }
  })

  it('does nothing for a request that never asked for a nonce', async () => {
    const { response, body } = await render(false)
    expect(body).not.toContain('nonce=')
    expect(response.headers.get('cache-control')).toBe('public, s-maxage=600')
  })

  it('gives each request its own nonce', async () => {
    const [a, b] = await Promise.all([render(true), render(true)])
    expect(a.response.headers.get('content-security-policy')).not.toBe(
      b.response.headers.get('content-security-policy'),
    )
  })
})

describe('a rendered Nuxt page', () => {
  // Captured from `nuxi build` of tests/fixtures/nonce-app (Nuxt 4.5), nonces and the fixture's v-html payload removed.
  const page = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'fixtures/nuxt-rendered.html'),
    'utf8',
  )

  it('has inline scripts, and every one carries the nonce once stamped', () => {
    const before = page.match(/<script\b[^>]*>/g)!
    expect(before.some((tag) => tag.includes('__NUXT_DATA__'))).toBe(true)
    expect(before.some((tag) => tag === '<script>')).toBe(true)
    const tags = stampScriptNonce(page, 'N').match(/<script\b[^>]*>/g)!
    expect(tags).toHaveLength(before.length)
    for (const tag of tags) expect(tag).toContain('nonce="N"')
  })
})
