// @vitest-environment happy-dom
/*
 * useReducedMotion(): false until mounted, then the live
 * `prefers-reduced-motion` setting. happy-dom's matchMedia is replaced with a
 * controllable one, as the setting itself cannot be flipped from a test.
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'

import {
  NE_REDUCED_MOTION_QUERY,
  useReducedMotion,
} from '../src/runtime/composables/use-reduced-motion'

import type { Ref } from 'vue'

function installMatchMedia(initial: boolean) {
  const listeners = new Set<() => void>()
  const query = {
    matches: initial,
    addEventListener: vi.fn((_type: string, listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: () => void) => listeners.delete(listener)),
  }
  const matchMedia = vi.fn(() => query)
  vi.stubGlobal('matchMedia', matchMedia)
  window.matchMedia = matchMedia as unknown as typeof window.matchMedia
  return {
    listeners,
    matchMedia,
    query,
    set(next: boolean) {
      query.matches = next
      for (const listener of listeners) listener()
    },
  }
}

function mountProbe() {
  let reduced!: Readonly<Ref<boolean>>
  let seenAtSetup: boolean | undefined
  const wrapper = mount(
    defineComponent({
      setup() {
        reduced = useReducedMotion()
        seenAtSetup = reduced.value
        return () => h('div')
      },
    }),
  )
  return { reduced, seenAtSetup, wrapper }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useReducedMotion', () => {
  it('asks for the reduce query', async () => {
    const media = installMatchMedia(false)
    mountProbe()
    expect(media.matchMedia).toHaveBeenCalledWith(NE_REDUCED_MOTION_QUERY)
    expect(NE_REDUCED_MOTION_QUERY).toBe('(prefers-reduced-motion: reduce)')
  })

  it('is false through setup, then reads the setting once mounted', async () => {
    installMatchMedia(true)
    const { reduced, seenAtSetup } = mountProbe()
    expect(seenAtSetup).toBe(false)
    await nextTick()
    expect(reduced.value).toBe(true)
  })

  it('follows the setting while mounted and stops listening on unmount', async () => {
    const media = installMatchMedia(false)
    const { reduced, wrapper } = mountProbe()
    await nextTick()
    expect(reduced.value).toBe(false)

    media.set(true)
    expect(reduced.value).toBe(true)
    media.set(false)
    expect(reduced.value).toBe(false)

    wrapper.unmount()
    expect(media.listeners.size).toBe(0)
  })

  it('reads once and does not subscribe outside a component', () => {
    const media = installMatchMedia(true)
    const reduced = useReducedMotion()
    expect(reduced.value).toBe(true)
    expect(media.query.addEventListener).not.toHaveBeenCalled()
  })

  it('is false when the browser has no matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined)
    const saved = window.matchMedia
    // @ts-expect-error -- the absent-API case
    window.matchMedia = undefined
    try {
      expect(useReducedMotion().value).toBe(false)
    } finally {
      window.matchMedia = saved
    }
  })
})
