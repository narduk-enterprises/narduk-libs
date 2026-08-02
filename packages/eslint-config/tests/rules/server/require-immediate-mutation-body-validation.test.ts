import tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/server/require-immediate-mutation-body-validation'

RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
})

/** Nitro routes are TypeScript; this proves the TS-wrapper unwrapping works. */
const tsRuleTester = new RuleTester({
  languageOptions: { parser: tsParser, ecmaVersion: 2024, sourceType: 'module' },
})

ruleTester.run('require-immediate-mutation-body-validation', rule, {
  valid: [
    {
      name: 'zod-style method parse',
      filename: 'server/api/things.post.ts',
      code: `export default defineEventHandler(async (event) => schema.parse(await readBody(event)))`,
    },
    {
      name: 'safeParseAsync',
      filename: 'server/api/things.put.ts',
      code: `export default defineEventHandler(async (event) => bodySchema.safeParseAsync(await readBody(event)))`,
    },
    {
      name: 'valibot namespace form — body is the second argument',
      filename: 'server/api/things.post.ts',
      code: `export default defineEventHandler(async (event) => v.parse(BodySchema, await readBody(event)))`,
    },
    {
      name: 'bare imported parser',
      filename: 'server/api/things.post.ts',
      code: `import { safeParse } from 'valibot'
        export default defineEventHandler(async (event) => safeParse(BodySchema, await readBody(event)))`,
    },
    {
      name: 'readValidatedBody is the canonical helper and is never visited',
      filename: 'server/api/things.post.ts',
      code: `export default defineEventHandler(async (event) => readValidatedBody(event, schema.safeParse))`,
    },
    {
      name: 'declared read-only route',
      filename: 'server/api/things.get.ts',
      code: `export default defineEventHandler(async (event) => { const body = await readBody(event); return body })`,
    },
    {
      name: 'exempt webhook prefix',
      filename: 'server/api/webhooks/stripe.post.ts',
      code: `export default defineEventHandler(async (event) => { const body = await readBody(event); return body })`,
    },
    {
      name: 'not a server route',
      filename: 'app/composables/useThing.ts',
      code: `export const send = async (event) => { const body = await readBody(event); return body }`,
    },
    {
      name: 'a route suite in a test DIRECTORY is still exempt',
      filename: 'tests/server/api/things.post.ts',
      code: `export default defineEventHandler(async (event) => readBody(event))`,
    },
  ],

  invalid: [
    {
      name: 'REVIEW REGRESSION — JSON.parse is deserialization, not validation',
      filename: 'server/api/things.post.ts',
      code: `export default defineEventHandler(async (event) => JSON.parse(await readBody(event)))`,
      errors: [
        {
          messageId: 'nonSchemaReceiver',
          data: { receiver: 'JSON', method: 'parse', reader: 'readBody' },
        },
      ],
    },
    {
      name: 'REVIEW REGRESSION — other non-schema receivers',
      filename: 'server/api/things.post.ts',
      code: `export default defineEventHandler(async (event) => qs.parse(await readBody(event)))`,
      errors: [{ messageId: 'nonSchemaReceiver' }],
    },
    {
      name: 'deferred validation — assigned to a variable first',
      filename: 'server/api/things.post.ts',
      code: `export default defineEventHandler(async (event) => {
        const body = await readBody(event)
        return schema.parse(body)
      })`,
      errors: [{ messageId: 'requireImmediateValidation' }],
    },
    {
      name: 'no validation at all',
      filename: 'server/api/things.patch.ts',
      code: `export default defineEventHandler(async (event) => save(await readBody(event)))`,
      errors: [{ messageId: 'requireImmediateValidation' }],
    },
    {
      name: 'server/routes/** is covered (v1 saw only server/api)',
      filename: 'server/routes/things.post.ts',
      code: `export default defineEventHandler(async (event) => save(await readBody(event)))`,
      errors: [{ messageId: 'requireImmediateValidation' }],
    },
    {
      name: 'a rename cannot disable it — handler declares POST',
      filename: 'server/api/create-thing.ts',
      code: `export default defineEventHandler(async (event) => {
        assertMethod(event, 'POST')
        return save(await readBody(event))
      })`,
      errors: [{ messageId: 'requireImmediateValidation' }],
    },
    {
      name: 'a method-less route that reads a body is still in scope',
      filename: 'server/api/things.ts',
      code: `export default defineEventHandler(async (event) => save(await readBody(event)))`,
      errors: [{ messageId: 'requireImmediateValidation' }],
    },
    {
      name: 'readMultipartFormData is covered',
      filename: 'server/api/upload.post.ts',
      code: `export default defineEventHandler(async (event) => store(await readMultipartFormData(event)))`,
      errors: [{ messageId: 'requireImmediateValidation' }],
    },
    {
      name: 'absolute filename behaves identically',
      filename: '/Users/dev/app/server/api/things.post.ts',
      code: `export default defineEventHandler(async (event) => save(await readBody(event)))`,
      errors: [{ messageId: 'requireImmediateValidation' }],
    },
  ],
})

/** TypeScript-only syntax, parsed by @typescript-eslint/parser. */
tsRuleTester.run('require-immediate-mutation-body-validation (TypeScript)', rule, {
  valid: [
    {
      name: 'TS cast between the reader and the parser',
      filename: 'server/api/things.post.ts',
      code: `export default defineEventHandler(async (event) => schema.parse((await readBody(event)) as unknown))`,
    },
    {
      name: 'non-null assertion between the reader and the parser',
      filename: 'server/api/things.post.ts',
      code: `export default defineEventHandler(async (event) => schema.safeParse((await readBody(event))!))`,
    },
    {
      name: 'satisfies between the reader and the parser',
      filename: 'server/api/things.put.ts',
      code: `export default defineEventHandler(async (event) => schema.parse((await readBody(event)) satisfies unknown))`,
    },
  ],
  invalid: [
    {
      name: 'a TS cast does not launder JSON.parse into a validator',
      filename: 'server/api/things.post.ts',
      code: `export default defineEventHandler(async (event) => JSON.parse((await readBody(event)) as string))`,
      errors: [{ messageId: 'nonSchemaReceiver' }],
    },
    {
      name: 'typed but unvalidated body',
      filename: 'server/api/things.post.ts',
      code: `export default defineEventHandler(async (event) => {
        const body = (await readBody(event)) as { name: string }
        return save(body)
      })`,
      errors: [{ messageId: 'requireImmediateValidation' }],
    },
  ],
})
