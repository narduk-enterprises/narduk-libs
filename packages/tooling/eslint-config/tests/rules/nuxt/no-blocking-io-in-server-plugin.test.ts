import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/nuxt/no-blocking-io-in-server-plugin'

RuleTester.describe = describe
RuleTester.it = it

const ts = new RuleTester({
  languageOptions: { parser: tsParser, parserOptions: { ecmaVersion: 2022, sourceType: 'module' } },
})

const PLUGIN = 'server/plugins/warmup.ts'

ts.run('no-blocking-io-in-server-plugin', rule, {
  valid: [
    // Deferred into a hook: this is the fix the rule asks for.
    {
      filename: PLUGIN,
      code: 'export default defineNitroPlugin((nitroApp) => { nitroApp.hook("request", async () => { await $fetch("/api/warm") }) })',
    },
    // Lazily initialised on first use.
    {
      filename: PLUGIN,
      code: 'export default defineNitroPlugin(() => { let ready; const get = async () => { ready ??= await $fetch("/api/warm"); return ready } })',
    },
    { filename: PLUGIN, code: 'export default defineNitroPlugin(() => { console.log("ready") })' },
    // Not a server plugin.
    {
      filename: 'server/api/orders.get.ts',
      code: 'export default defineEventHandler(async () => await $fetch("/api/orders"))',
    },
    {
      filename: 'tests/server/warmup.test.ts',
      code: 'export default defineNitroPlugin(async () => { await $fetch("/api/warm") })',
    },
  ],
  invalid: [
    {
      filename: PLUGIN,
      code: 'export default defineNitroPlugin(async () => { await $fetch("/api/warm") })',
      errors: [{ messageId: 'blockingStartupIo' }],
    },
    // Deep-review defect: v1 missed the canonical cold-start blocker entirely.
    {
      filename: PLUGIN,
      code: 'export default defineNitroPlugin(async () => { await Promise.all([$fetch("/a"), $fetch("/b")]) })',
      errors: [{ messageId: 'blockingStartupIo' }],
    },
    // Deep-review defect: v1 detected database I/O by the literal identifier `db`.
    {
      filename: PLUGIN,
      code: 'export default defineNitroPlugin(async () => { const rows = await database.select().from(settings); useRuntimeConfig().rows = rows })',
      errors: [{ messageId: 'blockingStartupIo' }],
    },
    {
      filename: PLUGIN,
      code: 'export default defineNitroPlugin(async () => { const cached = await useStorage("cache").getItem("settings") })',
      errors: [{ messageId: 'blockingStartupIo' }],
    },
    // Module top-level await blocks startup just as hard.
    {
      filename: 'server/plugins/seed.ts',
      code: 'const seed = await readFile("./seed.json")\nexport default defineNitroPlugin(() => {})',
      errors: [{ messageId: 'blockingStartupIo' }],
    },
  ],
})
