/*
 * useReducedMotion() on the server: no window, so `false`, and nothing throws.
 * Runs in the default node environment on purpose.
 */
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'

import { useReducedMotion } from '../src/runtime/composables/use-reduced-motion'

describe('useReducedMotion (server)', () => {
  it('is false with no window', () => {
    expect(typeof window).toBe('undefined')
    expect(useReducedMotion().value).toBe(false)
  })

  it('renders the not-reduced branch during SSR', async () => {
    const app = createSSRApp(
      defineComponent({
        setup() {
          const reduced = useReducedMotion()
          return () => h('p', { 'data-reduced': String(reduced.value) })
        },
      }),
    )
    expect(await renderToString(app)).toBe('<p data-reduced="false"></p>')
  })
})
