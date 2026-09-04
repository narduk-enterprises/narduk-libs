import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/cloudflare/no-worker-global-scope-operations'

RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
})

ruleTester.run('no-worker-global-scope-operations', rule, {
  valid: [
    /* -------- REVIEW REGRESSION: receiver-awareness -------- */
    {
      name: 'REVIEW REGRESSION — cache.fetch(key) is not global fetch',
      filename: 'server/utils/cache.ts',
      code: `import { cache } from './store'
        export const warm = cache.fetch('key')`,
    },
    {
      name: 'REVIEW REGRESSION — pool.connect() is a driver handle, not a socket',
      filename: 'server/utils/db.ts',
      code: `import { pool } from './pool'
        export const handle = pool.connect()`,
    },
    {
      name: 'REVIEW REGRESSION — an arbitrary receiver named fetch',
      filename: 'server/utils/api.ts',
      code: `import { stripe } from './stripe'
        export const account = stripe.fetch('acct_1')`,
    },
    {
      name: 'REVIEW REGRESSION — a locally declared fetch helper',
      filename: 'server/utils/api.ts',
      code: `function fetch(id) { return id }
        export const value = fetch('x')`,
    },

    /* -------- legitimately deferred / handler-scoped -------- */
    {
      name: 'fetch inside a handler',
      filename: 'server/api/proxy.get.ts',
      code: `export default defineEventHandler(async () => await fetch('https://example.com'))`,
    },
    {
      name: 'random inside a handler',
      filename: 'server/api/id.get.ts',
      code: `export default defineEventHandler(() => crypto.randomUUID())`,
    },
    {
      name: 'timer registered inside a handler',
      filename: 'server/api/thing.get.ts',
      code: `export default defineEventHandler(() => { setTimeout(() => log(), 10) })`,
    },
    {
      name: 'deferred promise callback',
      filename: 'server/plugins/warmup.ts',
      code: `Promise.resolve().then(() => fetch('https://example.com'))`,
    },

    /* -------- out of Worker scope -------- */
    {
      name: 'REVIEW REGRESSION — a checkout under ~/workers/ is not Worker runtime',
      filename: '/Users/dev/workers/my-app/app/plugins/analytics.ts',
      code: `export const boot = fetch('https://example.com')`,
    },
    {
      name: 'app code is not Worker runtime',
      filename: 'app/plugins/analytics.ts',
      code: `export const boot = fetch('https://example.com')`,
    },
    {
      name: 'test file is not Worker runtime',
      filename: 'server/api/proxy.test.ts',
      code: `export const boot = fetch('https://example.com')`,
    },
  ],

  invalid: [
    {
      name: 'global fetch at module scope',
      filename: 'server/plugins/warmup.ts',
      code: `export const config = await fetch('https://example.com/config')`,
      errors: [{ messageId: 'disallowedGlobalScopeOperation' }],
    },
    {
      name: 'globalThis.fetch at module scope',
      filename: 'server/plugins/warmup.ts',
      code: `export const config = globalThis.fetch('https://example.com/config')`,
      errors: [{ messageId: 'disallowedGlobalScopeOperation' }],
    },
    {
      name: '$fetch at module scope',
      filename: 'server/plugins/warmup.ts',
      code: `export const config = $fetch('/api/config')`,
      errors: [{ messageId: 'disallowedGlobalScopeOperation' }],
    },
    {
      name: '$fetch.raw at module scope',
      filename: 'server/plugins/warmup.ts',
      code: `export const config = $fetch.raw('/api/config')`,
      errors: [{ messageId: 'disallowedGlobalScopeOperation' }],
    },
    {
      name: 'cloudflare:sockets connect at module scope',
      filename: 'server/utils/socket.ts',
      code: `import { connect } from 'cloudflare:sockets'
        export const socket = connect({ hostname: 'db.example.com', port: 5432 })`,
      errors: [{ messageId: 'disallowedGlobalScopeOperation' }],
    },
    {
      name: 'namespace network module connect',
      filename: 'server/utils/socket.ts',
      code: `import * as sockets from 'cloudflare:sockets'
        export const socket = sockets.connect({ hostname: 'db', port: 5432 })`,
      errors: [{ messageId: 'disallowedGlobalScopeOperation' }],
    },
    {
      name: 'setTimeout at module scope',
      filename: 'server/plugins/warmup.ts',
      code: `setTimeout(() => log('tick'), 1000)`,
      errors: [{ messageId: 'disallowedGlobalScopeOperation' }],
    },
    {
      name: 'setInterval at module scope',
      filename: 'server/plugins/warmup.ts',
      code: `globalThis.setInterval(() => log('tick'), 1000)`,
      errors: [{ messageId: 'disallowedGlobalScopeOperation' }],
    },
    {
      name: 'crypto.randomUUID at module scope',
      filename: 'server/utils/id.ts',
      code: `export const instanceId = crypto.randomUUID()`,
      errors: [{ messageId: 'disallowedGlobalScopeOperation' }],
    },
    {
      name: 'crypto.getRandomValues at module scope',
      filename: 'server/utils/id.ts',
      code: `export const seed = globalThis.crypto.getRandomValues(new Uint8Array(8))`,
      errors: [{ messageId: 'disallowedGlobalScopeOperation' }],
    },
    {
      name: 'Math.random at module scope',
      filename: 'server/utils/id.ts',
      code: `export const jitter = Math.random()`,
      errors: [{ messageId: 'disallowedGlobalScopeOperation' }],
    },
    {
      name: 'callback-invoked module scope',
      filename: 'server/plugins/warmup.ts',
      code: `export const configs = urls.map((url) => fetch(url))`,
      errors: [{ messageId: 'disallowedGlobalScopeOperation' }],
    },
    {
      // A config that declares worker/browser globals gives `fetch` a Variable
      // with no defs. Treating that as a shadow would disable the rule for
      // almost every real project.
      name: 'still fires when the config DECLARES fetch as a global',
      filename: 'server/plugins/warmup.ts',
      languageOptions: { globals: { fetch: 'readonly' } },
      code: `export const config = fetch('https://example.com/config')`,
      errors: [{ messageId: 'disallowedGlobalScopeOperation' }],
    },
  ],
})
