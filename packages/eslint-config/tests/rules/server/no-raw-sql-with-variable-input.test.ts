import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/server/no-raw-sql-with-variable-input'

RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
})

/**
 * Deep review proof 10. v1 asserted the FIRST valid case below as *invalid*:
 * it reported drizzle's parameter-bound sql`` interpolation as an injection
 * vector, while `import * as d from 'drizzle-orm'; d.sql.raw(x)` and a barrel
 * re-export both escaped. Both polarities are pinned here.
 */
ruleTester.run('no-raw-sql-with-variable-input', rule, {
  valid: [
    /* ---- PROOF 10: parameter binding is the SAFE canonical form ---- */
    {
      name: 'PROOF 10 — drizzle sql`` interpolation binds a parameter and is SAFE',
      filename: 'server/api/users.get.ts',
      code: `import { sql } from 'drizzle-orm'
        export const q = sql\`SELECT * FROM users WHERE id = \${userId}\``,
    },
    {
      name: 'PROOF 10 — multiple interpolations are still parameter-bound',
      filename: 'server/api/users.get.ts',
      code: `import { sql } from 'drizzle-orm'
        export const q = sql\`SELECT * FROM t WHERE a = \${a} AND b = \${b} LIMIT \${limit}\``,
    },
    {
      name: 'PROOF 10 — aliased import, still a template, still safe',
      filename: 'server/api/users.get.ts',
      code: `import { sql as s } from 'drizzle-orm'
        export const q = s\`SELECT * FROM users WHERE id = \${userId}\``,
    },
    {
      name: 'sql.identifier() interpolation is safe',
      filename: 'server/api/users.get.ts',
      code: `import { sql } from 'drizzle-orm'
        export const q = sql\`SELECT * FROM \${sql.identifier(table)}\``,
    },

    /* ---- sql.raw with constant input is fine ---- */
    {
      name: 'sql.raw with a string literal',
      filename: 'server/api/users.get.ts',
      code: `import { sql } from 'drizzle-orm'
        export const q = sql.raw('SELECT 1')`,
    },
    {
      name: 'sql.raw with an expression-free template literal',
      filename: 'server/api/users.get.ts',
      code: `import { sql } from 'drizzle-orm'
        export const q = sql.raw(\`SELECT 1\`)`,
    },

    /* ---- receivers that are not drizzle's sql ---- */
    {
      name: 'a locally declared object named sql is not drizzle',
      filename: 'server/api/users.get.ts',
      code: `const sql = { raw: (value) => value }
        export const q = sql.raw(userInput)`,
    },
    {
      name: 'an unrelated .raw() call',
      filename: 'server/api/users.get.ts',
      code: `import { logger } from '../utils/logger'
        logger.raw(userInput)`,
    },
    {
      name: 'a shadowing parameter named sql',
      filename: 'server/api/users.get.ts',
      code: `import { sql } from 'drizzle-orm'
        export function run(sql) { return sql.raw(userInput) }`,
    },
    {
      name: 'a namespace import from an unrelated module',
      filename: 'server/api/users.get.ts',
      code: `import * as helpers from '../utils/helpers'
        helpers.sql.raw(userInput)`,
    },
    {
      name: 'auto-imported sql treated as drizzle only when opted out',
      filename: 'server/api/users.get.ts',
      options: [{ treatAutoImportedSqlAsDrizzle: false }],
      code: `export const q = sql.raw(userInput)`,
    },
    {
      name: 'barrel re-export treated as drizzle only when opted out',
      filename: 'server/api/users.get.ts',
      options: [{ treatUnknownSqlImportsAsDrizzle: false }],
      code: `import { sql } from '../../utils/db'
        export const q = sql.raw(userInput)`,
    },
    {
      name: 'test files are skipped',
      filename: 'tests/server/queries.test.ts',
      code: `import { sql } from 'drizzle-orm'
        export const q = sql.raw(userInput)`,
    },

    /* ---- extracted `.raw` bindings that are NOT drizzle's (adversarial 3) ---- */
    {
      name: 'raw destructured off a local helper object is not drizzle',
      filename: 'server/api/users.get.ts',
      code: `const sql = { raw: (value) => value }
        const { raw } = sql
        export const q = raw(userInput)`,
    },
    {
      name: 'raw lifted off an unrelated module namespace is not drizzle',
      filename: 'server/api/users.get.ts',
      code: `import * as helpers from '../utils/helpers'
        const rawText = helpers.raw
        export const q = rawText(userInput)`,
    },
    {
      name: 'an extracted drizzle raw with a constant argument is still safe',
      filename: 'server/api/users.get.ts',
      code: `import { sql } from 'drizzle-orm'
        const rawSql = sql.raw
        export const q = rawSql('select 1')`,
    },
    {
      name: 'a reassigned binding is not followed to drizzle',
      filename: 'server/api/users.get.ts',
      code: `import { sql } from 'drizzle-orm'
        let rawSql = sql.raw
        rawSql = harmlessFormatter
        export const q = rawSql(userInput)`,
    },
  ],

  invalid: [
    /* ---- PROOF 10: the vectors v1 missed ---- */
    {
      name: 'PROOF 10 — namespace import: d.sql.raw(variable)',
      filename: 'server/api/users.get.ts',
      code: `import * as d from 'drizzle-orm'
        export const q = d.sql.raw(userInput)`,
      errors: [{ messageId: 'rawWithVariableInput' }],
    },
    {
      name: 'PROOF 10 — barrel re-export: sql imported from a project util',
      filename: 'server/api/users.get.ts',
      code: `import { sql } from '../../utils/db'
        export const q = sql.raw(userInput)`,
      errors: [{ messageId: 'rawWithVariableInput' }],
    },
    {
      name: 'PROOF 10 — aliased named import: s.raw(variable)',
      filename: 'server/api/users.get.ts',
      code: `import { sql as s } from 'drizzle-orm'
        export const q = s.raw(userInput)`,
      errors: [{ messageId: 'rawWithVariableInput' }],
    },
    {
      name: 'PROOF 10 — auto-imported sql (Nuxt/Nitro), unresolved binding',
      filename: 'server/api/users.get.ts',
      code: `export const q = sql.raw(userInput)`,
      errors: [{ messageId: 'rawWithVariableInput' }],
    },

    /* ---- the plain vectors ---- */
    {
      name: 'sql.raw with a bare identifier',
      filename: 'server/api/users.get.ts',
      code: `import { sql } from 'drizzle-orm'
        export const q = sql.raw(order)`,
      errors: [{ messageId: 'rawWithVariableInput' }],
    },
    {
      name: 'sql.raw with an interpolated template',
      filename: 'server/api/users.get.ts',
      code: `import { sql } from 'drizzle-orm'
        export const q = sql.raw(\`ORDER BY \${column}\`)`,
      errors: [{ messageId: 'rawWithVariableInput' }],
    },
    {
      name: 'sql.raw with string concatenation',
      filename: 'server/api/users.get.ts',
      code: `import { sql } from 'drizzle-orm'
        export const q = sql.raw('ORDER BY ' + column)`,
      errors: [{ messageId: 'rawWithVariableInput' }],
    },
    {
      name: 'sql.raw with a member expression',
      filename: 'server/api/users.get.ts',
      code: `import { sql } from 'drizzle-orm'
        export const q = sql.raw(query.orderBy)`,
      errors: [{ messageId: 'rawWithVariableInput' }],
    },
    {
      name: 'sql.raw inside a drizzle template still reports once',
      filename: 'server/api/users.get.ts',
      code: `import { sql } from 'drizzle-orm'
        export const q = sql\`SELECT * FROM t ORDER BY \${sql.raw(column)}\``,
      errors: [{ messageId: 'rawWithVariableInput' }],
    },
    {
      name: 'drizzle subpath import',
      filename: 'server/api/users.get.ts',
      code: `import { sql } from 'drizzle-orm/sql'
        export const q = sql.raw(userInput)`,
      errors: [{ messageId: 'rawWithVariableInput' }],
    },
    {
      name: 'still fires when the config DECLARES sql as an auto-import global',
      filename: 'server/api/users.get.ts',
      languageOptions: { globals: { sql: 'readonly' } },
      code: `export const q = sql.raw(userInput)`,
      errors: [{ messageId: 'rawWithVariableInput' }],
    },
    {
      name: 'fires outside server routes too — SQL injection is not path-scoped',
      filename: 'app/utils/reports.ts',
      code: `import { sql } from 'drizzle-orm'
        export const q = sql.raw(userInput)`,
      errors: [{ messageId: 'rawWithVariableInput' }],
    },

    /* ------------- ADVERSARIAL 3: `.raw` lifted out of the call shape ------ */
    {
      // Both of these produced zero diagnostics: the rule matched the
      // `<receiver>.raw(…)` member shape, and one line removes that shape.
      name: 'destructured raw: const { raw: rawSql } = sql',
      filename: 'server/api/sql-destructure.post.ts',
      code: `import { sql } from 'drizzle-orm'

        const { raw: rawSql } = sql
        const requestControlledSql = userInput

        export default definePublicMutation(async () => rawSql(requestControlledSql))`,
      errors: [{ messageId: 'rawWithVariableInput' }],
    },
    {
      name: 'property-renamed raw: const rawSql = sql.raw',
      filename: 'server/api/sql-property-rename.post.ts',
      code: `import { sql } from 'drizzle-orm'

        const rawSql = sql.raw
        const requestControlledSql = userInput

        export default definePublicMutation(async () => rawSql(requestControlledSql))`,
      errors: [{ messageId: 'rawWithVariableInput' }],
    },
    {
      name: 'shorthand destructured raw: const { raw } = sql',
      filename: 'server/api/users.get.ts',
      code: `import { sql } from 'drizzle-orm'
        const { raw } = sql
        export const q = raw(userInput)`,
      errors: [{ messageId: 'rawWithVariableInput' }],
    },
    {
      name: 'raw extracted from an aliased sql binding',
      filename: 'server/api/users.get.ts',
      code: `import { sql } from 'drizzle-orm'
        const builder = sql
        const rawSql = builder.raw
        export const q = rawSql(userInput)`,
      errors: [{ messageId: 'rawWithVariableInput' }],
    },
    {
      name: 'raw extracted from a drizzle namespace member',
      filename: 'server/api/users.get.ts',
      code: `import * as d from 'drizzle-orm'
        const rawSql = d.sql.raw
        export const q = rawSql(userInput)`,
      errors: [{ messageId: 'rawWithVariableInput' }],
    },
    {
      name: 'raw extracted from an auto-imported sql',
      filename: 'server/api/users.get.ts',
      code: `const { raw } = sql
        export const q = raw(userInput)`,
      errors: [{ messageId: 'rawWithVariableInput' }],
    },

    /* ------------- ADVERSARIAL 6: `.test.` infix on a live route ----------- */
    {
      name: 'a .test. infix in a deployed route filename does not exempt it',
      filename: 'server/api/deploy.test.post.ts',
      code: `const untrustedSql = getQuery(event).statement

        export default defineEventHandler(async () => sql.raw(untrustedSql))`,
      errors: [{ messageId: 'rawWithVariableInput' }],
    },
  ],
})
