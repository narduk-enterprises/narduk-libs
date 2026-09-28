import { describe, expect, it } from 'vitest'

import { resolveOpenApiProductionMode } from '../src/openapi-production'

describe('resolveOpenApiProductionMode', () => {
  it('prerenders the spec when NUXT_OPENAPI_PRODUCTION is unset', () => {
    expect(resolveOpenApiProductionMode(undefined)).toBe('prerender')
  })

  it.each([
    ['false', false],
    ['disabled', false],
    ['runtime', 'runtime'],
    ['prerender', 'prerender'],
  ] as const)('maps %s to %s', (value, mode) => {
    expect(resolveOpenApiProductionMode(value)).toBe(mode)
  })

  it('prerenders on an unrecognised value rather than dropping the route', () => {
    expect(resolveOpenApiProductionMode('')).toBe('prerender')
    expect(resolveOpenApiProductionMode('Runtime')).toBe('prerender')
  })
})
