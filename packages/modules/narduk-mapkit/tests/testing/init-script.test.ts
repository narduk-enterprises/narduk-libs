// @vitest-environment happy-dom
/**
 * The Playwright bridge, proven rather than assumed.
 *
 * `fakeMapKitInitScript()` serialises the whole fake with
 * `Function.prototype.toString()`. That only works while the runtime stays one
 * self-contained function whose sole imports are type-only -- the day someone
 * adds a real import, or a module-scope constant, or a helper defined outside
 * the function, the string still *looks* fine and Playwright silently gets a
 * broken fake. So this test evaluates the generated source in an isolated realm
 * (`new Function` with `globalThis` shadowed by a bare object) and drives the
 * resulting namespace end to end. A missing free variable is a ReferenceError
 * here, at `pnpm test`, instead of a mystery in a browser run.
 */
import { describe, expect, it } from 'vitest'

import { fakeMapKitInitScript, isFakeMapKitNotImplemented } from '../../src/testing/index.js'
import type { FakeMapKitOptions, FakeMapKitRuntime } from '../../src/testing/index.js'

/**
 * Evaluate the init script the way a browser would: a fresh realm-ish object
 * standing in for `window`, carrying only the DOM globals a real page has.
 */
function evaluateInitScript(options: FakeMapKitOptions = {}): Record<string, unknown> {
  const realm: Record<string, unknown> = {
    DOMPoint: (globalThis as { DOMPoint?: unknown }).DOMPoint,
    document: globalThis.document,
  }
  // Evaluating the generated source IS the assertion.
  const run = new Function('globalThis', fakeMapKitInitScript(options)) as (
    scope: Record<string, unknown>,
  ) => void
  run(realm)
  return realm
}

function runtimeOf(realm: Record<string, unknown>): FakeMapKitRuntime {
  return realm['__fakeMapKit'] as FakeMapKitRuntime
}

describe('fakeMapKitInitScript', () => {
  it('is standalone JavaScript: no imports, no require, no module scope', () => {
    const source = fakeMapKitInitScript()
    expect(source).not.toMatch(/\brequire\s*\(/)
    expect(source).not.toMatch(/^\s*import[\s{*]/m)
    expect(source).not.toMatch(/\bexports\b/)
    // The options are baked in as JSON, so the script needs no argument.
    expect(fakeMapKitInitScript({ language: 'fr' })).toContain('"language":"fr"')
  })

  it('publishes window.mapkit and window.__fakeMapKit when evaluated', () => {
    const realm = evaluateInitScript()
    expect(realm['mapkit']).toBeDefined()
    expect(realm['__fakeMapKit']).toBeDefined()
    expect(runtimeOf(realm).mapkit).toBe(realm['mapkit'])
  })

  it('initializes, builds a map and records annotations from the serialized source', () => {
    const realm = evaluateInitScript({ auth: { mode: 'accept' } })
    const runtime = runtimeOf(realm)

    runtime.mapkit.init({
      authorizationCallback: (done) => {
        done('serialized.token')
      },
    })
    expect(runtime.inspect.configurationChanges).toEqual(['Initialized'])
    expect(runtime.inspect.tokens).toEqual(['serialized.token'])

    const host = globalThis.document.createElement('div')
    globalThis.document.body.append(host)
    const map = new runtime.mapkit.Map(host)
    const pin = new runtime.mapkit.MarkerAnnotation(new runtime.mapkit.Coordinate(30, -88), {
      title: 'Buoy',
    })
    map.addAnnotation(pin)

    expect(map.annotations).toHaveLength(1)
    expect(runtime.inspect.annotationsAdded).toBe(1)
    expect(runtime.inspect.annotationCounts(pin).added).toBe(1)
  })

  it('keeps the fidelity rule across the realm boundary', () => {
    const runtime = runtimeOf(evaluateInitScript())
    let caught: unknown
    try {
      ;(runtime.mapkit as unknown as Record<string, unknown>)['Polyline']
    } catch (error) {
      caught = error
    }
    // `instanceof` cannot work here -- the error class lives in the evaluated
    // source, not in this module -- which is exactly why the package exports a
    // structural predicate instead.
    expect(caught).toBeInstanceOf(Error)
    expect(isFakeMapKitNotImplemented(caught)).toBe(true)
    expect((caught as Error).message).toBe('FakeMapKitNotImplemented: mapkit.Polyline')
  })

  it('honours the baked-in options', () => {
    const runtime = runtimeOf(evaluateInitScript({ libraries: ['annotations'], language: 'fr' }))
    // A missing library is modelled, so it gets Apple's own message rather than
    // the not-implemented error.
    expect(() => runtime.mapkit.Map).toThrow(
      '[MapKit] mapkit.Map is available after loading the following library: map.',
    )
    expect(runtime.mapkit.language).toBe('fr')
  })

  it('produces an independent fake per evaluation', () => {
    const first = runtimeOf(evaluateInitScript())
    const second = runtimeOf(evaluateInitScript())
    first.mapkit.init({ authorizationCallback: (done) => done('first.token') })
    expect(first.inspect.tokens).toHaveLength(1)
    expect(second.inspect.tokens).toHaveLength(0)
  })
})
