import { describe, expect, it } from 'vitest'

import { matchUpgradePath, parseUpgradePath } from '../src/worker/upgrade-path.js'

function segmentsOf(pattern: string) {
  const parsed = parseUpgradePath(pattern)
  if (!parsed.ok) throw new Error(`${pattern} did not parse: ${parsed.reason}`)
  return parsed
}

describe('parseUpgradePath', () => {
  it('compiles literal segments and parameters, reporting the parameter names', () => {
    expect(parseUpgradePath('/api/app/vessels/:vesselId/live')).toEqual({
      ok: true,
      params: ['vesselId'],
      segments: [
        { kind: 'static', value: 'api' },
        { kind: 'static', value: 'app' },
        { kind: 'static', value: 'vessels' },
        { kind: 'param', name: 'vesselId' },
        { kind: 'static', value: 'live' },
      ],
    })
  })

  // An upgrade is a long-lived authenticated socket. A pattern matching paths
  // nobody enumerated is how one ends up reachable without a guard, so the
  // wildcard is refused rather than quietly supported.
  it.each(['/api/**', '/api/*/live', '/api/:id/**'])(
    'rejects the wildcard pattern %s',
    (pattern) => {
      expect(parseUpgradePath(pattern)).toEqual({
        ok: false,
        reason: expect.stringContaining('wildcard'),
      })
    },
  )

  it.each([
    ['relative', 'api/live', 'must be a path starting with "/"'],
    ['root', '/', 'is the root path'],
    ['double slash', '/api//live', 'empty path segment'],
    ['bad parameter', '/api/:1id', 'invalid route parameter ":1id"'],
    ['repeated parameter', '/api/:id/x/:id', 'declares the route parameter ":id" twice'],
  ])('rejects a %s pattern', (_case, pattern, reason) => {
    const parsed = parseUpgradePath(pattern)
    expect(parsed.ok).toBe(false)
    expect(parsed.ok ? '' : parsed.reason).toContain(reason)
  })

  it('rejects a non-string pattern without throwing', () => {
    expect(parseUpgradePath(undefined as unknown as string).ok).toBe(false)
  })
})

describe('matchUpgradePath', () => {
  const live = segmentsOf('/api/app/vessels/:vesselId/live')

  it('extracts the parameter for a matching path', () => {
    expect(matchUpgradePath(live.segments, '/api/app/vessels/v-1/live')).toEqual({
      vesselId: 'v-1',
    })
  })

  it('percent-decodes a parameter the way getRouterParam does', () => {
    expect(matchUpgradePath(live.segments, '/api/app/vessels/v%201/live')).toEqual({
      vesselId: 'v 1',
    })
  })

  it('tolerates one trailing slash', () => {
    expect(matchUpgradePath(live.segments, '/api/app/vessels/v-1/live/')).toEqual({
      vesselId: 'v-1',
    })
  })

  it.each([
    ['a different literal', '/api/app/vessels/v-1/latest'],
    ['a shorter path', '/api/app/vessels/v-1'],
    ['a longer path', '/api/app/vessels/v-1/live/extra'],
    ['an empty parameter', '/api/app/vessels//live'],
    // A `%` that cannot be decoded must not reach `idFromName` half-parsed.
    ['an undecodable parameter', '/api/app/vessels/v%zz/live'],
  ])('does not match %s', (_case, pathname) => {
    expect(matchUpgradePath(live.segments, pathname)).toBeUndefined()
  })

  it('matches a parameterless pattern exactly', () => {
    const session = segmentsOf('/api/edge/v1/session')
    expect(matchUpgradePath(session.segments, '/api/edge/v1/session')).toEqual({})
    expect(matchUpgradePath(session.segments, '/api/edge/v1/Session')).toBeUndefined()
  })
})
