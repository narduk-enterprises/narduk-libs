import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/server/no-raw-define-event-handler-in-mutation-routes'

RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
})

ruleTester.run('no-raw-define-event-handler-in-mutation-routes', rule, {
  valid: [
    {
      name: 'approved user mutation wrapper',
      filename: 'server/api/things.post.ts',
      code: `export default defineUserMutation(async (event) => save(event))`,
    },
    {
      name: 'approved admin mutation wrapper',
      filename: 'server/api/things.delete.ts',
      code: `export default defineAdminMutation(async (event) => remove(event))`,
    },
    {
      name: 'a raw handler composed inside an approved wrapper is the wrapper composition',
      filename: 'server/api/things.post.ts',
      code: `export default defineWebhookMutation(defineEventHandler(async (event) => save(event)))`,
    },
    {
      name: 'read-only route may use a raw handler',
      filename: 'server/api/things.get.ts',
      code: `export default defineEventHandler(async (event) => list(event))`,
    },
    {
      name: 'method-less route is not assumed to be a mutation',
      filename: 'server/api/things.ts',
      code: `export default defineEventHandler(async (event) => list(event))`,
    },
    {
      name: 'not a server route',
      filename: 'server/utils/handlers.ts',
      code: `export const h = defineEventHandler(async (event) => event)`,
    },
    {
      name: 'a route suite in a test DIRECTORY is still exempt',
      filename: 'tests/server/api/things.post.ts',
      code: `export default defineEventHandler(async (event) => save(event))`,
    },
    {
      name: 'a route suite under __tests__ is still exempt',
      filename: 'server/api/__tests__/things.post.ts',
      code: `export default defineEventHandler(async (event) => save(event))`,
    },

    /* ------------ aliased handler-defining calls (adversarial 1) ------------ */
    {
      name: 'an aliased APPROVED wrapper is still the wrapper',
      filename: 'server/api/things.post.ts',
      code: `const mutate = defineUserMutation
        export default mutate(async (event) => save(event))`,
    },
    {
      name: 'a raw handler aliased inside an aliased approved wrapper is composition',
      filename: 'server/api/things.post.ts',
      code: `const wrap = defineWebhookMutation
        export default wrap(defineEventHandler(async (event) => save(event)))`,
    },
    {
      name: 'a reassigned binding is not followed as an alias',
      filename: 'server/api/things.get.ts',
      code: `let handler = defineEventHandler
        handler = somethingElse
        export default handler(async (event) => list(event))`,
    },

    /* --------------- determinate methods (adversarial 2) -------------------- */
    {
      name: 'a method-suffixed filename settles the method even with a dynamic compare',
      filename: 'server/api/things.get.ts',
      code: `const method = ['POST'][0]
        export default defineEventHandler(async (event) => {
          if (getMethod(event) === method) return { mutated: true }
          return { read: true }
        })`,
    },
    {
      name: 'a module-local string constant is a readable method',
      filename: 'server/api/things.ts',
      code: `const READ = 'GET'
        export default defineEventHandler(async (event) => {
          if (getMethod(event) === READ) return list(event)
          return null
        })`,
    },
    {
      name: 'a wrapper makes the ambiguity moot',
      filename: 'server/api/things.ts',
      code: `const method = ['POST'][0]
        export default definePublicMutation(async (event) => {
          if (getMethod(event) === method) return save(event)
          return null
        })`,
    },
    {
      name: 'a raw handler behind a TS cast inside an approved wrapper is composition',
      filename: 'server/api/things.post.ts',
      code: `export default defineWebhookMutation(defineEventHandler(async (event) => save(event)) as any)`,
      languageOptions: { parser: tsParser },
    },
  ],

  invalid: [
    {
      name: 'a raw handler declared inside a wrapped route callback is not composition (#886)',
      filename: 'server/api/things.post.ts',
      code: `export default defineUserMutation(async (event) => {
        const legacy = defineEventHandler(async (e) => deleteEverything(e))
        return legacy(event)
      })`,
      errors: [{ messageId: 'useMutationWrapper' }],
    },
    {
      name: 'a raw handler returned from a function passed to an approved wrapper is reported (#886)',
      filename: 'server/api/things.post.ts',
      code: `export default defineUserMutation(function build() { return defineEventHandler(save) })`,
      errors: [{ messageId: 'useMutationWrapper' }],
    },
    {
      name: 'raw defineEventHandler in a POST route',
      filename: 'server/api/things.post.ts',
      code: `export default defineEventHandler(async (event) => save(event))`,
      errors: [{ messageId: 'useMutationWrapper' }],
    },
    {
      name: 'server/routes/** is covered (v1 saw only server/api)',
      filename: 'server/routes/things.delete.ts',
      code: `export default defineEventHandler(async (event) => remove(event))`,
      errors: [{ messageId: 'useMutationWrapper' }],
    },
    {
      name: 'a rename cannot disable it — handler declares PATCH',
      filename: 'server/api/update-thing.ts',
      code: `export default defineEventHandler(async (event) => {
        assertMethod(event, 'PATCH')
        return update(event)
      })`,
      errors: [{ messageId: 'useMutationWrapper' }],
    },
    {
      name: 'eventHandler alias is covered',
      filename: 'server/api/things.put.ts',
      code: `export default eventHandler(async (event) => save(event))`,
      errors: [{ messageId: 'useMutationWrapper' }],
    },
    {
      name: 'defineCachedEventHandler is covered',
      filename: 'server/api/things.post.ts',
      code: `export default defineCachedEventHandler(async (event) => save(event))`,
      errors: [{ messageId: 'useMutationWrapper' }],
    },
    {
      name: 'absolute filename behaves identically',
      filename: '/Users/dev/app/server/api/things.post.ts',
      code: `export default defineEventHandler(async (event) => save(event))`,
      errors: [{ messageId: 'useMutationWrapper' }],
    },

    /* ------------- ADVERSARIAL 1: aliased raw handler ---------------------- */
    {
      // `const handler = defineEventHandler` drew zero diagnostics from this
      // rule and from require-enforce-rate-limit-on-mutations.
      name: 'an aliased raw defineEventHandler is still a raw handler',
      filename: 'server/api/aliased-handler.post.ts',
      code: `const handler = defineEventHandler

        export default handler(async (event) => {
          getHeader(event, 'x-requested-with')
          return { ok: true }
        })`,
      errors: [{ messageId: 'useMutationWrapper' }],
    },
    {
      name: 'a two-hop alias chain is still a raw handler',
      filename: 'server/api/things.post.ts',
      code: `const inner = eventHandler
        const outer = inner
        export default outer(async (event) => save(event))`,
      errors: [{ messageId: 'useMutationWrapper' }],
    },

    /* ------------- ADVERSARIAL 2: indeterminate method --------------------- */
    {
      // The method is derived at runtime, so the shared gate cannot classify
      // the route and every rule that needs a proven mutation went silent.
      name: 'a dynamically derived method is reported as indeterminate',
      filename: 'server/api/dynamic-method.ts',
      code: `const method = ['POST'][0]

        export default defineEventHandler(async (event) => {
          if (getMethod(event) === method) return { mutated: true }
          return { read: true }
        })`,
      errors: [{ messageId: 'indeterminateMethod' }],
    },
    {
      name: 'an indeterminate switch discriminant is reported once, not per case',
      filename: 'server/api/dynamic-switch.ts',
      code: `export default defineEventHandler(async (event) => {
          switch (event.method) {
            case resolveMethod(): return a(event)
            case anotherMethod(): return b(event)
            default: return null
          }
        })`,
      errors: [{ messageId: 'indeterminateMethod' }],
    },
    {
      name: 'an indeterminate isMethod() list is reported',
      filename: 'server/api/dynamic-list.ts',
      code: `export default defineEventHandler(async (event) => {
          if (isMethod(event, allowedMethods)) return save(event)
          return null
        })`,
      errors: [{ messageId: 'indeterminateMethod' }],
    },

    /* ------------- ADVERSARIAL 6: `.test.` infix on a live route ----------- */
    {
      // Nitro deploys this as POST /api/deploy.test — the infix exemption used
      // to switch the whole security tier off for it.
      name: 'a .test. infix in a deployed route filename does not exempt it',
      filename: 'server/api/deploy.test.post.ts',
      code: `export default defineEventHandler(async (event) => save(event))`,
      errors: [{ messageId: 'useMutationWrapper' }],
    },
    {
      name: 'a .spec. infix in a deployed route filename does not exempt it',
      filename: 'server/routes/hooks.spec.put.ts',
      code: `export default defineEventHandler(async (event) => save(event))`,
      errors: [{ messageId: 'useMutationWrapper' }],
    },
  ],
})
