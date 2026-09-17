import { fileURLToPath } from 'node:url'
import { fetch as fetchFixture, setup, $fetch } from '@nuxt/test-utils/e2e'

describe('narduk-mapkit Nuxt module', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('../playground', import.meta.url)),
  })

  it('registers AppMapKit and its composables during SSR', async () => {
    const html = await $fetch<string>('/')
    expect(html).toContain('Narduk MapKit Nuxt')
    expect(html).toContain('Loading map')
  })

  it('preserves the generic 503 response when credentials are absent', async () => {
    // A browser always sends Sec-Fetch-Site; a bare node fetch sends neither it
    // nor Origin, and the 2.1.0 route fails closed on that (narduk-libs#421
    // §e.1), so the fixture has to say what a browser would.
    const response = await fetchFixture('/api/mapkit-token', {
      headers: { 'sec-fetch-site': 'same-origin' },
    })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ error: 'unconfigured' })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('vary')).toBe('origin, sec-fetch-site')
  })

  it('refuses a request that carries no same-origin evidence', async () => {
    const response = await fetchFixture('/api/mapkit-token')

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ error: 'not-same-origin' })
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('refuses a cross-site request even with a well-formed Origin', async () => {
    const response = await fetchFixture('/api/mapkit-token', {
      headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    })

    expect(response.status).toBe(403)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('registers the token endpoint for GET only', async () => {
    const response = await fetchFixture('/api/mapkit-token', { method: 'POST' })

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET')
  })

  it('honors an app-owned request-scoped rate-limit hook', async () => {
    const response = await fetchFixture('/api/mapkit-token', {
      headers: { 'sec-fetch-site': 'same-origin', 'x-mapkit-test-rate-limit': 'deny' },
    })

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('15')
    await expect(response.json()).resolves.toMatchObject({ error: 'rate-limited' })
  })
})
