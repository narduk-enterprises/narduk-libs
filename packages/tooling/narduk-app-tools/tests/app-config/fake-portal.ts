import type { AppConfigFetch, AppConfigFetchResponse } from '../../src/app-config/resolve.js'

export const TOKEN = 'nk_test_0123456789abcdef'

/** Retry options for tests that fail on purpose: no real backoff timers. */
export const noBackoff = { sleep: async () => {}, random: () => 0.5 }

export interface FakeCall {
  url: URL
  authorization: string | undefined
}

export interface FakePortal {
  fetch: AppConfigFetch
  calls: FakeCall[]
}

function response(status: number, body = '', revision?: number): AppConfigFetchResponse {
  return {
    status,
    headers: {
      get: (name) =>
        name.toLowerCase() === 'x-app-config-revision' && revision !== undefined
          ? String(revision)
          : null,
    },
    text: async () => body,
  }
}

/**
 * A portal that serves `documents` keyed by `<repo>/<file>` (200 with a revision
 * header), 404 for any other, or answers every request with `status`.
 */
export function fakePortal(
  documents: Record<string, unknown> = {},
  options: { status?: number; error?: Error } = {},
): FakePortal {
  const calls: FakeCall[] = []
  const fetch: AppConfigFetch = async (url, init) => {
    const parsed = new URL(url)
    calls.push({ url: parsed, authorization: init.headers.authorization })
    if (options.error) throw options.error
    if (options.status !== undefined) return response(options.status)
    const key = `${parsed.searchParams.get('repo')}/${parsed.searchParams.get('file')}`
    const document = documents[key]
    if (document === undefined) return response(404)
    return response(200, typeof document === 'string' ? document : JSON.stringify(document), 7)
  }
  return { fetch, calls }
}
