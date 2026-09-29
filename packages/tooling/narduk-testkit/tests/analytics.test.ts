import { describe, expect, it } from 'vitest'
import { assertAnalyticsJourney } from '../src/analytics'

describe('analytics consumer journey contract', () => {
  const actual = [
    { event: '$pageview', properties: { route: '/signup' } },
    { event: 'form_submitted', properties: { form_id: 'signup' } },
    { event: 'form_succeeded', properties: { form_id: 'signup' } },
  ]
  it('accepts ordered events with a subset of properties', () => {
    expect(() =>
      assertAnalyticsJourney(actual, [
        { event: '$pageview', properties: { route: '/signup' }, count: 1 },
        { event: 'form_succeeded', properties: { form_id: 'signup' } },
      ]),
    ).not.toThrow()
  })
  it('rejects missing, reordered and duplicated steps', () => {
    expect(() => assertAnalyticsJourney(actual, [{ event: 'form_failed' }])).toThrow('Missing')
    expect(() =>
      assertAnalyticsJourney(actual, [{ event: 'form_succeeded' }, { event: 'form_submitted' }]),
    ).toThrow('Missing')
    expect(() =>
      assertAnalyticsJourney([...actual, actual[0]!], [{ event: '$pageview', count: 1 }]),
    ).toThrow('count')
  })
})
