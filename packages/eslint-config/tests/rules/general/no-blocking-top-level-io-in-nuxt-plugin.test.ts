import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import { describe, expect, it } from 'vitest'

import rule from '../../../src/rules/general/no-blocking-top-level-io-in-nuxt-plugin'

RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  },
})

const plugin = 'app/plugins/auth.client.ts'

ruleTester.run('no-blocking-top-level-io-in-nuxt-plugin', rule, {
  valid: [
    // --- ported from v1 ---
    {
      filename: plugin,
      code: 'defineNuxtPlugin({ parallel: true, async setup() { await $fetch("/a") } })',
    },
    {
      filename: plugin,
      code: 'defineNuxtPlugin((n) => { n.hook("app:created", () => {}) })',
    },
    { filename: 'lib/random.ts', code: 'defineNuxtPlugin(async (n) => { await $fetch("/a") })' },
    // Unanchored `app/plugins/` substring must not false-positive inside
    // `myapp/plugins/`. v1 documented this in a comment; it is now a
    // segment-anchoring property of the shared `path-scope` util.
    {
      filename: 'packages/myapp/plugins/init.ts',
      code: 'defineNuxtPlugin(async (n) => { await $fetch("/a") })',
    },
    {
      filename: 'app/plugins/auth.test.ts',
      code: 'defineNuxtPlugin(async (n) => { await $fetch("/a") })',
    },
    {
      filename: 'app/plugins/__tests__/auth.ts',
      code: 'defineNuxtPlugin(async (n) => { await $fetch("/a") })',
    },

    // --- new: scope boundaries -------------------------------------------
    // `.spec.` is excluded alongside `.test.`.
    {
      filename: 'app/plugins/auth.spec.ts',
      code: 'defineNuxtPlugin(async (n) => { await $fetch("/a") })',
    },
    // A dependency's own plugin directory is never ours.
    {
      filename: 'node_modules/some-layer/app/plugins/init.ts',
      code: 'defineNuxtPlugin(async (n) => { await $fetch("/a") })',
    },
    // A non-async plugin cannot hold a top-level await.
    { filename: plugin, code: 'defineNuxtPlugin((n) => { n.provide("x", 1) })' },
    // The await lives in a NESTED function, which runs lazily — not at boot.
    {
      filename: plugin,
      code: 'defineNuxtPlugin(async () => { const load = async () => { await $fetch("/a") }; return { provide: { load } } })',
    },
    // Awaiting non-I/O is out of scope.
    { filename: plugin, code: 'defineNuxtPlugin(async () => { await nextTick() })' },
    // Object form with `parallel: true` and a nested await.
    {
      filename: plugin,
      code: 'defineNuxtPlugin({ parallel: true, async setup() { for (const u of urls) { await $fetch(u) } } })',
    },
  ],
  invalid: [
    // --- ported from v1 ---
    {
      filename: plugin,
      code: 'defineNuxtPlugin(async (n) => { await $fetch("/a") })',
      errors: [{ messageId: 'blockingPlugin' }],
    },
    {
      filename: plugin,
      code: 'defineNuxtPlugin({ async setup() { await $fetch("/a") } })',
      errors: [{ messageId: 'blockingPlugin' }],
    },
    {
      filename: plugin,
      code: 'defineNuxtPlugin(async () => await $fetch("/a"))',
      errors: [{ messageId: 'blockingPlugin' }],
    },
    {
      filename: plugin,
      code: 'defineNuxtPlugin({ async setup() { return await $fetch("/a") } })',
      errors: [{ messageId: 'blockingPlugin' }],
    },
    {
      filename: plugin,
      code: 'defineNuxtPlugin(async () => { await useFetch?.("/a") })',
      errors: [{ messageId: 'blockingPlugin' }],
    },
    {
      filename: plugin,
      code: 'defineNuxtPlugin(async () => { if (import.meta.client) { await $fetch("/a") } })',
      errors: [{ messageId: 'blockingPlugin' }],
    },
    {
      filename: plugin,
      code: 'defineNuxtPlugin(async () => { try { await $fetch("/a") } catch {} })',
      errors: [{ messageId: 'blockingPlugin' }],
    },
    {
      filename: plugin,
      code: 'const cfg = await $fetch("/cfg"); export default defineNuxtPlugin(() => {})',
      errors: [{ messageId: 'blockingPlugin' }],
    },
    {
      filename: plugin,
      code: 'await $fetch("/warmup"); export default defineNuxtPlugin(() => {})',
      errors: [{ messageId: 'blockingPlugin' }],
    },
    {
      filename: plugin,
      code: 'if (import.meta.client) { await $fetch("/a") } export default defineNuxtPlugin(() => {})',
      errors: [{ messageId: 'blockingPlugin' }],
    },
    {
      filename: plugin,
      code: 'try { await $fetch("/a") } catch {} export default defineNuxtPlugin(() => {})',
      errors: [{ messageId: 'blockingPlugin' }],
    },
    {
      filename: plugin,
      code: 'export const cfg = await $fetch("/cfg"); export default defineNuxtPlugin(() => {})',
      errors: [{ messageId: 'blockingPlugin' }],
    },
    {
      filename: plugin,
      code: 'defineNuxtPlugin(async () => { switch (import.meta.client) { case true: await $fetch("/a") } })',
      errors: [{ messageId: 'blockingPlugin' }],
    },
    {
      filename: plugin,
      code: 'async function setup() { await $fetch("/warmup") }\nexport default defineNuxtPlugin(setup)',
      errors: [{ messageId: 'blockingPlugin' }],
    },
    {
      filename: plugin,
      code: 'const setup = async () => { await $fetch("/warmup") }\nexport default defineNuxtPlugin(setup)',
      errors: [{ messageId: 'blockingPlugin' }],
    },
    {
      filename: plugin,
      code: 'defineNuxtPlugin(async () => { for (const url of urls) { await $fetch(url) } })',
      errors: [{ messageId: 'blockingPlugin' }],
    },
    {
      filename: plugin,
      code: 'defineNuxtPlugin(async () => { let n = 0; while (n < 3) { await $fetch("/p"); n++ } })',
      errors: [{ messageId: 'blockingPlugin' }],
    },
    {
      filename: plugin,
      code: 'for (let cfg = await $fetch("/cfg"); cfg; cfg = null) {}\nexport default defineNuxtPlugin(() => {})',
      errors: [{ messageId: 'blockingPlugin' }],
    },
    {
      filename: plugin,
      code: 'let cfg; for (cfg = await $fetch("/cfg"); cfg; cfg = null) {}\nexport default defineNuxtPlugin(() => {})',
      errors: [{ messageId: 'blockingPlugin' }],
    },

    // --- new: path-gate coverage without `testMode` -----------------------
    // v1 shipped a `testMode` option that short-circuited `isNuxtPluginFile()`
    // to `true`. DESIGN.md bans it, so the gate now has to survive real
    // filenames in every spelling.
    {
      filename: '/repo/app/plugins/auth.client.ts',
      code: 'defineNuxtPlugin(async () => { await $fetch("/a") })',
      errors: [{ messageId: 'blockingPlugin' }],
    },
    {
      filename: 'apps/web/app/plugins/analytics.ts',
      code: 'defineNuxtPlugin(async () => { await $fetch("/a") })',
      errors: [{ messageId: 'blockingPlugin' }],
    },
    {
      filename: 'C:\\repo\\app\\plugins\\auth.ts',
      code: 'defineNuxtPlugin(async () => { await $fetch("/a") })',
      errors: [{ messageId: 'blockingPlugin' }],
    },

    // --- new: adversarial --------------------------------------------------
    // TS value-wrapper around the callee — the same unwrapping the sibling
    // `prefer-safe-parse` rule needed.
    {
      filename: plugin,
      code: 'defineNuxtPlugin(async () => { await ($fetch as any)("/a") })',
      errors: [{ messageId: 'blockingPlugin' }],
    },
    // Module-scope await AND a plugin-body await are two separate blocks.
    {
      filename: plugin,
      code: 'await $fetch("/warmup")\nexport default defineNuxtPlugin(async () => { await $fetch("/b") })',
      errors: [{ messageId: 'blockingPlugin' }, { messageId: 'blockingPlugin' }],
    },
    // `useAsyncData` is in the data-fetch name set too.
    {
      filename: plugin,
      code: 'defineNuxtPlugin(async () => { const { data } = await useAsyncData("k", () => $fetch("/a")) })',
      errors: [{ messageId: 'blockingPlugin' }],
    },
    // An object-form plugin WITHOUT `parallel: true` still blocks, even when
    // the await hides in a `do…while`.
    {
      filename: plugin,
      code: 'defineNuxtPlugin({ async setup() { do { await $fetch("/a") } while (retry) } })',
      errors: [{ messageId: 'blockingPlugin' }],
    },
  ],
})

describe('no-blocking-top-level-io-in-nuxt-plugin meta', () => {
  it('no longer accepts the banned `testMode` bypass', () => {
    // DESIGN.md: "Tests use the real gates — the old suites' `testMode` bypass
    // (which let a dead CSRF gate ship green) is banned".
    expect(rule.meta.schema).toEqual([])
    expect(JSON.stringify(rule.meta.schema)).not.toContain('testMode')
  })
})
