// @vitest-environment happy-dom
import { createSSRApp, defineComponent, h, nextTick, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createPreferencesState } from '../runtime/app/utils/preferencesState'
import {
  encodePreferencesCookie,
  resolvePreferenceDefaults,
} from '../runtime/shared/utils/preferences'
import { createFormatters } from '../runtime/shared/utils/units'

import type { PreferencesStateBindings } from '../runtime/app/utils/preferencesState'
import type { NePreferences } from '../runtime/shared/utils/preferences'
import type { Ref } from 'vue'

/**
 * The hydration proof (narduk-libs#386).
 *
 * The claim under test is not "the strings look the same to me" but the one
 * Vue itself makes: server markup handed to a real client hydrate produces no
 * mismatch. So each case renders the component with `renderToString`, puts that
 * exact HTML into a container, hydrates it with `createSSRApp().mount()`, and
 * fails if Vue warns. The last case is the control: it reproduces the naive
 * implementation — the client re-deriving its defaults instead of reading the
 * server's — and requires the warning to appear, so a passing suite is not just
 * a suite that never looks.
 */

const SWELL_METRES = 1.4
const OBSERVED_AT = '2026-03-08T08:30:00Z'

/** A component that renders one measurement and one timestamp through the store. */
function preferenceComponent(bindings: PreferencesStateBindings) {
  return defineComponent({
    setup() {
      const state = createPreferencesState(bindings)
      const format = createFormatters(() => state.preferences.value)
      return () =>
        h('p', {}, `${format.height(SWELL_METRES)} at ${format.dateTime(OBSERVED_AT)}`)
    },
  })
}

interface HydrationResult {
  /** Vue's warnings during hydration, if any. */
  warnings: string[]
  /** What the browser shows once the app has mounted and settled. */
  mountedHtml: string
  /** What the server sent. */
  serverHtml: string
}

/**
 * Render on the "server", hydrate the result on the "client", and report both
 * the markup and anything Vue complained about.
 *
 * `serverBindings` and `clientBindings` are separate on purpose: the two sides
 * of a real request have separate refs, and the only things that legitimately
 * cross between them are the cookie (sent with the request) and the `useState`
 * payload.
 */
async function hydrate(
  serverBindings: PreferencesStateBindings,
  clientBindings: PreferencesStateBindings,
): Promise<HydrationResult> {
  const serverHtml = await renderToString(createSSRApp(preferenceComponent(serverBindings)))

  const warnings: string[] = []
  const capture = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '))
  }
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(capture)
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(capture)

  const container = document.createElement('div')
  container.innerHTML = serverHtml
  document.body.append(container)

  try {
    createSSRApp(preferenceComponent(clientBindings)).mount(container)
    await nextTick()
    await nextTick()
  } finally {
    warnSpy.mockRestore()
    errorSpy.mockRestore()
    container.remove()
  }

  return {
    mountedHtml: container.innerHTML,
    serverHtml,
    warnings: warnings.filter((entry) => /hydrat/i.test(entry)),
  }
}

/** The payload round-trip: the client sees the server's value, serialised. */
function throughPayload(defaults: NePreferences): Ref<NePreferences> {
  return ref(JSON.parse(JSON.stringify(defaults)) as NePreferences)
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('first render matches between server and client', () => {
  it('renders UTC and the request default units on both sides when no cookie exists', async () => {
    const defaults = resolvePreferenceDefaults({ acceptLanguage: 'en-US,en;q=0.9' })
    const cookie = ref<string | null>(null)

    const result = await hydrate(
      { cookie: ref<string | null>(null), defaults: ref(defaults) },
      { cookie, defaults: throughPayload(defaults) },
    )

    // en-US -> imperial; no cookie -> UTC, not the machine running this test.
    expect(result.serverHtml).toContain('4.6 ft')
    expect(result.serverHtml).toContain('8:30 AM')
    expect(result.warnings).toEqual([])
  })

  it('renders the cookie value on both sides, so there is no flash of the wrong unit', async () => {
    const defaults = resolvePreferenceDefaults({ acceptLanguage: 'en-US' })
    const value = encodePreferencesCookie({
      locale: 'de-DE',
      timeZone: 'Europe/Berlin',
      units: 'metric',
    })

    const result = await hydrate(
      { cookie: ref<string | null>(value), defaults: ref(defaults) },
      { cookie: ref<string | null>(value), defaults: throughPayload(defaults) },
    )

    expect(result.serverHtml).toContain('1,4 m')
    expect(result.serverHtml).toContain('09:30')
    expect(result.warnings).toEqual([])
    // Nothing moved after mount: the cookie already said everything.
    expect(result.mountedHtml).toBe(result.serverHtml)
  })

  it('adopts the browser time zone after mount instead of guessing it during render', async () => {
    const defaults = resolvePreferenceDefaults({ acceptLanguage: 'en-US' })
    const cookie = ref<string | null>(null)

    const result = await hydrate(
      { cookie: ref<string | null>(null), defaults: ref(defaults) },
      {
        cookie,
        defaults: throughPayload(defaults),
        detectTimeZone: () => 'America/Chicago',
      },
    )

    expect(result.warnings).toEqual([])
    // Hydrated as UTC, exactly like the server...
    expect(result.serverHtml).toContain('8:30 AM')
    // ...then corrected, as an ordinary reactive update on a mounted page.
    expect(result.mountedHtml).toContain('3:30 AM')
    expect(cookie.value).toContain('tz=America%2FChicago')
  })

  it('leaves a reader-chosen zone alone after mount', async () => {
    const defaults = resolvePreferenceDefaults({ acceptLanguage: 'en-US' })
    const value = encodePreferencesCookie({ timeZone: 'Asia/Tokyo' })
    const cookie = ref<string | null>(value)

    const result = await hydrate(
      { cookie: ref<string | null>(value), defaults: ref(defaults) },
      { cookie, defaults: throughPayload(defaults), detectTimeZone: () => 'America/Chicago' },
    )

    expect(result.warnings).toEqual([])
    expect(result.mountedHtml).toContain('5:30 PM')
    expect(cookie.value).toBe(value)
  })

  it('CONTROL: a client that re-derives its own defaults does fail hydration', async () => {
    // This is the implementation the payload-carried defaults exist to prevent:
    // the server resolves `Accept-Language`, the browser answers with its own
    // idea of locale and zone, and the two renders disagree. If this case ever
    // stops warning, the cases above have stopped proving anything.
    const result = await hydrate(
      { cookie: ref<string | null>(null), defaults: ref(resolvePreferenceDefaults()) },
      {
        cookie: ref<string | null>(null),
        defaults: ref<NePreferences>({
          locale: 'de-DE',
          timeZone: 'Europe/Berlin',
          units: 'metric',
        }),
      },
    )

    expect(result.warnings.length).toBeGreaterThan(0)
  })
})

describe('setters', () => {
  function state(cookie: Ref<string | null>) {
    return createPreferencesState({
      cookie,
      defaults: ref(resolvePreferenceDefaults({ acceptLanguage: 'en-GB' })),
    })
  }

  it('merges into the existing selection rather than replacing it', () => {
    const cookie = ref<string | null>(null)
    const preferences = state(cookie)

    preferences.setTimeZone('America/Chicago')
    preferences.setUnits('imperial')

    expect(preferences.preferences.value).toEqual({
      locale: 'en-GB',
      timeZone: 'America/Chicago',
      units: 'imperial',
    })
  })

  it('ignores a value the cookie could never carry rather than throwing', () => {
    const cookie = ref<string | null>(null)
    const preferences = state(cookie)

    preferences.setUnits('Imperial' as never)
    preferences.setTimeZone('Nowhere/Nothing')
    preferences.setLocale('not!a!tag')

    expect(cookie.value).toBeNull()
    expect(preferences.units.value).toBe('metric')
    expect(preferences.timeZone.value).toBe('UTC')
    expect(preferences.locale.value).toBe('en-GB')
  })

  it('reset falls back to the request-derived defaults', () => {
    const cookie = ref<string | null>(null)
    const preferences = state(cookie)

    preferences.setUnits('imperial')
    expect(preferences.units.value).toBe('imperial')

    preferences.reset()
    expect(cookie.value).toBeNull()
    expect(preferences.units.value).toBe('metric')
  })
})
