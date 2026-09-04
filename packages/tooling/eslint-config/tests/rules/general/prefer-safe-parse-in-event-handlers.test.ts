import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import { describe, expect, it } from 'vitest'

import rule from '../../../src/rules/general/prefer-safe-parse-in-event-handlers'

RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  },
})

const route = 'server/api/users.post.ts'

ruleTester.run('prefer-safe-parse-in-event-handlers', rule, {
  valid: [
    // --- ported from v1 (now with real Nitro filenames) -------------------
    { filename: 'server/utils/schema.ts', code: 'const result = schema.parse({ a: 1 })' },
    {
      filename: route,
      code: `
        export default defineEventHandler(async (event) => {
          const result = schema.safeParse(await readBody(event))
          if (!result.success) throw new Error('bad')
        })
      `,
    },
    {
      filename: route,
      code: `
        export default defineEventHandler(async (event) => {
          try {
            const body = schema.parse(await readBody(event))
            return body
          } catch (error) {
            throw createError({ statusCode: 400 })
          }
        })
      `,
    },
    {
      filename: route,
      code: `
        export default withValidation(async (event) => {
          const body = await schema.parseAsync(await readBody(event))
          return body
        })
      `,
    },
    {
      filename: route,
      code: `
        const handler = async (event) => {
          const body = schema.parse(await readBody(event))
          return body
        }
        export default withValidation(handler)
      `,
    },
    {
      filename: route,
      code: `
        async function handler(event) {
          const body = schema.parse(await readBody(event))
          return body
        }
        export default safeHandler(handler)
      `,
    },
    {
      filename: route,
      code: `
        export default defineEventHandler(async (event) => {
          const body = JSON.parse(await readRawBody(event))
          const when = Date.parse(body.when)
          return { body, when }
        })
      `,
    },
    {
      filename: 'server/api/redirect.get.ts',
      code: `
        export default defineEventHandler(async (event) => {
          const parsed = URL.parse(String(event.node.req.url ?? ''))
          return parsed
        })
      `,
    },
    {
      filename: 'server/api/session.get.ts',
      code: `
        import cookie from 'cookie'
        export default defineEventHandler((event) => {
          const raw = getHeader(event, 'cookie') ?? ''
          return cookie.parse(raw)
        })
      `,
    },
    {
      filename: 'server/api/search.get.ts',
      code: `
        import qs from 'qs'
        export default defineEventHandler((event) => {
          return qs.parse(event.node.req.url ?? '')
        })
      `,
    },
    {
      filename: 'server/api/search.get.ts',
      code: `
        import querystring from 'node:querystring'
        export default defineEventHandler((event) => {
          return querystring.parse('a=1&b=2')
        })
      `,
    },

    // --- new: remaining NON_SCHEMA_RECEIVERS entries -----------------------
    {
      filename: 'server/api/config.post.ts',
      code: `
        import yaml from 'yaml'
        export default defineEventHandler(async (event) => {
          return yaml.parse(await readRawBody(event))
        })
      `,
    },
    {
      filename: 'server/api/config.post.ts',
      code: `
        import TOML from 'toml'
        export default defineEventHandler(async (event) => {
          return TOML.parse(await readRawBody(event))
        })
      `,
    },

    // --- new: try/catch discrimination -------------------------------------
    // A NESTED try/catch around the call still protects it.
    {
      filename: route,
      code: `
        export default defineEventHandler(async (event) => {
          if (ok) {
            try {
              return schema.parse(await readBody(event))
            } catch {
              return null
            }
          }
        })
      `,
    },
    // A custom allow-listed wrapper supplied through the real option schema.
    {
      filename: route,
      code: `
        export default myGuard(async (event) => {
          return schema.parse(await readBody(event))
        })
      `,
      options: [{ allowedHandlerWrappers: ['myGuard'] }],
    },
    // A bare `parse(x)` call has no receiver to judge.
    {
      filename: route,
      code: `
        import { parse } from 'node:querystring'
        export default defineEventHandler(async (event) => parse(await readRawBody(event)))
      `,
    },
  ],
  invalid: [
    // --- ported from v1 ---
    {
      filename: route,
      code: `
        export default defineEventHandler(async (event) => {
          const body = schema.parse(await readBody(event))
          return body
        })
      `,
      errors: [{ messageId: 'preferSafeParse', data: { original: 'parse', method: 'safeParse' } }],
    },
    {
      filename: route,
      code: `
        export default defineEventHandler(async (event) => {
          const body = await schema.parseAsync(await readBody(event))
          return body
        })
      `,
      errors: [
        {
          messageId: 'preferSafeParse',
          data: { original: 'parseAsync', method: 'safeParseAsync' },
        },
      ],
    },
    {
      filename: route,
      code: `
        export default defineAdminMutation(async (event) => {
          const body = schema.parse(await readBody(event))
          return body
        })
      `,
      errors: [{ messageId: 'preferSafeParse' }],
    },
    {
      filename: route,
      options: [{ allowedHandlerWrappers: ['withValidation'] }],
      code: `
        export default defineEventHandler(async (event) => {
          return unrelatedWrapper(async () => {
            const body = schema.parse(await readBody(event))
            return body
          })
        })
      `,
      errors: [{ messageId: 'preferSafeParse' }],
    },
    {
      filename: route,
      code: `
        export default defineEventHandler(async (event) => {
          try {
            return await run()
          } catch (error) {
            const body = schema.parse(await readBody(event))
            return body
          }
        })
      `,
      errors: [{ messageId: 'preferSafeParse' }],
    },
    {
      filename: route,
      code: `
        export default defineEventHandler(async (event) => {
          try {
            return await run()
          } finally {
            const body = schema.parse(await readBody(event))
            return body
          }
        })
      `,
      errors: [{ messageId: 'preferSafeParse' }],
    },
    {
      filename: route,
      code: `
        export default defineEventHandler(async (event) => {
          try {
            const body = schema.parse(await readBody(event))
            return body
          } finally {
            cleanup()
          }
        })
      `,
      errors: [{ messageId: 'preferSafeParse' }],
    },
    {
      filename: route,
      code: `
        const handler = async (event) => {
          const body = schema.parse(await readBody(event))
          return body
        }
        export default defineEventHandler(handler)
      `,
      errors: [{ messageId: 'preferSafeParse' }],
    },
    {
      filename: route,
      code: `
        async function handler(event) {
          const body = schema.parse(await readBody(event))
          return body
        }
        export default defineEventHandler(handler)
      `,
      errors: [{ messageId: 'preferSafeParse' }],
    },
    {
      filename: route,
      code: `
        const handler = async (event) => {
          const body = schema.parseAsync(await readBody(event))
          return body
        }
        export default defineAdminMutation(handler)
      `,
      errors: [{ messageId: 'preferSafeParse' }],
    },
    {
      filename: 'server/api/users.get.ts',
      code: `
        export default defineCachedEventHandler(async (event) => {
          const body = schema.parse(await readBody(event))
          return body
        })
      `,
      errors: [{ messageId: 'preferSafeParse' }],
    },
    {
      filename: 'server/api/users.get.ts',
      code: `
        export default defineLazyEventHandler(() => defineEventHandler(async (event) => {
          const body = schema.parse(await readBody(event))
          return body
        }))
      `,
      errors: [{ messageId: 'preferSafeParse' }],
    },
    {
      filename: route,
      code: `
        export default defineEventHandler(async (event) => {
          return schema?.parse(await readBody(event))
        })
      `,
      errors: [{ messageId: 'preferSafeParse' }],
    },
    // TS wrapper unwrapping (v1 ran these in a second, TS-parser runner).
    {
      filename: route,
      code: `
        export default defineEventHandler(async (event) => {
          return (schema.parse as any)(await readBody(event))
        })
      `,
      errors: [{ messageId: 'preferSafeParse' }],
    },
    {
      filename: route,
      code: `
        export default defineEventHandler(async (event) => {
          return (schema?.parse as any)(await readBody(event))
        })
      `,
      errors: [{ messageId: 'preferSafeParse' }],
    },

    // --- new: adversarial --------------------------------------------------
    // Namespace-imported zod. The receiver is a CallExpression, so the
    // NON_SCHEMA_RECEIVERS identifier check never applies and the call is
    // correctly reported — the namespace-import class landing on the right
    // side here.
    {
      filename: route,
      code: `
        import * as z from 'zod'
        export default defineEventHandler(async (event) => {
          return z.object({ a: z.string() }).parse(await readBody(event))
        })
      `,
      errors: [{ messageId: 'preferSafeParse' }],
    },
    // The MIRROR of that, and a genuine false positive: `NON_SCHEMA_RECEIVERS`
    // is matched on the receiver IDENTIFIER, so the identical `qs.parse` call
    // reported as valid above becomes a report once the import is aliased.
    // Asserted so the alias-class defect is on the record rather than assumed
    // absent; widening it is out of scope for a KEEP port because a
    // name-blind exemption would silence real zod calls.
    {
      filename: 'server/api/search.get.ts',
      code: `
        import qsAlias from 'qs'
        export default defineEventHandler((event) => {
          return qsAlias.parse(event.node.req.url ?? '')
        })
      `,
      errors: [{ messageId: 'preferSafeParse' }],
    },
    // Stacked TS wrappers in both orders.
    {
      filename: route,
      code: `
        export default defineEventHandler(async (event) => {
          return (schema?.parse as unknown as any)(await readBody(event))
        })
      `,
      errors: [{ messageId: 'preferSafeParse' }],
    },
    // Non-null assertion on the receiver.
    {
      filename: route,
      code: `
        export default defineEventHandler(async (event) => {
          return schema!.parse(await readBody(event))
        })
      `,
      errors: [{ messageId: 'preferSafeParse' }],
    },
    // Handler bound by ASSIGNMENT rather than declaration — the second branch
    // of `getBindingIdentifier`, which v1 had no test for.
    {
      filename: route,
      code: `
        let handler
        handler = async (event) => {
          return schema.parse(await readBody(event))
        }
        export default defineEventHandler(handler)
      `,
      errors: [{ messageId: 'preferSafeParse' }],
    },
    // Two unprotected parses in one handler report twice.
    {
      filename: route,
      code: `
        export default defineEventHandler(async (event) => {
          const body = bodySchema.parse(await readBody(event))
          const query = querySchema.parse(getQuery(event))
          return { body, query }
        })
      `,
      errors: [{ messageId: 'preferSafeParse' }, { messageId: 'preferSafeParse' }],
    },
    // `server/routes/**` is a Nitro route surface too. This rule keys off the
    // handler wrapper rather than the filename, so it covers the surface the
    // review proved `mutation-route-utils`' path regex misses.
    {
      filename: 'server/routes/webhook.post.ts',
      code: `
        export default defineEventHandler(async (event) => {
          return payloadSchema.parse(await readBody(event))
        })
      `,
      errors: [{ messageId: 'preferSafeParse' }],
    },
  ],
})

describe('prefer-safe-parse-in-event-handlers meta', () => {
  it('is a non-fixing rule and exposes only its wrapper allow-list option', () => {
    expect(rule.meta).not.toHaveProperty('fixable')
    expect(rule.meta.schema).toHaveLength(1)
    expect(Object.keys(rule.meta.schema[0].properties)).toEqual(['allowedHandlerWrappers'])
  })
})
