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
    const response = await fetchFixture('/api/mapkit-token')
    const body = (await response.json()) as { configured: boolean; token: string }

    expect(response.status).toBe(503)
    expect(body).toMatchObject({ configured: false, token: '' })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('registers the token endpoint for GET only', async () => {
    const response = await fetchFixture('/api/mapkit-token', { method: 'POST' })

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET')
  })

  it('honors an app-owned request-scoped rate-limit hook', async () => {
    const response = await fetchFixture('/api/mapkit-token', {
      headers: { 'x-mapkit-test-rate-limit': 'deny' },
    })

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('15')
    await expect(response.json()).resolves.toMatchObject({
      configured: true,
      error: 'Fixture rate limit exceeded.',
      token: '',
    })
  })
})
