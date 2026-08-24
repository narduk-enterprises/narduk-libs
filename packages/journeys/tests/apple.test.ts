import { describe, expect, it } from 'vitest'

import { appleMarker, parseAppleMarkers, verifyAppleSequence } from '../src/apple.js'
import { appleJourney } from './helpers.js'

describe('apple binding', () => {
  it('builds and parses versioned markers', () => {
    expect(appleMarker('scan-to-ticket', 'open-scan')).toBe('njr1:scan-to-ticket:open-scan')
    expect(parseAppleMarkers(['noise', 'njr1:scan-to-ticket:open-scan'])).toEqual([
      { journeyId: 'scan-to-ticket', stepId: 'open-scan' },
    ])
  })

  it('treats a malformed njr-prefixed marker as an error, never as noise', () => {
    expect(() => parseAppleMarkers(['njr1:BAD_CASE'])).toThrow(/malformed journey marker/)
  })

  it('passes an exact executed sequence', () => {
    const journey = appleJourney()
    const titles = ['njr1:scan-to-ticket:open-scan', 'njr1:scan-to-ticket:resolve']
    expect(verifyAppleSequence(journey, 'base', titles)).toEqual([])
  })

  it('fails a missing, reordered, or foreign step', () => {
    const journey = appleJourney()
    expect(verifyAppleSequence(journey, 'base', ['njr1:scan-to-ticket:resolve'])).toEqual([
      expect.stringContaining('does not equal declared'),
    ])
    expect(
      verifyAppleSequence(journey, 'base', [
        'njr1:other-journey:open-scan',
        'njr1:scan-to-ticket:open-scan',
        'njr1:scan-to-ticket:resolve',
      ]),
    ).toEqual([expect.stringContaining('foreign journey')])
  })
})
