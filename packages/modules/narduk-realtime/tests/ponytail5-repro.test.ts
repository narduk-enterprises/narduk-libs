import { describe, expect, it } from 'vitest'

import { createUpgradeRouter } from '../src/worker/upgrade-router.js'
import type { UpgradeRoute } from '../src/worker/upgrade-router.js'

import {
  fakeExecutionContext,
  fakeNamespace,
  fakeNext,
  upgradeRequest,
} from './support/upgrade-fakes.js'

function route(overrides: Partial<UpgradeRoute>): UpgradeRoute {
  return {
    path: '/api/app/vessels/:vesselId/live',
    binding: 'VESSEL_DO',
    idFrom: 'vesselId',
    ...overrides,
  }
}

describe('ponytail-5 #6 authorizer verdict that is not a Response', () => {
  it.each([
    ['{ ok: false }', { ok: false }],
    [
      'ok:false with a Response-shaped field',
      { ok: false, response: new Response('nope', { status: 401 }) },
    ],
    [
      'ok:false with a principal header',
      { ok: false, headers: { 'x-narduk-principal': '{"role":"admin"}' } },
    ],
  ])('does not open the socket for %s', async (_name, verdict) => {
    const { namespace, names, forwarded } = fakeNamespace()
    const router = createUpgradeRouter({
      upgrades: [route({ authorize: (() => verdict) as never })],
    })
    const response = await router(
      upgradeRequest('https://app.test/api/app/vessels/v-1/live'),
      { VESSEL_DO: namespace },
      fakeExecutionContext(),
      fakeNext().next,
    )
    expect({ status: response.status, names, forwarded: forwarded.length }).toEqual({
      status: 500,
      names: [],
      forwarded: 0,
    })
  })
})

describe('ponytail-5 #13 percent-encoded static segment', () => {
  it('an encoded spelling of a literal route does not reach a later :param route', async () => {
    const { namespace, names } = fakeNamespace()
    const router = createUpgradeRouter({
      upgrades: [
        route({
          path: '/api/admin/live',
          binding: 'ADMIN_DO',
          // A valid literal name: the route never matched before the fix, so
          // an unset idFrom hid behind it.
          idFrom: 'name:admin-room',
          authorize: () => new Response('denied', { status: 401 }),
        }),
        route({ path: '/api/:id/live', idFrom: 'id', allowUnauthenticated: true }),
      ],
    } as never)
    const response = await router(
      upgradeRequest('https://app.test/api/%61dmin/live'),
      { VESSEL_DO: namespace, ADMIN_DO: namespace },
      fakeExecutionContext(),
      fakeNext().next,
    )
    // Literal /api/admin/live is a 401; the encoded spelling must not be a way
    // to get the weaker route to open a socket for id "admin".
    expect(names).toEqual([])
    expect(response.status).not.toBe(200)
  })
})
