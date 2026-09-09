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

/** An upgrade request. `headers` is spread over the handshake headers. */
export function upgradeRequest(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: 'GET',
    headers: {
      connection: 'Upgrade',
      upgrade: 'websocket',
      'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
      'sec-websocket-version': '13',
      ...headers,
    },
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
