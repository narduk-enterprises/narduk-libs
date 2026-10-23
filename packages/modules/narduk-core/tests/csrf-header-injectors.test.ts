import { afterEach, describe, expect, it, vi } from 'vitest'

import { useAppFetch } from '../runtime/app/composables/useAppFetch'
import { useCsrfFetch } from '../runtime/app/composables/useCsrfFetch'
import fetchPlugin from '../runtime/app/plugins/fetch.client'

const ORIGIN = 'https://app.example'

vi.mock('#imports', () => ({
  defineNuxtPlugin: (setup: unknown) => setup,
  useNuxtApp: () => ({}),
  useRequestFetch: () => (_request: unknown, options: { headers?: Headers }) =>
    Promise.resolve(options),
}))

type OnRequest = (context: {
  options: { headers?: unknown; method?: string }
  request: unknown
}) => void

/** Runs the `onRequest` hook an injector registered, as `$fetch` would. */
function sentHeaders(onRequest: OnRequest, request: string, method: string): Headers | null {
  const options: { headers?: unknown; method: string } = { method }
  onRequest({ options, request })
  return options.headers instanceof Headers ? options.headers : null
}

function captureHook(install: () => unknown): OnRequest {
  let hook: OnRequest | undefined
  vi.stubGlobal('$fetch', {
    create: (config: { onRequest: OnRequest }) => {
      hook = config.onRequest
      return config
    },
  })
  install()
  return hook!
}

afterEach(() => vi.unstubAllGlobals())

const injectors: Array<[string, () => OnRequest]> = [
  [
    'fetch.client plugin',
    () => {
      vi.stubGlobal('window', { location: { origin: ORIGIN } })
      return captureHook(() => (fetchPlugin as unknown as () => unknown)())
    },
  ],
  ['useCsrfFetch', () => captureHook(() => useCsrfFetch())],
]

describe.each(injectors)('%s', (_name, setup) => {
  it('marks a relative mutation and leaves a GET alone', () => {
    const hook = setup()
    expect(sentHeaders(hook, '/api/items', 'POST')?.get('X-Requested-With')).toBe('XMLHttpRequest')
    expect(sentHeaders(hook, '/api/items', 'GET')).toBeNull()
  })

  it('does not mark a protocol-relative URL to another host', () => {
    const hook = setup()
    expect(sentHeaders(hook, '//evil.example/api', 'POST')).toBeNull()
  })

  it('marks an absolute same-origin mutation', () => {
    vi.stubGlobal('window', { location: { origin: ORIGIN } })
    const hook = setup()
    expect(sentHeaders(hook, `${ORIGIN}/api/items`, 'POST')?.get('X-Requested-With')).toBe(
      'XMLHttpRequest',
    )
  })
})

describe('useAppFetch', () => {
  it('adds the header on a mutation only', async () => {
    const fetcher = useAppFetch()
    const post = await fetcher<{ headers: Headers }>('/api/items', { method: 'POST' })
    expect(post.headers.get('X-Requested-With')).toBe('XMLHttpRequest')
    const get = await fetcher<{ headers?: Headers }>('/api/items')
    expect(get.headers).toBeUndefined()
  })
})
