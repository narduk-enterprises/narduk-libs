import { describe, expect, it, vi } from 'vitest'

import { PRINCIPAL_HEADER } from '../src/worker/principal.js'
import {
  createUpgradeRouter,
  isWebSocketUpgrade,
  withUpgradeRouter,
} from '../src/worker/upgrade-router.js'
import type {
  UpgradeAuthorizeContext,
  UpgradeExecutionContext,
  UpgradeRoute,
} from '../src/worker/upgrade-router.js'

import {
  fakeExecutionContext,
  fakeLocalFetch,
  fakeNamespace,
  fakeNext,
  upgradeRequest,
} from './support/upgrade-fakes.js'

const LIVE_PATH = '/api/app/vessels/:vesselId/live'

/**
 * A configured route.
 *
 * The router fails closed, so an entry needs `authorize` or an explicit
 * `allowUnauthenticated`. A test about something else gets the latter -- written
 * out here exactly as an app would have to write it.
 */
function liveRoute(overrides: Partial<UpgradeRoute> = {}): UpgradeRoute {
  return {
    path: LIVE_PATH,
    binding: 'VESSEL_DO',
    idFrom: 'vesselId',
    ...(overrides.authorize === undefined ? { allowUnauthenticated: true } : {}),
    ...overrides,
  }
}

describe('isWebSocketUpgrade', () => {
  it.each([
    ['websocket', true],
    ['WebSocket', true],
    [' websocket ', true],
    ['h2c', false],
  ])('reads %s as %s', (value, expected) => {
    expect(
      isWebSocketUpgrade(new Request('https://app.test/x', { headers: { upgrade: value } })),
    ).toBe(expected)
  })

  it('is false with no upgrade header at all', () => {
    expect(isWebSocketUpgrade(new Request('https://app.test/x'))).toBe(false)
  })
})

describe('upgrade router pass-through', () => {
  it('hands a non-upgrade request to the app untouched', async () => {
    const { namespace, names } = fakeNamespace()
    const { next, requests } = fakeNext()
    const router = createUpgradeRouter({ upgrades: [liveRoute()] })
    const request = new Request('https://app.test/api/app/vessels/v-1/live')

    const response = await router(request, { VESSEL_DO: namespace }, fakeExecutionContext(), next)

    expect(response.status).toBe(404)
    expect(requests).toEqual([request])
    expect(names).toEqual([])
  })

  it('hands an upgrade on an undeclared path to the app untouched', async () => {
    const { namespace, names } = fakeNamespace()
    const { next, requests } = fakeNext()
    const router = createUpgradeRouter({ upgrades: [liveRoute()] })
    const request = upgradeRequest('https://app.test/api/app/vessels/v-1/latest')

    await router(request, { VESSEL_DO: namespace }, fakeExecutionContext(), next)

    expect(requests).toEqual([request])
    expect(names).toEqual([])
  })

  it('matches the first declared route when two could apply', async () => {
    const { namespace, names } = fakeNamespace()
    const router = createUpgradeRouter({
      upgrades: [
        {
          path: '/api/live/:id',
          binding: 'FIRST_DO',
          idFrom: 'name:first',
          allowUnauthenticated: true,
        },
        {
          path: '/api/live/:other',
          binding: 'SECOND_DO',
          idFrom: 'name:second',
          allowUnauthenticated: true,
        },
      ],
    })

    await router(
      upgradeRequest('https://app.test/api/live/x'),
      { FIRST_DO: namespace, SECOND_DO: fakeNamespace().namespace },
      fakeExecutionContext(),
      fakeNext().next,
    )

    expect(names).toEqual(['first'])
  })
})

describe('upgrade router authorisation', () => {
  it.each([401, 403, 404, 429])('returns the authoriser refusal %d verbatim', async (status) => {
    const { namespace, names } = fakeNamespace()
    const refusal = new Response(JSON.stringify({ errorCode: 'refused' }), {
      status,
      headers: { 'content-type': 'application/json' },
    })
    const router = createUpgradeRouter({
      upgrades: [liveRoute({ authorize: () => refusal })],
    })

    const response = await router(
      upgradeRequest('https://app.test/api/app/vessels/v-1/live'),
      { VESSEL_DO: namespace },
      fakeExecutionContext(),
      fakeNext().next,
    )

    expect(response).toBe(refusal)
    expect(response.status).toBe(status)
    expect(await response.text()).toBe(JSON.stringify({ errorCode: 'refused' }))
    // A refused upgrade must never have reached the object.
    expect(names).toEqual([])
  })

  // Only a Durable Object's `acceptWebSocket` may complete a handshake. An
  // authoriser answering 101 would hand a client a socket with nothing behind it.
  it('refuses an authoriser that answers 101', async () => {
    const { namespace, names } = fakeNamespace()
    const router = createUpgradeRouter({
      upgrades: [
        liveRoute({
          authorize: () =>
            new Response('accepted', { status: 200, headers: { 'x-status': '101' } }),
        }),
      ],
    })
    // `new Response(null, { status: 101 })` is refused outside workerd, which is
    // the whole reason this router exists, so the status is faked structurally.
    const fauxUpgrade = { status: 101 } as unknown as Response
    Object.setPrototypeOf(fauxUpgrade, Response.prototype)
    const routerWith101 = createUpgradeRouter({
      upgrades: [liveRoute({ authorize: () => fauxUpgrade })],
    })

    const allowed = await router(
      upgradeRequest('https://app.test/api/app/vessels/v-1/live'),
      { VESSEL_DO: namespace },
      fakeExecutionContext(),
      fakeNext().next,
    )
    expect(allowed.status).toBe(200)

    const refused = await routerWith101(
      upgradeRequest('https://app.test/api/app/vessels/v-1/live'),
      { VESSEL_DO: namespace },
      fakeExecutionContext(),
      fakeNext().next,
    )
    expect(refused.status).toBe(500)
    expect(await refused.text()).toContain('answered 101')
    expect(names).toEqual([])
  })

  it('forwards with no authoriser when allowUnauthenticated says so', async () => {
    const { namespace, names } = fakeNamespace()

    const response = await createUpgradeRouter({ upgrades: [liveRoute()] })(
      upgradeRequest('https://app.test/api/app/vessels/v-1/live'),
      { VESSEL_DO: namespace },
      fakeExecutionContext(),
      fakeNext().next,
    )

    expect(names).toEqual(['v-1'])
    expect(response.headers.get('x-fake-101')).toBe('yes')
  })

  it('gives the authoriser the matched pattern, params and object name', async () => {
    const seen: Array<Pick<UpgradeAuthorizeContext, 'objectName' | 'params' | 'path'>> = []
    const { namespace } = fakeNamespace()

    await createUpgradeRouter({
      upgrades: [
        liveRoute({
          authorize: (context) => {
            seen.push({
              objectName: context.objectName,
              params: context.params,
              path: context.path,
            })
            return { ok: true }
          },
        }),
      ],
    })(
      upgradeRequest('https://app.test/api/app/vessels/v-1/live?since=5'),
      { VESSEL_DO: namespace },
      fakeExecutionContext(),
      fakeNext().next,
    )

    expect(seen).toEqual([{ objectName: 'v-1', params: { vesselId: 'v-1' }, path: LIVE_PATH }])
  })
})

describe('upgrade router principal handling', () => {
  it('strips an inbound router-prefixed header before the authoriser and the object', async () => {
    const { namespace, forwarded } = fakeNamespace()
    const authorizerSaw: Array<string | null> = []

    await createUpgradeRouter({
      upgrades: [
        liveRoute({
          authorize: (context) => {
            authorizerSaw.push(context.request.headers.get(PRINCIPAL_HEADER))
            authorizerSaw.push(context.request.headers.get('x-narduk-anything-else'))
            return { ok: true }
          },
        }),
      ],
    })(
      upgradeRequest('https://app.test/api/app/vessels/v-1/live', {
        [PRINCIPAL_HEADER]: JSON.stringify({ role: 'admin', orgId: 'attacker' }),
        'X-Narduk-Anything-Else': 'spoofed',
      }),
      { VESSEL_DO: namespace },
      fakeExecutionContext(),
      fakeNext().next,
    )

    expect(authorizerSaw).toEqual([null, null])
    expect(forwarded[0]?.headers.get(PRINCIPAL_HEADER)).toBeNull()
    expect(forwarded[0]?.headers.get('x-narduk-anything-else')).toBeNull()
  })

  it('adds the headers the authoriser returned', async () => {
    const { namespace, forwarded } = fakeNamespace()
    const principal = JSON.stringify({ role: 'viewer', vesselId: 'v-1' })

    await createUpgradeRouter({
      upgrades: [
        liveRoute({
          authorize: () => ({ ok: true, headers: { [PRINCIPAL_HEADER]: principal } }),
        }),
      ],
    })(
      upgradeRequest('https://app.test/api/app/vessels/v-1/live', {
        [PRINCIPAL_HEADER]: 'spoofed',
      }),
      { VESSEL_DO: namespace },
      fakeExecutionContext(),
      fakeNext().next,
    )

    expect(forwarded[0]?.headers.get(PRINCIPAL_HEADER)).toBe(principal)
  })
})

describe('upgrade router forwarded request', () => {
  async function forward(route: Partial<UpgradeRoute>, headers: Record<string, string> = {}) {
    const { namespace, names, forwarded } = fakeNamespace()
    const response = await createUpgradeRouter({ upgrades: [liveRoute(route)] })(
      upgradeRequest('https://app.test/api/app/vessels/v-1/live?since=5', {
        cookie: 'nuxt-session=abc',
        authorization: 'Bearer token',
        'user-agent': 'narduk-test',
        'cf-connecting-ip': '203.0.113.9',
        ...headers,
      }),
      { VESSEL_DO: namespace },
      fakeExecutionContext(),
      fakeNext().next,
    )
    return { forwarded: forwarded[0], names, response }
  }

  it('keeps the upgrade header and the request URL', async () => {
    const { forwarded } = await forward({})

    expect(forwarded?.headers.get('upgrade')).toBe('websocket')
    expect(forwarded?.method).toBe('GET')
    expect(forwarded?.url).toBe('https://app.test/api/app/vessels/v-1/live?since=5')
  })

  it('drops credentials and the client-connection headers by default', async () => {
    const { forwarded } = await forward({})

    expect(forwarded?.headers.get('cookie')).toBeNull()
    expect(forwarded?.headers.get('authorization')).toBeNull()
    expect(forwarded?.headers.get('connection')).toBeNull()
    expect(forwarded?.headers.get('sec-websocket-key')).toBeNull()
    expect(forwarded?.headers.get('sec-websocket-version')).toBeNull()
    // Everything not on the deny list passes through untouched.
    expect(forwarded?.headers.get('user-agent')).toBe('narduk-test')
    expect(forwarded?.headers.get('cf-connecting-ip')).toBe('203.0.113.9')
  })

  it('honours forwardHeaders for a header the deny list would drop', async () => {
    const { forwarded } = await forward({ forwardHeaders: ['Cookie'] })

    expect(forwarded?.headers.get('cookie')).toBe('nuxt-session=abc')
    expect(forwarded?.headers.get('authorization')).toBeNull()
  })

  it('keeps the negotiated subprotocol', async () => {
    const { forwarded } = await forward({}, { 'sec-websocket-protocol': 'mybo.v1' })

    expect(forwarded?.headers.get('sec-websocket-protocol')).toBe('mybo.v1')
  })

  it('calls idFromName with the route parameter value', async () => {
    const { names } = await forward({})

    expect(names).toEqual(['v-1'])
  })

  it('calls idFromName with the literal for a name: idFrom', async () => {
    const { names } = await forward({ idFrom: 'name:fleet' })

    expect(names).toEqual(['fleet'])
  })
})

describe('upgrade router failures', () => {
  it('answers 500 rather than a handshake when the binding is missing', async () => {
    const response = await createUpgradeRouter({ upgrades: [liveRoute()] })(
      upgradeRequest('https://app.test/api/app/vessels/v-1/live'),
      { OTHER_DO: fakeNamespace().namespace },
      fakeExecutionContext(),
      fakeNext().next,
    )

    expect(response.status).toBe(500)
    expect(await response.text()).toContain('no Durable Object namespace bound as "VESSEL_DO"')
  })

  it.each([
    ['an absent env', undefined],
    ['a non-object binding', { VESSEL_DO: 'nope' }],
    ['a partial binding', { VESSEL_DO: { idFromName: () => 'id' } }],
  ])('answers 500 for %s', async (_case, env) => {
    const response = await createUpgradeRouter({ upgrades: [liveRoute()] })(
      upgradeRequest('https://app.test/api/app/vessels/v-1/live'),
      env,
      fakeExecutionContext(),
      fakeNext().next,
    )

    expect(response.status).toBe(500)
  })

  // The module's build-time validator rejects this, so it only reaches a
  // hand-written router configuration -- which must fail loudly at construction.
  it('refuses to build a router with an unusable path', () => {
    expect(() => createUpgradeRouter({ upgrades: [liveRoute({ path: '/api/**' })] })).toThrow(
      /wildcard/u,
    )
  })

  it('answers 500 when idFrom names a parameter the match did not produce', async () => {
    const response = await createUpgradeRouter({
      // Bypasses the validator on purpose: `absent` is not in the path.
      upgrades: [liveRoute({ idFrom: 'absent' })],
    })(
      upgradeRequest('https://app.test/api/app/vessels/v-1/live'),
      { VESSEL_DO: fakeNamespace().namespace },
      fakeExecutionContext(),
      fakeNext().next,
    )

    expect(response.status).toBe(500)
    expect(await response.text()).toContain('resolves no Durable Object name')
  })

  it('answers 500 for an empty name: literal', async () => {
    const response = await createUpgradeRouter({ upgrades: [liveRoute({ idFrom: 'name:' })] })(
      upgradeRequest('https://app.test/api/app/vessels/v-1/live'),
      { VESSEL_DO: fakeNamespace().namespace },
      fakeExecutionContext(),
      fakeNext().next,
    )

    expect(response.status).toBe(500)
  })
})

describe('authorizeViaRoute', () => {
  async function runProbe(options: {
    authorize: (context: UpgradeAuthorizeContext) => Promise<{ ok: true } | Response>
    routeResponse?: (path: string) => Response
  }) {
    const { namespace, forwarded, names } = fakeNamespace()
    const probe = fakeLocalFetch(
      options.routeResponse ??
        (() => Response.json({ role: 'viewer', vesselId: 'v-1', orgId: 'o-1' })),
    )
    const executionContext = fakeExecutionContext()

    const response = await createUpgradeRouter({
      localFetch: probe.localFetch,
      upgrades: [liveRoute({ authorize: options.authorize })],
    })(
      upgradeRequest('https://app.test/api/app/vessels/v-1/live?since=5', {
        cookie: 'nuxt-session=abc',
        [PRINCIPAL_HEADER]: 'spoofed',
      }),
      { VESSEL_DO: namespace },
      executionContext,
      fakeNext().next,
    )

    return { calls: probe.calls, executionContext, forwarded, names, response }
  }

  it('probes the upgrade path and query as a plain GET with the cookies kept', async () => {
    const { calls, names } = await runProbe({
      authorize: async (context) => {
        const result = await context.authorizeViaRoute(context.request)
        return result.ok ? { ok: true } : result.response
      },
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.path).toBe('/api/app/vessels/v-1/live?since=5')
    expect(calls[0]?.init.method).toBe('GET')
    expect(calls[0]?.init.host).toBe('app.test')
    expect(calls[0]?.init.protocol).toBe('https:')
    // The session cookie is the point of the probe: the route has to see the
    // caller exactly as it would on any request.
    expect(calls[0]?.init.headers.get('cookie')).toBe('nuxt-session=abc')
    // The handshake and the router's own prefix never reach the route.
    expect(calls[0]?.init.headers.get('upgrade')).toBeNull()
    expect(calls[0]?.init.headers.get('connection')).toBeNull()
    expect(calls[0]?.init.headers.get('sec-websocket-key')).toBeNull()
    expect(calls[0]?.init.headers.get(PRINCIPAL_HEADER)).toBeNull()
    expect(names).toEqual(['v-1'])
  })

  it('passes the Cloudflare platform context Nitro routes expect', async () => {
    const { calls, executionContext } = await runProbe({
      authorize: async (context) => {
        const result = await context.authorizeViaRoute(context.request)
        return result.ok ? { ok: true } : result.response
      },
    })

    const context = calls[0]?.init.context as {
      waitUntil: (promise: Promise<unknown>) => void
      _platform: { cloudflare: { env: unknown; request: Request; url: URL } }
    }
    expect(context._platform.cloudflare.url.pathname).toBe('/api/app/vessels/v-1/live')
    expect(Object.keys(context._platform.cloudflare.env as object)).toEqual(['VESSEL_DO'])
    // The request handed to the route is the stripped one, not the raw upgrade.
    expect(context._platform.cloudflare.request.headers.get(PRINCIPAL_HEADER)).toBeNull()

    const pending = Promise.resolve('done')
    context.waitUntil(pending)
    expect(executionContext.promises).toEqual([pending])
  })

  it.each([401, 403, 404])(
    'reports a %d as not ok so it can be returned verbatim',
    async (status) => {
      const { response, names } = await runProbe({
        authorize: async (context) => {
          const result = await context.authorizeViaRoute(context.request)
          return result.ok ? { ok: true } : result.response
        },
        routeResponse: () => new Response('refused', { status }),
      })

      expect(response.status).toBe(status)
      expect(await response.text()).toBe('refused')
      expect(names).toEqual([])
    },
  )

  it('reports a 2xx as ok and leaves the body readable', async () => {
    const bodies: unknown[] = []
    const { names } = await runProbe({
      authorize: async (context) => {
        const result = await context.authorizeViaRoute(context.request)
        if (!result.ok) return result.response
        bodies.push(await result.response.json())
        return { ok: true }
      },
    })

    expect(bodies).toEqual([{ role: 'viewer', vesselId: 'v-1', orgId: 'o-1' }])
    expect(names).toEqual(['v-1'])
  })

  it('interpolates a pattern given as the probe path', async () => {
    const { calls } = await runProbe({
      authorize: async (context) => {
        await context.authorizeViaRoute(context.request, '/api/app/vessels/:vesselId/session')
        return { ok: true }
      },
    })

    expect(calls[0]?.path).toBe('/api/app/vessels/v-1/session')
  })

  it('throws when the probe pattern names an undeclared parameter', async () => {
    await expect(
      runProbe({
        authorize: async (context) => {
          await context.authorizeViaRoute(context.request, '/api/orgs/:orgId/live')
          return { ok: true }
        },
      }),
    ).rejects.toThrow(/needs the route parameter "orgId"/u)
  })

  it('explains itself when the router was built without localFetch', async () => {
    const router = createUpgradeRouter({
      upgrades: [
        liveRoute({
          authorize: async (context) => {
            await context.authorizeViaRoute(context.request)
            return { ok: true }
          },
        }),
      ],
    })

    await expect(
      router(
        upgradeRequest('https://app.test/api/app/vessels/v-1/live'),
        { VESSEL_DO: fakeNamespace().namespace },
        fakeExecutionContext(),
        fakeNext().next,
      ),
    ).rejects.toThrow(/needs Nitro's localFetch/u)
  })
})

describe('withUpgradeRouter', () => {
  it('wraps fetch and leaves every other handler in place', async () => {
    const scheduled = vi.fn()
    const handler = {
      fetch: (request: Request, _env: unknown, _executionContext: UpgradeExecutionContext) =>
        new Response(`nitro:${new URL(request.url).pathname}`),
      scheduled,
    }
    const { namespace, names } = fakeNamespace()
    const wrapped = withUpgradeRouter(handler, createUpgradeRouter({ upgrades: [liveRoute()] }))

    const passedThrough = await wrapped.fetch(
      new Request('https://app.test/api/app/vessels/v-1/live'),
      { VESSEL_DO: namespace },
      fakeExecutionContext(),
    )
    expect(await passedThrough.text()).toBe('nitro:/api/app/vessels/v-1/live')

    const upgraded = await wrapped.fetch(
      upgradeRequest('https://app.test/api/app/vessels/v-1/live'),
      { VESSEL_DO: namespace },
      fakeExecutionContext(),
    )
    expect(upgraded.headers.get('x-fake-101')).toBe('yes')
    expect(names).toEqual(['v-1'])

    wrapped.scheduled()
    expect(scheduled).toHaveBeenCalledOnce()
    // The original handler is untouched -- the wrapper is a new object.
    expect(wrapped).not.toBe(handler)
  })
})

describe('upgrade router fail-closed construction', () => {
  // The one finding this whole option exists to close: an entry declared without
  // an authoriser forwarded every matching handshake unauthenticated, silently.
  it('refuses to build a route with neither authorize nor allowUnauthenticated', () => {
    expect(() =>
      createUpgradeRouter({
        upgrades: [{ path: LIVE_PATH, binding: 'VESSEL_DO', idFrom: 'vesselId' }],
      }),
    ).toThrow(/upgrades\[0\]\.authorize is missing for "\/api\/app\/vessels\/:vesselId\/live"/u)
  })

  it('names the failing entry by index and field', () => {
    expect(() =>
      createUpgradeRouter({
        upgrades: [liveRoute(), { path: '/api/live/:id', binding: 'OTHER_DO', idFrom: 'id' }],
      }),
    ).toThrow(/upgrades\[1\]\.authorize is missing/u)
  })

  // `false` is a decision to leave the route unchecked spelled the one way that
  // must not work: it says nothing about the object authorising the socket.
  it('refuses allowUnauthenticated: false with no authoriser', () => {
    expect(() =>
      createUpgradeRouter({
        upgrades: [
          {
            path: LIVE_PATH,
            binding: 'VESSEL_DO',
            idFrom: 'vesselId',
            allowUnauthenticated: false,
          },
        ],
      }),
    ).toThrow(/allowUnauthenticated to true/u)
  })

  it('builds a route that declares an authoriser and no flag', () => {
    expect(() =>
      createUpgradeRouter({ upgrades: [liveRoute({ authorize: () => ({ ok: true }) })] }),
    ).not.toThrow()
  })
})

describe('upgrade router method gate', () => {
  // A WebSocket handshake is a GET (RFC 6455 s4.1). Routing any other method
  // would hand the object a request the authorising GET probe never represented,
  // so a POST carrying `Upgrade: websocket` is the app's to answer.
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('hands a %s upgrade to the app', async (method) => {
    const { namespace, names } = fakeNamespace()
    const { next, requests } = fakeNext()
    const authorizerRuns: string[] = []

    const response = await createUpgradeRouter({
      upgrades: [
        liveRoute({
          authorize: () => {
            authorizerRuns.push(method)
            return { ok: true }
          },
        }),
      ],
    })(
      upgradeRequest(
        'https://app.test/api/app/vessels/v-1/live',
        {},
        { method, body: method === 'DELETE' ? undefined : '{"command":"delete-everything"}' },
      ),
      { VESSEL_DO: namespace },
      fakeExecutionContext(),
      next,
    )

    expect(response.status).toBe(404)
    expect(requests).toHaveLength(1)
    expect(requests[0]?.method).toBe(method)
    expect(names).toEqual([])
    expect(authorizerRuns).toEqual([])
  })

  it('routes the GET the probe would authorise, with the same method forwarded', async () => {
    const { namespace, forwarded } = fakeNamespace()
    const probe = fakeLocalFetch(() => new Response('ok'))

    await createUpgradeRouter({
      localFetch: probe.localFetch,
      upgrades: [
        liveRoute({
          authorize: async (context) => {
            await context.authorizeViaRoute(context.request)
            return { ok: true }
          },
        }),
      ],
    })(
      upgradeRequest('https://app.test/api/app/vessels/v-1/live'),
      { VESSEL_DO: namespace },
      fakeExecutionContext(),
      fakeNext().next,
    )

    expect(probe.calls[0]?.init.method).toBe('GET')
    expect(forwarded[0]?.method).toBe('GET')
  })
})

describe('upgrade router origin policy', () => {
  async function open(
    route: Partial<UpgradeRoute>,
    headers: Record<string, string | undefined> = {},
  ) {
    const { namespace, names, forwarded } = fakeNamespace()
    const authorizerRuns: number[] = []
    const response = await createUpgradeRouter({
      upgrades: [
        liveRoute({
          authorize: () => {
            authorizerRuns.push(1)
            return { ok: true }
          },
          ...route,
        }),
      ],
    })(
      upgradeRequest('https://app.test/api/app/vessels/v-1/live', headers),
      { VESSEL_DO: namespace },
      fakeExecutionContext(),
      fakeNext().next,
    )
    return { authorizerRuns, forwarded, names, response }
  }

  it('allows the same origin the request was addressed to', async () => {
    const { names, response } = await open({})

    expect(response.headers.get('x-fake-101')).toBe('yes')
    expect(names).toEqual(['v-1'])
  })

  // A WebSocket handshake is exempt from CORS, so this is the only thing between
  // a viewer's cookie and a socket another site opened with it.
  it.each([
    ['another site', 'https://evil.test'],
    ['the same host over http', 'http://app.test'],
    ['a subdomain', 'https://tenant.app.test'],
    ['the same host on another port', 'https://app.test:8443'],
    ['an opaque origin', 'null'],
    ['a wildcard', '*'],
  ])('refuses %s with a 403 before the authoriser', async (_case, origin) => {
    const { authorizerRuns, names, response } = await open({}, { origin })

    expect(response.status).toBe(403)
    expect(await response.text()).toContain(`Origin "${origin}" may not open a WebSocket`)
    expect(authorizerRuns).toEqual([])
    expect(names).toEqual([])
  })

  it('refuses a request that sends no Origin at all by default', async () => {
    const { authorizerRuns, names, response } = await open({}, { origin: undefined })

    expect(response.status).toBe(403)
    expect(await response.text()).toContain('must send an Origin header')
    expect(authorizerRuns).toEqual([])
    expect(names).toEqual([])
  })

  // The edge route's case: a device, not a browser, and its credential is not a
  // cookie, so there is no session for another site to ride.
  it('allows a missing Origin when allowMissingOrigin says so', async () => {
    const { names, response } = await open(
      { allowMissingOrigin: true },
      { origin: undefined, cookie: undefined },
    )

    expect(response.headers.get('x-fake-101')).toBe('yes')
    expect(names).toEqual(['v-1'])
  })

  it('allows an origin named in allowedOrigins', async () => {
    const { names } = await open(
      { allowedOrigins: ['https://console.narduk.test', 'https://app.test'] },
      { origin: 'https://console.narduk.test' },
    )

    expect(names).toEqual(['v-1'])
  })

  // Documented behaviour: the list is the policy, not an addition to it.
  it('replaces the same-origin default rather than extending it', async () => {
    const { names, response } = await open(
      { allowedOrigins: ['https://console.narduk.test'] },
      { origin: 'https://app.test' },
    )

    expect(response.status).toBe(403)
    expect(names).toEqual([])
  })

  it('compares origins case-insensitively and ignores a trailing slash', async () => {
    const { names } = await open(
      { allowedOrigins: ['HTTPS://Console.Narduk.Test/'] },
      { origin: 'https://console.narduk.test' },
    )

    expect(names).toEqual(['v-1'])
  })

  it.each([
    ['a wildcard', ['*'], /wildcard/u],
    ['a scheme-less host', ['app.example'], /not an absolute origin/u],
    ['a non-http scheme', ['ws://app.example'], /must be http or https/u],
    ['an origin with a path', ['https://app.example/live'], /scheme and host only/u],
    ['an empty list', [], /is empty/u],
  ])('refuses to build a route with %s in allowedOrigins', (_case, allowedOrigins, message) => {
    expect(() =>
      createUpgradeRouter({
        upgrades: [liveRoute({ allowedOrigins, authorize: () => ({ ok: true }) })],
      }),
    ).toThrow(message)
    expect(() =>
      createUpgradeRouter({
        upgrades: [liveRoute({ allowedOrigins, authorize: () => ({ ok: true }) })],
      }),
    ).toThrow(/upgrades\[0\]\.allowedOrigins/u)
  })
})

describe('upgrade router forwarded cf', () => {
  // `new Request(url, ...)` would drop `cf`, so an object could not read the
  // colo, country or TLS details of the connection it was handed.
  it('carries cf from the inbound request through to the object', async () => {
    const { namespace, forwarded } = fakeNamespace()
    const request = upgradeRequest('https://app.test/api/app/vessels/v-1/live')
    const cf = { colo: 'DFW', country: 'US', tlsVersion: 'TLSv1.3' }
    Object.defineProperty(request, 'cf', { configurable: true, enumerable: true, value: cf })

    await createUpgradeRouter({ upgrades: [liveRoute()] })(
      request,
      { VESSEL_DO: namespace },
      fakeExecutionContext(),
      fakeNext().next,
    )

    expect((forwarded[0] as Request & { cf?: unknown }).cf).toEqual(cf)
  })

  it('forwards a request with no cf unchanged', async () => {
    const { namespace, forwarded } = fakeNamespace()

    await createUpgradeRouter({ upgrades: [liveRoute()] })(
      upgradeRequest('https://app.test/api/app/vessels/v-1/live'),
      { VESSEL_DO: namespace },
      fakeExecutionContext(),
      fakeNext().next,
    )

    expect((forwarded[0] as Request & { cf?: unknown }).cf).toBeUndefined()
  })
})

describe('upgrade router authoriser headers', () => {
  async function withAuthorizerHeaders(headers: Record<string, string>) {
    const { namespace, names, forwarded } = fakeNamespace()
    const response = await createUpgradeRouter({
      upgrades: [liveRoute({ authorize: () => ({ ok: true, headers }) })],
    })(
      upgradeRequest('https://app.test/api/app/vessels/v-1/live', { cookie: 'nuxt-session=abc' }),
      { VESSEL_DO: namespace },
      fakeExecutionContext(),
      fakeNext().next,
    )
    return { forwarded, names, response }
  }

  // `forwardHeaders` is validated at build time so an app cannot re-add `cookie`;
  // an authoriser writing any name it liked was the same hole from the inside.
  it.each([
    ['a credential the router dropped', { cookie: 'nuxt-session=abc' }],
    ['a handshake header', { upgrade: 'h2c' }],
    ['an unrelated header', { 'x-tenant': 'other-org' }],
  ])('answers 500 for %s', async (_case, headers) => {
    const { names, response } = await withAuthorizerHeaders(headers)

    expect(response.status).toBe(500)
    expect(await response.text()).toContain(`returned the header "${Object.keys(headers)[0]}"`)
    expect(names).toEqual([])
  })

  it('accepts every name in the router prefix, whatever its case', async () => {
    const { forwarded, names } = await withAuthorizerHeaders({
      'X-Narduk-Principal': '{"role":"viewer"}',
      'x-narduk-trace': 'abc',
    })

    expect(names).toEqual(['v-1'])
    expect(forwarded[0]?.headers.get(PRINCIPAL_HEADER)).toBe('{"role":"viewer"}')
    expect(forwarded[0]?.headers.get('x-narduk-trace')).toBe('abc')
  })
})

describe('upgrade router pass-through header stripping', () => {
  // README's trust claim: an object reached through an h3 route with
  // `stub.fetch(request)` must not be handed a client-set principal either.
  it('strips the router prefix from a non-upgrade request handed to the app', async () => {
    const { next, requests } = fakeNext()

    await createUpgradeRouter({ upgrades: [liveRoute()] })(
      new Request('https://app.test/api/app/vessels/v-1/state', {
        method: 'POST',
        body: '{"speed":7}',
        headers: {
          'content-type': 'application/json',
          [PRINCIPAL_HEADER]: JSON.stringify({ role: 'admin' }),
          'X-Narduk-Anything': 'spoofed',
        },
      }),
      { VESSEL_DO: fakeNamespace().namespace },
      fakeExecutionContext(),
      next,
    )

    const passed = requests[0]
    expect(passed?.headers.get(PRINCIPAL_HEADER)).toBeNull()
    expect(passed?.headers.get('x-narduk-anything')).toBeNull()
    // Everything else about the request survives the copy.
    expect(passed?.method).toBe('POST')
    expect(passed?.url).toBe('https://app.test/api/app/vessels/v-1/state')
    expect(passed?.headers.get('content-type')).toBe('application/json')
    expect(await passed?.text()).toBe('{"speed":7}')
  })

  it('strips the router prefix from an upgrade on an undeclared path', async () => {
    const { next, requests } = fakeNext()

    await createUpgradeRouter({ upgrades: [liveRoute()] })(
      upgradeRequest('https://app.test/api/app/vessels/v-1/latest', {
        [PRINCIPAL_HEADER]: 'spoofed',
      }),
      { VESSEL_DO: fakeNamespace().namespace },
      fakeExecutionContext(),
      next,
    )

    expect(requests[0]?.headers.get(PRINCIPAL_HEADER)).toBeNull()
  })

  it('strips the router prefix from a non-GET upgrade', async () => {
    const { next, requests } = fakeNext()

    await createUpgradeRouter({ upgrades: [liveRoute()] })(
      upgradeRequest(
        'https://app.test/api/app/vessels/v-1/live',
        { [PRINCIPAL_HEADER]: 'spoofed' },
        { method: 'POST', body: '{}' },
      ),
      { VESSEL_DO: fakeNamespace().namespace },
      fakeExecutionContext(),
      next,
    )

    expect(requests[0]?.headers.get(PRINCIPAL_HEADER)).toBeNull()
  })

  // Every ordinary request the Worker serves takes this path, so it must not pay
  // for a copy it does not need.
  it('passes the very same request through when there is nothing to strip', async () => {
    const { next, requests } = fakeNext()
    const request = new Request('https://app.test/api/app/vessels/v-1/state')

    await createUpgradeRouter({ upgrades: [liveRoute()] })(
      request,
      { VESSEL_DO: fakeNamespace().namespace },
      fakeExecutionContext(),
      next,
    )

    expect(requests[0]).toBe(request)
  })
})

describe('authorizeViaRoute path safety', () => {
  async function probeWith(routePath: string, url = 'https://app.test/api/app/vessels/v-1/live') {
    const probe = fakeLocalFetch(() => new Response('ok'))
    return createUpgradeRouter({
      localFetch: probe.localFetch,
      upgrades: [
        liveRoute({
          authorize: async (context) => {
            await context.authorizeViaRoute(context.request, routePath)
            return { ok: true }
          },
        }),
      ],
    })(
      upgradeRequest(url),
      { VESSEL_DO: fakeNamespace().namespace },
      fakeExecutionContext(),
      fakeNext().next,
    )
  }

  // `localFetch` routes on whatever string it is given, so an absolute URL is a
  // different host's route and `..` is a route the upgrade never named.
  it.each([
    ['an absolute URL', 'https://tenant-b.example/api/session', /needs a path starting with "\/"/u],
    ['a relative path', 'api/session', /needs a path starting with "\/"/u],
    ['a traversal segment', '/api/app/../admin/session', /has a "\.\." segment/u],
    ['a bare dot segment', '/api/app/./session', /has a "\." segment/u],
  ])('refuses %s as a probe path', async (_case, routePath, message) => {
    await expect(probeWith(routePath)).rejects.toThrow(message)
  })

  // A `%2F` survives URL normalisation (a `%2E%2E` does not), so this is the one
  // parameter value that really can carry a path into the probe -- and
  // `encodeURIComponent` would escape the slash but leave the `..` beside it.
  it('refuses to interpolate a parameter that is not a single path segment', async () => {
    await expect(
      probeWith(
        '/api/app/vessels/:vesselId/session',
        'https://app.test/api/app/vessels/v-1%2F..%2Fadmin/live',
      ),
    ).rejects.toThrow(/would interpolate ":vesselId" as "v-1\/\.\.\/admin"/u)
  })

  it('still interpolates an ordinary parameter', async () => {
    await expect(probeWith('/api/app/vessels/:vesselId/session')).resolves.toBeInstanceOf(Response)
  })
})
