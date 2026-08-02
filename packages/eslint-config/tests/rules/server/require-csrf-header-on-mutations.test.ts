import { Linter, RuleTester } from 'eslint'
import { describe, expect, it } from 'vitest'

import rule from '../../../src/rules/server/require-csrf-header-on-mutations'

RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
})

/**
 * Every case below runs through the REAL filename gate. v1 passed
 * `testMode: true` on 18 of 19 cases, which is exactly how a rule that matched
 * zero files shipped green at 'error' (deep review, proof 9).
 */
ruleTester.run('require-csrf-header-on-mutations', rule, {
  valid: [
    /* ---------------- server mode: satisfied ---------------- */
    {
      name: 'reads the CSRF header via getHeader',
      filename: 'server/api/thing.post.ts',
      code: `export default defineEventHandler(async (event) => {
        const requestedWith = getHeader(event, 'x-requested-with')
        if (requestedWith !== 'XMLHttpRequest') throw createError({ statusCode: 403 })
        return save(await readBody(event))
      })`,
    },
    {
      name: 'reads the CSRF header via getRequestHeader with different casing',
      filename: 'server/api/thing.put.ts',
      code: `export default defineEventHandler((event) => getRequestHeader(event, 'X-Requested-With'))`,
    },
    {
      name: 'reads the CSRF header off event.headers',
      filename: 'server/api/thing.patch.ts',
      code: `export default defineEventHandler((event) => event.headers.get('x-csrf-token'))`,
    },
    {
      name: 'declared with an approved mutation wrapper',
      filename: 'server/api/thing.post.ts',
      code: `export default defineUserMutation(async (event) => save(await readBody(event)))`,
    },
    {
      name: 'delegates to a CSRF helper',
      filename: 'server/api/thing.delete.ts',
      code: `export default defineEventHandler(async (event) => { assertCsrf(event); return remove(event) })`,
    },
    {
      name: 'delegates to a namespaced CSRF helper',
      filename: 'server/routes/thing.post.ts',
      code: `export default defineEventHandler(async (event) => { security.requireCsrfToken(event); return 1 })`,
    },

    /* ---------------- server mode: out of scope ---------------- */
    {
      name: 'declared read-only route',
      filename: 'server/api/thing.get.ts',
      code: `export default defineEventHandler(async (event) => list(event))`,
    },
    {
      name: 'method-less route with no declared mutation',
      filename: 'server/api/thing.ts',
      code: `export default defineEventHandler(async (event) => list(event))`,
    },
    {
      name: 'CSRF-exempt webhook route (guarded by no-csrf-exempt-route-misuse)',
      filename: 'server/api/webhooks/stripe.post.ts',
      code: `export default defineEventHandler(async (event) => save(await readBody(event)))`,
    },
    {
      name: 'server utility file, not a route',
      filename: 'server/utils/db.ts',
      code: `export const save = async (body) => body`,
    },
    {
      name: 'a route suite in a test DIRECTORY is still exempt',
      filename: 'tests/server/api/thing.post.ts',
      code: `export default defineEventHandler(async (event) => save(await readBody(event)))`,
    },

    /* ---------------- client mode ---------------- */
    {
      name: 'client mutation with an explicit CSRF header',
      filename: 'app/composables/useApi.ts',
      code: `export const create = (payload) => $fetch('/api/things', {
        method: 'POST',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })`,
    },
    {
      name: 'client mutation spreading a CSRF-looking header source',
      filename: 'app/composables/useApi.ts',
      code: `export const create = (payload) => $fetch('/api/things', { method: 'POST', headers: { ...csrfHeaders } })`,
    },
    {
      name: 'client mutation passing a CSRF helper result',
      filename: 'app/stores/things.ts',
      code: `export const create = () => $fetch('/api/things', { method: 'POST', headers: useCsrfHeaders() })`,
    },
    {
      name: 'client GET needs no CSRF header',
      filename: 'app/composables/useApi.ts',
      code: `export const list = () => $fetch('/api/things', { method: 'GET' })`,
    },
    {
      name: 'client call with no method option',
      filename: 'app/composables/useApi.ts',
      code: `export const list = () => $fetch('/api/things')`,
    },
    {
      name: 'client mutation through useCsrfFetch is untouched',
      filename: 'app/composables/useApi.ts',
      code: `export const create = () => useCsrfFetch('/api/things', { method: 'POST' })`,
    },
    {
      name: 'a component is neither server nor client scope in auto mode',
      filename: 'app/components/Thing.vue.ts',
      code: `export const create = () => $fetch('/api/things', { method: 'POST' })`,
    },
  ],

  invalid: [
    /* --------- proof 9: the rule now fires on a REAL route path --------- */
    {
      name: 'PROOF 9 — mutation route with no CSRF verification at all',
      filename: 'server/api/thing.post.ts',
      code: `export default defineEventHandler(async (event) => {
        const body = await readBody(event)
        return save(body)
      })`,
      errors: [{ messageId: 'routeMissingCsrfCheck' }],
    },
    {
      name: 'PROOF 9 — same, absolute filename',
      filename: '/Users/dev/app/server/api/thing.post.ts',
      code: `export default defineEventHandler(async (event) => save(await readBody(event)))`,
      errors: [{ messageId: 'routeMissingCsrfCheck' }],
    },
    {
      name: 'server/routes/** is covered too (v1 saw only server/api)',
      filename: 'server/routes/thing.delete.ts',
      code: `export default defineEventHandler(async (event) => remove(event))`,
      errors: [{ messageId: 'routeMissingCsrfCheck' }],
    },
    {
      name: 'a rename cannot disable the rule — the handler still declares POST',
      filename: 'server/api/create-thing.ts',
      code: `export default defineEventHandler(async (event) => {
        assertMethod(event, 'POST')
        return save(await readBody(event))
      })`,
      errors: [{ messageId: 'routeMissingCsrfCheck' }],
    },
    {
      name: 'reading an unrelated header does not satisfy the rule',
      filename: 'server/api/thing.post.ts',
      code: `export default defineEventHandler(async (event) => {
        const ua = getHeader(event, 'user-agent')
        return save(ua)
      })`,
      errors: [{ messageId: 'routeMissingCsrfCheck' }],
    },
    {
      name: 'raw defineEventHandler with a rate limit but no CSRF check',
      filename: 'server/api/orgs/[id]/members.put.ts',
      code: `export default defineEventHandler(async (event) => {
        await enforceRateLimit(event)
        return update(await readBody(event))
      })`,
      errors: [{ messageId: 'routeMissingCsrfCheck' }],
    },

    /* ---------------- client mode ---------------- */
    {
      name: 'client mutation with no headers at all',
      filename: 'app/composables/useApi.ts',
      code: `export const create = (payload) => $fetch('/api/things', { method: 'POST', body: payload })`,
      errors: [{ messageId: 'clientMissingCsrf' }],
    },
    {
      name: 'client mutation with a generic header spread is not trusted',
      filename: 'app/composables/useApi.ts',
      code: `export const create = () => $fetch('/api/things', { method: 'POST', headers: { ...otherHeaders } })`,
      errors: [{ messageId: 'clientMissingCsrf' }],
    },
    {
      name: 'client mutation with unrelated headers',
      filename: 'app/stores/things.ts',
      code: `export const remove = (id) => $fetch('/api/things', { method: 'DELETE', headers: { Accept: 'application/json' } })`,
      errors: [{ messageId: 'clientMissingCsrf' }],
    },
    {
      name: '$fetch.raw mutation is covered',
      filename: 'app/composables/useApi.ts',
      code: `export const create = () => $fetch.raw('/api/things', { method: 'PATCH' })`,
      errors: [{ messageId: 'clientMissingCsrf' }],
    },
    {
      name: 'explicit client mode on a file outside the default scopes',
      filename: 'app/lib/api.ts',
      options: [{ mode: 'client' }],
      code: `export const create = () => $fetch('/api/things', { method: 'POST' })`,
      errors: [{ messageId: 'clientMissingCsrf' }],
    },
  ],
})

/**
 * PROOF 9, end to end.
 *
 * The v1 defect was not in the matcher — it was that the rule's internal path
 * gate (`app/composables/`) and the glob it was attached to (`server/**`) had an
 * EMPTY intersection, so the rule reported on no file in any real project while
 * its own suite passed. RuleTester cannot catch that class of bug, because it
 * bypasses config globs entirely.
 *
 * These cases lint through a real flat config carrying the same glob the `auth`
 * capability pack uses, and assert the intersection is non-empty.
 */
describe('require-csrf-header-on-mutations — config glob ∩ rule gate', () => {
  // Mirrors SERVER_FILE_GLOBS in configs/server.mjs, which configs/auth.mjs
  // attaches this rule to. Inlined because importing the pack would pull in
  // ../dist/index.js, which is a build artifact.
  const SERVER_FILE_GLOBS = ['server/**/*.{js,cjs,mjs,jsx,ts,cts,mts,tsx}']

  const lint = (code: string, filename: string) =>
    new Linter()
      .verify(
        code,
        [
          {
            files: SERVER_FILE_GLOBS,
            plugins: { narduk: { rules: { 'require-csrf-header-on-mutations': rule } } },
            languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
            rules: { 'narduk/require-csrf-header-on-mutations': 'error' },
          },
        ],
        filename,
      )
      // A file matching no config entry yields an informational message with a
      // null ruleId; only this rule's own reports are the subject here.
      .filter((message) => message.ruleId === 'narduk/require-csrf-header-on-mutations')

  const unguarded = `export default defineEventHandler(async (event) => save(await readBody(event)))`

  it('reports on a real mutation route reached through the pack glob', () => {
    const messages = lint(unguarded, 'server/api/thing.post.ts')
    expect(messages).toHaveLength(1)
    expect(messages[0]?.messageId).toBe('routeMissingCsrfCheck')
  })

  it('reports on a server/routes mutation route too', () => {
    expect(lint(unguarded, 'server/routes/thing.post.ts')).toHaveLength(1)
  })

  it('reports on a renamed route whose handler still declares POST', () => {
    const code = `export default defineEventHandler(async (event) => {
      assertMethod(event, 'POST')
      return save(await readBody(event))
    })`
    expect(lint(code, 'server/api/create-thing.ts')).toHaveLength(1)
  })

  it('stays silent on a read-only route inside the same glob', () => {
    expect(
      lint(`export default defineEventHandler((event) => list(event))`, 'server/api/thing.get.ts'),
    ).toHaveLength(0)
  })

  it('stays silent on a file outside the glob', () => {
    expect(lint(unguarded, 'app/composables/useThing.ts')).toHaveLength(0)
  })
})
