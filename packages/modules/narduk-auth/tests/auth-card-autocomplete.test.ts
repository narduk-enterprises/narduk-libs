import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * `@nuxt/ui@4.6.0`'s `Input.vue` defaults `autocomplete` to `"off"` when the
 * consumer doesn't set one explicitly. `AuthLoginCard` and `AuthRegisterCard`
 * never overrode it, so every credential field shipped `autocomplete="off"`
 * and blocked password managers from filling or saving credentials
 * (narduk-libs#60). Pin the explicit tokens per field so a future edit can't
 * silently drop back to the `@nuxt/ui` default.
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const componentsDir = join(__dirname, '..', 'app', 'components', 'auth')

function readComponent(name: string): string {
  return readFileSync(join(componentsDir, name), 'utf-8')
}

/** Extract the `<UInput ... />` block whose `v-model` targets `field`. */
function inputBlockFor(source: string, field: string): string {
  const pattern = new RegExp(`<UInput\\b[^>]*v-model="${field}"[^>]*/>`, 's')
  const match = source.match(pattern)
  if (!match) throw new Error(`No <UInput v-model="${field}"> found`)
  return match[0]
}

describe('auth card credential field autocomplete', () => {
  it('AuthLoginCard sets autocomplete=email on the email field', () => {
    const block = inputBlockFor(readComponent('AuthLoginCard.vue'), 'state.email')
    expect(block).toContain('autocomplete="email"')
  })

  it('AuthLoginCard sets autocomplete=current-password on the password field', () => {
    const block = inputBlockFor(readComponent('AuthLoginCard.vue'), 'state.password')
    expect(block).toContain('autocomplete="current-password"')
  })

  it('AuthRegisterCard sets autocomplete=name on the name field', () => {
    const block = inputBlockFor(readComponent('AuthRegisterCard.vue'), 'state.name')
    expect(block).toContain('autocomplete="name"')
  })

  it('AuthRegisterCard sets autocomplete=email on the email field', () => {
    const block = inputBlockFor(readComponent('AuthRegisterCard.vue'), 'state.email')
    expect(block).toContain('autocomplete="email"')
  })

  it('AuthRegisterCard sets autocomplete=new-password on the password field', () => {
    const block = inputBlockFor(readComponent('AuthRegisterCard.vue'), 'state.password')
    expect(block).toContain('autocomplete="new-password"')
  })
})
