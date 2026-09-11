import { describe, expect, it } from 'vitest'

import { defineStatusMap } from '../src/runtime/utils/status-map'

type FloodStage = 'normal' | 'action' | 'major'

describe('defineStatusMap', () => {
  const flood = defineStatusMap<FloodStage>({
    normal: ['ok', 'Normal'],
    action: ['warn', 'Action'],
    major: ['error', 'Major'],
  })

  it('resolves a mapped key to its tone and label', () => {
    expect(flood('action')).toEqual({ tone: 'warn', label: 'Action' })
    expect(flood('normal')).toEqual({ tone: 'ok', label: 'Normal' })
    expect(flood('major')).toEqual({ tone: 'error', label: 'Major' })
  })

  it('falls back to neutral with the raw key as the label for an unmapped runtime value', () => {
    // An API can hand back a stage this app's union does not (yet, or no
    // longer) know about. The cast stands in for that: TypeScript's
    // exhaustiveness check (below) only covers what the union promises, not
    // what actually arrives over the wire.
    const unprecedented = 'unprecedented' as FloodStage
    expect(flood(unprecedented)).toEqual({ tone: 'neutral', label: 'unprecedented' })
  })

  // This test's entire point is the compile-time @ts-expect-error below; TypeScript itself fails
  // the build if that assertion goes stale, so a runtime expect() would only assert the language
  // server ran, not anything about this module.
  // eslint-disable-next-line vitest/expect-expect -- see comment above
  it('rejects a map missing one of the union keys, at compile time', () => {
    // @ts-expect-error -- 'major' is missing from the map; a partial map must be a type error.
    defineStatusMap<FloodStage>({ normal: ['ok', 'Normal'], action: ['warn', 'Action'] })
  })
})
