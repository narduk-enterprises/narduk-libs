import { expect, it } from 'vitest'

it('rejects the deliberately failing CI canary', () => {
  expect(1).toBe(2)
})
