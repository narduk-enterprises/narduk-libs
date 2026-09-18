import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/server/require-fetch-timeout'

RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
})

const FILE = 'server/utils/upstream.ts'

ruleTester.run('require-fetch-timeout', rule, {
  valid: [
    {
      name: 'fetch with an abort signal',
      filename: FILE,
      code: 'await fetch(url, { signal: AbortSignal.timeout(5000) })',
    },
    { name: '$fetch with timeout', filename: FILE, code: 'await $fetch(url, { timeout: 5000 })' },
    {
      name: 'ofetch with timeout',
      filename: FILE,
      code: 'await ofetch(url, { method: "POST", timeout: 5000 })',
    },
    { name: 'opaque init object', filename: FILE, code: 'await fetch(url, init)' },
    {
      name: 'spread may carry a signal',
      filename: FILE,
      code: 'await fetch(url, { ...init, method: "POST" })',
    },
    {
      name: 'internal $fetch path runs in-process',
      filename: FILE,
      code: "await $fetch('/api/items')",
    },
    {
      name: 'internal $fetch template path',
      filename: FILE,
      code: 'await $fetch(`/api/items/${id}`)',
    },
    { name: 'not server code', filename: 'app/composables/useThing.ts', code: 'await fetch(url)' },
    {
      name: 'server test tree is exempt',
      filename: 'server/__tests__/upstream.test.ts',
      code: 'await fetch(url)',
    },
    { name: 'unrelated member fetch', filename: FILE, code: 'await client.fetch(url)' },
  ],
  invalid: [
    {
      name: 'bare fetch',
      filename: FILE,
      code: 'await fetch(url)',
      errors: [{ messageId: 'requireTimeout', data: { callee: 'fetch' } }],
    },
    {
      name: 'fetch with headers only',
      filename: 'server/api/proxy.get.ts',
      code: 'await fetch(url, { headers })',
      errors: [{ messageId: 'requireTimeout' }],
    },
    {
      name: 'external $fetch',
      filename: FILE,
      code: "await $fetch('https://api.example.com/x')",
      errors: [{ messageId: 'requireTimeout', data: { callee: '$fetch' } }],
    },
    {
      name: 'ofetch with method only',
      filename: FILE,
      code: 'await ofetch(url, { method: "POST" })',
      errors: [{ messageId: 'requireTimeout' }],
    },
    {
      name: 'globalThis.fetch',
      filename: FILE,
      code: 'await globalThis.fetch(url)',
      errors: [{ messageId: 'requireTimeout' }],
    },
    {
      name: 'nested server dir',
      filename: '/repo/apps/web/server/utils/x.ts',
      code: 'await fetch(url)',
      errors: [{ messageId: 'requireTimeout' }],
    },
    {
      name: 'internal path does not exempt plain fetch',
      filename: FILE,
      code: "await fetch('/api/items')",
      errors: [{ messageId: 'requireTimeout' }],
    },
  ],
})
