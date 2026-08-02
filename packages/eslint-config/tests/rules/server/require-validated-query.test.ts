import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/server/require-validated-query'

RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
})

ruleTester.run('require-validated-query', rule, {
  valid: [
    {
      name: 'inline schema parse',
      filename: 'server/api/things.get.ts',
      code: `export default defineEventHandler((event) => querySchema.safeParse(getQuery(event)))`,
    },
    {
      name: 'assigned then validated in the same scope',
      filename: 'server/api/things.get.ts',
      code: `export default defineEventHandler((event) => {
        const query = getQuery(event)
        const parsed = querySchema.parse(query)
        return list(parsed)
      })`,
    },
    {
      name: 'valibot namespace form',
      filename: 'server/api/things.get.ts',
      code: `export default defineEventHandler((event) => v.parse(QuerySchema, getQuery(event)))`,
    },
    {
      name: 'getValidatedQuery is the canonical helper and is never visited',
      filename: 'server/api/things.get.ts',
      code: `export default defineEventHandler((event) => getValidatedQuery(event, querySchema.parse))`,
    },
    {
      name: 'not a server route',
      filename: 'app/composables/useThings.ts',
      code: `export const read = (event) => getQuery(event).limit`,
    },
    {
      name: 'a route suite in a test DIRECTORY is still exempt',
      filename: 'tests/server/api/things.get.ts',
      code: `export default defineEventHandler((event) => getQuery(event))`,
    },
  ],

  invalid: [
    {
      name: 'REVIEW REGRESSION — scope-blind: validating a DIFFERENT `query` must not clear this one',
      filename: 'server/api/things.get.ts',
      code: `function other() {
          const query = { limit: 10 }
          return querySchema.parse(query)
        }
        export default defineEventHandler((event) => {
          const query = getQuery(event)
          return list(query.limit)
        })`,
      errors: [{ messageId: 'requireValidation' }],
    },
    {
      name: 'REVIEW REGRESSION — destructuring escaped v1 entirely',
      filename: 'server/api/things.get.ts',
      code: `export default defineEventHandler((event) => {
        const { limit } = getQuery(event)
        return list(limit)
      })`,
      errors: [{ messageId: 'destructuredWithoutValidation' }],
    },
    {
      name: 'REVIEW REGRESSION — receiver-blind: JSON.parse is not validation',
      filename: 'server/api/things.get.ts',
      code: `export default defineEventHandler((event) => JSON.parse(getQuery(event)))`,
      errors: [{ messageId: 'nonSchemaReceiver' }],
    },
    {
      name: 'inline property read',
      filename: 'server/api/things.get.ts',
      code: `export default defineEventHandler((event) => list(Number(getQuery(event).limit)))`,
      errors: [{ messageId: 'requireValidation' }],
    },
    {
      name: 'assigned but never validated',
      filename: 'server/api/things.get.ts',
      code: `export default defineEventHandler((event) => {
        const query = getQuery(event)
        return list(query.limit)
      })`,
      errors: [{ messageId: 'requireValidation' }],
    },
    {
      name: 'spread into another object',
      filename: 'server/api/things.get.ts',
      code: `export default defineEventHandler((event) => list({ ...getQuery(event) }))`,
      errors: [{ messageId: 'requireValidation' }],
    },
    {
      name: 'server/routes/** is covered',
      filename: 'server/routes/things.ts',
      code: `export default defineEventHandler((event) => list(getQuery(event)))`,
      errors: [{ messageId: 'requireValidation' }],
    },
    {
      name: 'absolute filename behaves identically',
      filename: '/Users/dev/app/server/api/things.get.ts',
      code: `export default defineEventHandler((event) => list(getQuery(event)))`,
      errors: [{ messageId: 'requireValidation' }],
    },
  ],
})
