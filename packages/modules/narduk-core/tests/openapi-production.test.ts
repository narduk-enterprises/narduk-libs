import { describe, expect, it } from 'vitest'

import { resolveOpenApiProductionMode } from '../src/openapi-production'

describe('resolveOpenApiProductionMode', () => {
  it('serves no spec when NUXT_OPENAPI_PRODUCTION is unset', () => {
    expect(resolveOpenApiProductionMode(undefined)).toBe(false)
  })

  it.each([
    ['false', false],
    ['disabled', false],
    ['runtime', 'runtime'],
    ['prerender', 'prerender'],
    ['true', 'prerender'],
  ] as const)('maps %s to %s', (value, mode) => {
    expect(resolveOpenApiProductionMode(value)).toBe(mode)
  })

  it('serves no spec on an unrecognised value rather than publishing the route', () => {
    expect(resolveOpenApiProductionMode('')).toBe(false)
    expect(resolveOpenApiProductionMode('Runtime')).toBe(false)
  })
})
