import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/server/no-csrf-exempt-route-misuse'

RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
})

ruleTester.run('no-csrf-exempt-route-misuse', rule, {
  valid: [
    {
      name: 'verifies a GitHub signature header',
      filename: 'server/api/webhooks/github.post.ts',
      code: `export default defineEventHandler(async (event) => {
        const signature = getHeader(event, 'x-hub-signature-256')
        if (!timingSafeEqual(signature, expected)) throw createError({ statusCode: 401 })
        return handle(await readBody(event))
      })`,
    },
    {
      name: 'verifies a Stripe signature header',
      filename: 'server/api/webhooks/stripe.post.ts',
      code: `export default defineEventHandler(async (event) => {
        const sig = getRequestHeader(event, 'stripe-signature')
        return stripe.webhooks.constructEvent(await readRawBody(event), sig, secret)
      })`,
    },
    {
      name: 'verifies via event.headers.get',
      filename: 'server/api/callbacks/oauth.post.ts',
      code: `export default defineEventHandler(async (event) => {
        const token = event.headers.get('x-webhook-token')
        return exchange(token, await readBody(event))
      })`,
    },
    {
      name: 'delegates to a verification helper',
      filename: 'server/api/webhooks/svix.post.ts',
      code: `export default defineEventHandler(async (event) => {
        await verifyWebhookSignature(event)
        return handle(await readBody(event))
      })`,
    },
    {
      name: 'reads a header through a credential-named variable',
      filename: 'server/api/cron/rollup.post.ts',
      code: `const cronSecretHeader = 'x-cron-key'
        export default defineEventHandler(async (event) => {
          const provided = getHeader(event, cronSecretHeader)
          if (provided !== useRuntimeConfig().cronKey) throw createError({ statusCode: 401 })
          return rollup(await readBody(event))
        })`,
    },
    {
      name: 'checks an authorization header',
      filename: 'server/api/cron/rollup.post.ts',
      code: `export default defineEventHandler(async (event) => {
        const auth = getHeader(event, 'authorization')
        return auth === expected ? rollup(await readBody(event)) : null
      })`,
    },
    {
      name: 'exempt route that reads no body needs no secret',
      filename: 'server/api/cron/ping.get.ts',
      code: `export default defineEventHandler(async () => ({ ok: true }))`,
    },
    {
      name: 'non-exempt route is out of scope',
      filename: 'server/api/things.post.ts',
      code: `export default defineEventHandler(async (event) => save(await readBody(event)))`,
    },
    {
      name: 'not a server route',
      filename: 'app/composables/useWebhooks.ts',
      code: `export const handle = async (event) => readBody(event)`,
    },
    {
      name: 'a route suite in a test DIRECTORY is still exempt',
      filename: 'tests/server/api/webhooks/github.post.ts',
      code: `export default defineEventHandler(async (event) => readBody(event))`,
    },
    {
      name: 'a project-configured secret header name',
      filename: 'server/api/webhooks/custom.post.ts',
      options: [{ secretHeaders: ['x-internal-shared'] }],
      code: `export default defineEventHandler(async (event) => {
        const provided = getHeader(event, 'x-internal-shared')
        return provided === expected ? handle(await readBody(event)) : null
      })`,
    },
  ],

  invalid: [
    {
      name: 'REVIEW REGRESSION — reading an unrelated header no longer satisfies the rule',
      filename: 'server/api/webhooks/github.post.ts',
      code: `export default defineEventHandler(async (event) => {
        const ua = getHeader(event, 'user-agent')
        return handle(await readBody(event), ua)
      })`,
      errors: [{ messageId: 'headerReadButNotSecret', data: { header: 'user-agent' } }],
    },
    {
      name: 'REVIEW REGRESSION — reading content-type is not authentication',
      filename: 'server/api/callbacks/oauth.post.ts',
      code: `export default defineEventHandler(async (event) => {
        if (getHeader(event, 'content-type') !== 'application/json') throw createError({ statusCode: 415 })
        return exchange(await readBody(event))
      })`,
      errors: [{ messageId: 'headerReadButNotSecret' }],
    },
    {
      name: 'no header read at all',
      filename: 'server/api/webhooks/generic.post.ts',
      code: `export default defineEventHandler(async (event) => handle(await readBody(event)))`,
      errors: [{ messageId: 'missingSecretValidation' }],
    },
    {
      name: 'cron route reading a body without a secret',
      filename: 'server/api/cron/rollup.post.ts',
      code: `export default defineEventHandler(async (event) => rollup(await readBody(event)))`,
      errors: [{ messageId: 'missingSecretValidation' }],
    },
    {
      name: 'an opaque non-literal header name is still the presence check',
      filename: 'server/api/webhooks/generic.post.ts',
      code: `export default defineEventHandler(async (event) => {
        const value = getHeader(event, name)
        return handle(await readBody(event), value)
      })`,
      errors: [{ messageId: 'missingSecretValidation' }],
    },
    {
      name: 'server/routes exempt prefix is covered',
      filename: 'server/routes/webhooks/github.post.ts',
      code: `export default defineEventHandler(async (event) => handle(await readBody(event)))`,
      errors: [{ messageId: 'missingSecretValidation' }],
    },
    {
      name: 'method-less exempt route reading a body',
      filename: 'server/api/webhooks/generic.ts',
      code: `export default defineEventHandler(async (event) => handle(await readBody(event)))`,
      errors: [{ messageId: 'missingSecretValidation' }],
    },
    {
      name: 'absolute filename behaves identically',
      filename: '/Users/dev/app/server/api/webhooks/generic.post.ts',
      code: `export default defineEventHandler(async (event) => handle(await readMultipartFormData(event)))`,
      errors: [{ messageId: 'missingSecretValidation' }],
    },
  ],
})
