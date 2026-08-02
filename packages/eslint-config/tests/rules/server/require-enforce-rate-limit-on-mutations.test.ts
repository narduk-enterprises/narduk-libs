import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/server/require-enforce-rate-limit-on-mutations'

RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
})

ruleTester.run('require-enforce-rate-limit-on-mutations', rule, {
  valid: [
    {
      name: 'enforced at the top of the handler',
      filename: 'server/api/things.post.ts',
      code: `export default defineEventHandler(async (event) => {
        await enforceRateLimit(event)
        return save(await readBody(event))
      })`,
    },
    {
      name: 'enforced inside handler control flow',
      filename: 'server/api/things.put.ts',
      code: `export default defineEventHandler(async (event) => {
        if (!event.context.internal) { await enforceRateLimitPolicy(event, 'writes') }
        return save(event)
      })`,
    },
    {
      name: 'enforced through a local helper the handler calls',
      filename: 'server/api/things.patch.ts',
      code: `async function guard(event) { await enforceRateLimit(event) }
        export default defineEventHandler(async (event) => {
          await guard(event)
          return save(event)
        })`,
    },
    {
      name: 'enforced through a local arrow helper the handler calls',
      filename: 'server/api/things.delete.ts',
      code: `const guard = async (event) => { await enforceRateLimit(event) }
        export default defineEventHandler(async (event) => {
          await guard(event)
          return remove(event)
        })`,
    },
    {
      name: 'approved mutation wrapper enforces internally',
      filename: 'server/api/things.post.ts',
      code: `export default defineAdminMutation(async (event) => save(await readBody(event)))`,
    },
    {
      name: 'handler-object form',
      filename: 'server/api/things.post.ts',
      code: `export default defineEventHandler({
        handler: async (event) => { await enforceRateLimit(event); return save(event) },
      })`,
    },
    {
      name: 'declared read-only route',
      filename: 'server/api/things.get.ts',
      code: `export default defineEventHandler(async (event) => list(event))`,
    },
    {
      name: 'method-less route is not assumed to be a mutation',
      filename: 'server/api/things.ts',
      code: `export default defineEventHandler(async (event) => list(event))`,
    },
    {
      name: 'exempt cron prefix',
      filename: 'server/api/cron/rollup.post.ts',
      code: `export default defineEventHandler(async (event) => rollup(event))`,
    },
    {
      name: 'handler is imported — the rule cannot see it, so it stays silent',
      filename: 'server/api/things.post.ts',
      code: `import { handler } from '../../handlers/things'
        export default defineEventHandler(handler)`,
    },
    {
      name: 'not a server route',
      filename: 'server/utils/things.ts',
      code: `export const save = async (event) => event`,
    },
    {
      name: 'a route suite in a test DIRECTORY is still exempt',
      filename: 'tests/server/api/things.post.ts',
      code: `export default defineEventHandler(async (event) => save(event))`,
    },
    {
      name: 'an approved wrapper around an imported handler still enforces, even beside another handler',
      filename: 'server/api/things.post.ts',
      code: `import { handler } from '../../handlers/things'
        const compat = defineEventHandler(async (event) => { await enforceRateLimit(event); return save(event) })
        export default defineAdminMutation(handler)`,
    },

    /* -------------- aliased handler-defining calls (adversarial 1) --------- */
    {
      name: 'an aliased approved wrapper still enforces internally',
      filename: 'server/api/things.post.ts',
      code: `const mutate = definePublicMutation
        export default mutate(async (event) => save(event))`,
    },
    {
      name: 'an aliased raw handler that DOES rate limit is satisfied',
      filename: 'server/api/things.post.ts',
      code: `const handler = defineEventHandler
        export default handler(async (event) => {
          await enforceRateLimit(event)
          return save(event)
        })`,
    },
  ],

  invalid: [
    {
      name: 'REVIEW REGRESSION — a rate-limit call in an UNINVOKED function does not count',
      filename: 'server/api/things.post.ts',
      code: `function legacyPathNobodyCalls(event) { enforceRateLimit(event) }
        export default defineEventHandler(async (event) => save(await readBody(event)))`,
      errors: [{ messageId: 'missingRateLimit' }],
    },
    {
      name: 'REVIEW REGRESSION — a rate-limit call in a sibling exported helper does not count',
      filename: 'server/api/things.put.ts',
      code: `export async function limitElsewhere(event) { await enforceRateLimitPolicy(event) }
        export default defineEventHandler(async (event) => update(event))`,
      errors: [{ messageId: 'missingRateLimit' }],
    },
    {
      name: 'no rate limit anywhere',
      filename: 'server/api/things.delete.ts',
      code: `export default defineEventHandler(async (event) => remove(event))`,
      errors: [{ messageId: 'missingRateLimit' }],
    },
    {
      name: 'server/routes/** is covered',
      filename: 'server/routes/things.post.ts',
      code: `export default defineEventHandler(async (event) => save(event))`,
      errors: [{ messageId: 'missingRateLimit' }],
    },
    {
      name: 'a rename cannot disable it — handler declares POST',
      filename: 'server/api/create-thing.ts',
      code: `export default defineEventHandler(async (event) => {
        assertMethod(event, 'POST')
        return save(event)
      })`,
      errors: [{ messageId: 'missingRateLimit' }],
    },
    {
      name: 'nested uninvoked callback does not satisfy the handler',
      filename: 'server/api/things.post.ts',
      code: `export default defineEventHandler(async (event) => {
        onAbort(() => { enforceRateLimit(event) })
        return save(event)
      })`,
      errors: [{ messageId: 'missingRateLimit' }],
    },

    /* ------------- ADVERSARIAL 1: aliased raw handler ---------------------- */
    {
      // Before the alias fix this file produced no diagnostics at all: the rule
      // saw no handler-defining call, so it had no handler to check.
      name: 'an aliased raw handler is still an unlimited mutation route',
      filename: 'server/api/aliased-handler.post.ts',
      code: `const handler = defineEventHandler

        export default handler(async (event) => {
          getHeader(event, 'x-requested-with')
          return { ok: true }
        })`,
      errors: [{ messageId: 'missingRateLimit' }],
    },

    /* ------------- ADVERSARIAL 6: `.test.` infix on a live route ----------- */
    {
      name: 'a .test. infix in a deployed route filename does not exempt it',
      filename: 'server/api/deploy.test.post.ts',
      code: `export default defineEventHandler(async (event) => save(event))`,
      errors: [{ messageId: 'missingRateLimit' }],
    },
  ],
})
