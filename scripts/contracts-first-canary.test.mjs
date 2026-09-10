import assert from 'node:assert/strict'
import { test } from 'node:test'

test('temporary live contracts scheduling canary', () => {
  assert.fail('Intentional canary: expensive CI jobs must not start after this contracts failure')
})
