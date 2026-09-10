import type {
  UpgradeDurableObjectNamespace,
  UpgradeDurableObjectStub,
  UpgradeExecutionContext,
  UpgradeLocalFetch,
  UpgradeLocalFetchInit,
} from '../../src/worker/upgrade-router.js'

/**
 * A Durable Object namespace double.
 *
 * Records every `idFromName` argument and every forwarded request, and answers
 * with a caller-supplied response. It stands in for the 101 the real object
 * would produce: a `Response` with `status: 101` cannot be constructed under
 * Node, so a 200 marked with a header stands for it. Nothing in the router
 * inspects the object's response, so the substitution costs no coverage.
 */
export function fakeNamespace(respondWith?: () => Response): {
  namespace: UpgradeDurableObjectNamespace
  names: string[]
  forwarded: Request[]
} {
  const names: string[] = []
  const forwarded: Request[] = []

  const stub: UpgradeDurableObjectStub = {
    fetch(request) {
      forwarded.push(request)
      return respondWith?.() ?? new Response('accepted', { headers: { 'x-fake-101': 'yes' } })
    },
  }

  return {
    names,
    forwarded,
    namespace: {
      idFromName(name) {
        names.push(name)
        return { name }
      },
      get(id) {
        // The router must hand back exactly what `idFromName` produced.
        if (typeof id !== 'object' || id === null || !('name' in id)) {
          throw new TypeError('get() was not given an id from idFromName()')
        }
        return stub
      },
    },
  }
}

/** An `ExecutionContext` double that records `waitUntil` promises. */
export function fakeExecutionContext(): UpgradeExecutionContext & {
  promises: Array<Promise<unknown>>
} {
  const promises: Array<Promise<unknown>> = []
  return {
    promises,
    waitUntil(promise) {
      promises.push(promise)
    },
  }
}

/** A `localFetch` double recording every in-process probe. */
export function fakeLocalFetch(respondWith: (path: string) => Response): {
  localFetch: UpgradeLocalFetch
  calls: Array<{ path: string; init: UpgradeLocalFetchInit }>
} {
  const calls: Array<{ path: string; init: UpgradeLocalFetchInit }> = []
  return {
    calls,
    localFetch(path, init) {
      calls.push({ path, init })
      return respondWith(path)
    },
  }
}

/** How an upgrade request may differ from a browser's own handshake. */
export interface UpgradeRequestInit {
  method?: string
  body?: string
}

/**
 * An upgrade request, shaped like the one a browser sends.
 *
 * `headers` is spread over the handshake headers, including the same-origin
 * `Origin` a browser is obliged to send -- the router's default policy compares
 * it, so a double that omitted it would test a refusal rather than a handshake.
 * Pass `{ origin: undefined }` to leave it out, as a non-browser client would.
 */
export function upgradeRequest(
  url: string,
  headers: Record<string, string | undefined> = {},
  init: UpgradeRequestInit = {},
): Request {
  const merged: Record<string, string | undefined> = {
    connection: 'Upgrade',
    upgrade: 'websocket',
    origin: `https://${new URL(url).host}`,
    'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
    'sec-websocket-version': '13',
    ...headers,
  }

  return new Request(url, {
    method: init.method ?? 'GET',
    headers: Object.entries(merged).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
    ...(init.body === undefined ? {} : { body: init.body }),
  })
}

/** A `next` double: records what it was given and answers 404 like Nitro would. */
export function fakeNext(): {
  next: (request: Request) => Response
  requests: Request[]
} {
  const requests: Request[] = []
  return {
    requests,
    next(request) {
      requests.push(request)
      return new Response('nitro', { status: 404 })
    },
  }
}
