import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/server/require-limit-on-drizzle-list-queries'

RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
})

ruleTester.run('require-limit-on-drizzle-list-queries', rule, {
  valid: [
    {
      name: 'bounded select chain',
      filename: 'server/api/things.get.ts',
      code: `export default defineEventHandler(async () => await db.select().from(things).limit(50))`,
    },
    {
      name: 'narrowed by primary key',
      filename: 'server/api/things.get.ts',
      code: `export default defineEventHandler(async () => await db.select().from(things).where(eq(things.id, id)))`,
    },
    {
      name: 'narrowed by primary key inside and()',
      filename: 'server/api/things.get.ts',
      code: `export default defineEventHandler(async () => await db.select().from(things).where(and(eq(things.id, id), eq(things.orgId, org))))`,
    },
    {
      name: 'narrowed by inArray on the primary key',
      filename: 'server/api/things.get.ts',
      code: `export default defineEventHandler(async () => await db.select().from(things).where(inArray(things.id, ids)))`,
    },
    {
      name: 'AGGREGATE — count projection needs no limit',
      filename: 'server/api/stats.get.ts',
      code: `export default defineEventHandler(async () => await db.select({ total: count() }).from(things))`,
    },
    {
      name: 'AGGREGATE — sql count template needs no limit',
      filename: 'server/api/stats.get.ts',
      code: `export default defineEventHandler(async () => await db.select({ total: sql\`count(*)\` }).from(things))`,
    },
    {
      name: 'AGGREGATE — groupBy collapses the result set',
      filename: 'server/api/stats.get.ts',
      code: `export default defineEventHandler(async () => await db.select({ orgId: things.orgId, total: count() }).from(things).groupBy(things.orgId))`,
    },
    {
      name: 'findFirst is single-row',
      filename: 'server/api/things.get.ts',
      code: `export default defineEventHandler(async () => await db.query.things.findFirst({ where: eq(things.slug, slug) }))`,
    },
    {
      name: 'findMany with a limit option',
      filename: 'server/api/things.get.ts',
      code: `export default defineEventHandler(async () => await db.query.things.findMany({ limit: 100 }))`,
    },
    {
      name: 'findMany narrowed by primary key',
      filename: 'server/api/things.get.ts',
      code: `export default defineEventHandler(async () => await db.query.things.findMany({ where: eq(things.id, id) }))`,
    },
    {
      name: 'an unrelated repository findMany is not a drizzle relational query',
      filename: 'server/api/things.get.ts',
      code: `export default defineEventHandler(async () => await repo.findMany())`,
    },
    {
      name: 'bounded .all() terminal',
      filename: 'server/api/things.get.ts',
      code: `export default defineEventHandler(() => db.select().from(things).limit(20).all())`,
    },
    {
      name: 'single-row terminals',
      filename: 'server/api/things.get.ts',
      code: `export default defineEventHandler(async () => await db.select().from(things).where(eq(things.id, id)).get())`,
    },
    {
      name: 'not a server route',
      filename: 'app/composables/useThings.ts',
      code: `export const list = async () => await db.select().from(things)`,
    },
    {
      name: 'a route suite in a test DIRECTORY is still exempt',
      filename: 'tests/server/api/things.get.ts',
      code: `export default defineEventHandler(async () => await db.select().from(things))`,
    },

    /* ---------------- resolved receivers (adversarial 4) ------------------- */
    {
      name: 'a destructured query alias with a limit is bounded',
      filename: 'server/api/things.get.ts',
      code: `const { things } = db.query
        export default defineEventHandler(async () => things.findMany({ limit: 50 }))`,
    },
    {
      name: 'a table alias with a primary-key where is bounded',
      filename: 'server/api/things.get.ts',
      code: `const table = db.query.things
        export default defineEventHandler(async () => table.findMany({ where: eq(things.id, id) }))`,
    },
    {
      name: 'an alias off an unrelated object is not a drizzle relational query',
      filename: 'server/api/things.get.ts',
      code: `const { things } = repository
        export default defineEventHandler(async () => things.findMany())`,
    },
    {
      name: 'a limit of zero is still an explicit bound',
      filename: 'server/api/things.get.ts',
      code: `export default defineEventHandler(async () => db.query.things.findMany({ limit: 0 }))`,
    },
    {
      name: 'a computed limit is still a bound',
      filename: 'server/api/things.get.ts',
      code: `export default defineEventHandler(async () => db.query.things.findMany({ limit: pageSize }))`,
    },
  ],

  invalid: [
    {
      name: 'REVIEW REGRESSION — db.query.<table>.findMany() was never checked by v1',
      filename: 'server/api/things.get.ts',
      code: `export default defineEventHandler(async () => await db.query.things.findMany())`,
      errors: [{ messageId: 'requireLimitOption' }],
    },
    {
      name: 'REVIEW REGRESSION — findMany with a non-primary-key where',
      filename: 'server/api/things.get.ts',
      code: `export default defineEventHandler(async () => await db.query.things.findMany({ where: eq(things.orgId, orgId) }))`,
      errors: [{ messageId: 'requireLimitOption' }],
    },
    {
      name: 'REVIEW REGRESSION — findMany with only ordering',
      filename: 'server/api/things.get.ts',
      code: `export default defineEventHandler(async () => await db.query.things.findMany({ orderBy: desc(things.createdAt) }))`,
      errors: [{ messageId: 'requireLimitOption' }],
    },
    {
      name: 'unbounded select chain',
      filename: 'server/api/things.get.ts',
      code: `export default defineEventHandler(async () => await db.select().from(things))`,
      errors: [{ messageId: 'requireLimit' }],
    },
    {
      name: 'unbounded select with a non-primary-key filter',
      filename: 'server/api/things.get.ts',
      code: `export default defineEventHandler(async () => await db.select().from(things).where(eq(things.orgId, orgId)))`,
      errors: [{ messageId: 'requireLimit' }],
    },
    {
      name: 'unbounded .all() terminal',
      filename: 'server/api/things.get.ts',
      code: `export default defineEventHandler(() => db.select().from(things).all())`,
      errors: [{ messageId: 'requireLimit' }],
    },
    {
      name: 'unbounded chain returned directly',
      filename: 'server/routes/things.ts',
      code: `export default defineEventHandler(() => { return db.select().from(things) })`,
      errors: [{ messageId: 'requireLimit' }],
    },
    {
      name: 'unbounded chain as an implicit arrow return',
      filename: 'server/api/things.get.ts',
      code: `export default defineEventHandler(() => db.select().from(things))`,
      errors: [{ messageId: 'requireLimit' }],
    },
    {
      name: 'absolute filename behaves identically',
      filename: '/Users/dev/app/server/api/things.get.ts',
      code: `export default defineEventHandler(async () => await db.query.things.findMany())`,
      errors: [{ messageId: 'requireLimitOption' }],
    },

    /* ------------- ADVERSARIAL 4: aliased receiver, undefined limit -------- */
    {
      // One destructuring line removed the `.query.` segment the shape test
      // required, and the query went unchecked.
      name: 'a destructured query alias is still an unbounded findMany',
      filename: 'server/api/findmany-alias.get.ts',
      code: `const { users } = db.query

        export default defineEventHandler(async () => users.findMany())`,
      errors: [{ messageId: 'requireLimitOption' }],
    },
    {
      name: 'a table alias is still an unbounded findMany',
      filename: 'server/api/things.get.ts',
      code: `const table = db.query.things
        export default defineEventHandler(async () => table.findMany())`,
      errors: [{ messageId: 'requireLimitOption' }],
    },
    {
      // `limit: undefined` is drizzle's "no limit" — the key's presence was
      // being read as the guarantee.
      name: 'an explicit undefined limit is no limit',
      filename: 'server/api/findmany-undefined-limit.get.ts',
      code: `export default defineEventHandler(async () => db.query.users.findMany({ limit: undefined }))`,
      errors: [{ messageId: 'requireLimitOption' }],
    },
    {
      name: 'a void 0 limit is no limit',
      filename: 'server/api/things.get.ts',
      code: `export default defineEventHandler(async () => db.query.things.findMany({ limit: void 0 }))`,
      errors: [{ messageId: 'requireLimitOption' }],
    },

    /* ------------- ADVERSARIAL 6: `.test.` infix on a live route ----------- */
    {
      name: 'a .test. infix in a deployed route filename does not exempt it',
      filename: 'server/api/report.test.get.ts',
      code: `export default defineEventHandler(async () => db.query.things.findMany())`,
      errors: [{ messageId: 'requireLimitOption' }],
    },
  ],
})
