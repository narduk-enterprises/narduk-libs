import { readMapKitRuntimeString } from '../src/runtime/server/runtime-env'

describe('MapKit Nuxt runtime environment', () => {
  it('reads non-enumerable Cloudflare binding values before process fallbacks', () => {
    const cloudflareEnv: Record<string, unknown> = {}
    Object.defineProperty(cloudflareEnv, 'APPLE_KEY_ID', {
      enumerable: false,
      value: 'worker-key',
    })

    expect(
      readMapKitRuntimeString(
        [cloudflareEnv, { APPLE_KEY_ID: 'process-key' }],
        ['APPLE_KEY_ID'],
        'config-key',
      ),
    ).toBe('worker-key')
  })

  it('uses aliases and then runtime-config fallback', () => {
    expect(
      readMapKitRuntimeString(
        [{ APPLE_SECRET_KEY: 'legacy-key' }],
        ['APPLE_PRIVATE_KEY', 'APPLE_SECRET_KEY'],
        'config-key',
      ),
    ).toBe('legacy-key')
    expect(readMapKitRuntimeString([{}], ['APPLE_KEY_ID'], ' config-key ')).toBe('config-key')
  })
})
