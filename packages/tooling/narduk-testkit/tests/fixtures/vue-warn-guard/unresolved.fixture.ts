import { renderToString } from 'vue/server-renderer'
import { createSSRApp, h, resolveComponent } from 'vue'
import { describe, expect, it } from 'vitest'

import { allowVueWarning } from '../../../src/vue-warn-guard'

const unresolved = () =>
  renderToString(createSSRApp({ render: () => h(resolveComponent('Nope') as never) }))

describe('guard fixture', () => {
  it('warns without allowing it', async () => {
    expect(await unresolved()).toContain('Nope')
  })

  it('is clean', () => {
    expect(1).toBe(1)
  })

  it('allows the warning for this test only', async () => {
    allowVueWarning(
      /Failed to resolve component: Nope/,
      'this test provokes the warning on purpose',
    )
    expect(await unresolved()).toContain('Nope')
  })

  it('does not inherit the previous test allowance', async () => {
    expect(await unresolved()).toContain('Nope')
  })
})
