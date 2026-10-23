import { describe, expect, it, vi } from 'vitest'

import { normalizeDemoRedirectPath } from '../runtime/server/utils/demo'

vi.mock('#narduk-core/schema', () => ({ users: {} }))
vi.mock('../runtime/server/utils/database', () => ({ useDatabase: vi.fn() }))

describe('ponytail-5 normalizeDemoRedirectPath (core-tests #6)', () => {
  it.each(['/\\evil.example', '/\\/evil.example', '/\t/evil.example'])('rejects %j', (input) => {
    const out = normalizeDemoRedirectPath(input)
    expect(new URL(out, 'https://app.example/').origin).toBe('https://app.example')
  })
})
