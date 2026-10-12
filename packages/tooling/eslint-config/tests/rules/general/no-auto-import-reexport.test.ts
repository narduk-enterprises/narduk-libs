import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import { afterAll, describe, it } from 'vitest'

import rule from '../../../src/rules/general/no-auto-import-reexport'

RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  },
})

const error = (names: string, source: string) => ({
  messageId: 'noAutoImportReexport' as const,
  data: { names, source },
})

/** A real app tree, so a `./dir` source can be told from a `./file`. */
const root = mkdtempSync(join(tmpdir(), 'narduk-auto-import-reexport-'))
mkdirSync(join(root, 'app/utils/market'), { recursive: true })
writeFileSync(join(root, 'app/utils/market/index.ts'), 'export function m() {}\n')
writeFileSync(join(root, 'app/utils/sibling.ts'), 'export function x() {}\n')
afterAll(() => rmSync(root, { force: true, recursive: true }))

ruleTester.run('no-auto-import-reexport', rule, {
  valid: [
    // --- not a named re-export ------------------------------------------------
    // `export *` is resolved to the origin file by unimport and deduped silently
    // (measured), so it is not a duplicate.
    { filename: 'app/utils/format.ts', code: "export * from './sibling'" },
    { filename: 'server/utils/db.ts', code: "export * from './sub/queries'" },
    // New names, not collisions.
    { filename: 'app/utils/format.ts', code: "export * as ns from './sibling'" },
    { filename: 'app/utils/format.ts', code: "export { x as renamed } from './sibling'" },
    { filename: 'app/utils/format.ts', code: "export { default as thing } from './sibling'" },
    { filename: 'app/utils/format.ts', code: "export { default } from './sibling'" },
    {
      filename: 'server/utils/accountDeletion.ts',
      code: "export { deleteBridge as deleteAccount } from './bridge'\nexport type { BridgeHooks as Hooks } from './bridge'",
    },
    // Local code, a plain import, a declaration.
    { filename: 'app/utils/format.ts', code: "import { x } from './sibling'\nexport { x }" },
    { filename: 'app/utils/format.ts', code: 'export function x() {}\nexport const y = 1' },
    { filename: 'app/utils/format.ts', code: 'export {}' },

    // --- the source is not an auto-imported file ------------------------------
    { filename: 'app/utils/format.ts', code: "export { x } from '../lib/x'" },
    { filename: 'app/utils/format.ts', code: "export type { T } from '../types/t'" },
    { filename: 'app/utils/format.ts', code: "export { z } from 'zod'" },
    { filename: 'app/utils/format.ts', code: "export { x } from '#narduk-auth/lib/x'" },
    { filename: 'app/utils/format.ts', code: "export { x } from '~/lib/x'" },
    { filename: 'app/composables/useThing.ts', code: "export { x } from '~/types/x'" },
    {
      filename: 'server/utils/listQuery.ts',
      code: "export { C } from '@scope/platform/list-query'",
    },
    { filename: 'server/utils/freshness.ts', code: "export { K } from '../health/freshness'" },
    // A nested file under the top-level-only directories is not scanned.
    { filename: 'app/utils/format.ts', code: "export { x } from './research/movers'" },
    { filename: 'shared/utils/portfolio.ts', code: "export { x } from './portfolio/aggregate'" },
    { filename: 'app/composables/useThing.ts', code: "export { x } from './helpers/lifecycle'" },
    // The two scan contexts do not meet: Nitro vs the app.
    { filename: 'server/utils/words.ts', code: "export { computeFeedback } from '~/utils/wordle'" },
    {
      filename: 'server/utils/words.ts',
      code: "export { useThing } from '~/composables/useThing'",
    },
    { filename: 'app/utils/format.ts', code: "export { db } from '~~/server/utils/db'" },
    { filename: 'app/utils/format.ts', code: "export { db } from '../../server/utils/db'" },

    // --- the file is not auto-imported ----------------------------------------
    { filename: 'app/utils/research/movers.ts', code: "export { x } from './sibling'" },
    { filename: 'app/utils/research/index.ts', code: "export { x } from './sibling'" },
    { filename: 'shared/utils/portfolio/index.ts', code: "export { x } from './other'" },
    { filename: 'app/composables/helpers/lifecycle.ts', code: "export { x } from './sibling'" },
    { filename: 'app/types/index.ts', code: "export { x } from './sibling'" },
    { filename: 'app/stores/main.ts', code: "export { x } from './sibling'" },
    { filename: 'server/api/things.get.ts', code: "export { x } from './sibling'" },
    { filename: 'server/plugins/boot.ts', code: "export { x } from './sibling'" },
    { filename: 'myapp/utils/format.ts', code: "export { x } from './sibling'" },
    { filename: 'packages/foo/composables/useThing.ts', code: "export { x } from './sibling'" },
    { filename: 'app/utils/format.d.ts', code: "export { x } from './sibling'" },
    { filename: 'app/utils/format.vue', code: "export { x } from './sibling'" },
    // Test and fixture code.
    { filename: 'tests/app/utils/format.ts', code: "export { x } from './sibling'" },
    { filename: 'app/utils/__fixtures__/format.ts', code: "export { x } from './sibling'" },

    // --- a directory source is its index, which is not scanned ----------------
    {
      filename: join(root, 'app/utils/barrel.ts'),
      code: "export { m } from './market'",
    },
  ],

  invalid: [
    // --- the operator-portal shape -------------------------------------------
    {
      filename: 'app/utils/format.ts',
      code: "export { x } from './sibling'",
      errors: [error('x', './sibling')],
    },
    {
      filename: 'server/utils/provider-spend.ts',
      code: "export { A, B, scrub } from './provider-http'",
      errors: [error('A, B, scrub', './provider-http')],
    },
    // Type-only re-exports collide too (measured).
    {
      filename: 'app/utils/format.ts',
      code: "export type { T } from './sibling'",
      errors: [error('T', './sibling')],
    },
    {
      filename: 'server/utils/seed.ts',
      code: "export { type Entry, type Tier } from './seed.types'",
      errors: [error('Entry, Tier', './seed.types')],
    },
    // Mixed with an alias: the unaliased name still collides.
    {
      filename: 'app/utils/format.ts',
      code: "export { x, y as z } from './sibling'",
      errors: [error('x', './sibling')],
    },
    // A string-literal specifier is still a name.
    {
      filename: 'app/utils/format.ts',
      code: "export { 'x' as 'x' } from './sibling'",
      errors: [error('x', './sibling')],
    },

    // --- every scanned directory ----------------------------------------------
    {
      filename: 'app/composables/useThing.ts',
      code: "export { useOther } from './useOther'",
      errors: [error('useOther', './useOther')],
    },
    {
      filename: 'shared/utils/slug.ts',
      code: "export { slugify } from './text'",
      errors: [error('slugify', './text')],
    },

    // --- server/utils is scanned recursively -----------------------------------
    {
      filename: 'server/utils/top.ts',
      code: "export { nested } from './sub/n'",
      errors: [error('nested', './sub/n')],
    },
    {
      filename: 'server/utils/crypto/index.ts',
      code: "export { sign } from './aad'",
      errors: [error('sign', './aad')],
    },
    {
      filename: 'server/utils/db/queries/users.ts',
      code: "export { other } from '../other'",
      errors: [error('other', '../other')],
    },

    // --- across scanned directories that share a context -------------------------
    {
      filename: 'app/utils/format.ts',
      code: "export { useThing } from '../composables/useThing'",
      errors: [error('useThing', '../composables/useThing')],
    },
    {
      filename: 'app/composables/useThing.ts',
      code: "export { fmt } from '~/utils/format'",
      errors: [error('fmt', '~/utils/format')],
    },
    {
      filename: 'app/composables/useThing.ts',
      code: "export { fmt } from '@/utils/format'",
      errors: [error('fmt', '@/utils/format')],
    },
    // shared/utils is scanned by both contexts.
    {
      filename: 'server/utils/ss.ts',
      code: "export { sharedFn } from '#shared/utils/s'",
      errors: [error('sharedFn', '#shared/utils/s')],
    },
    {
      filename: 'app/utils/ps.ts',
      code: "export { sharedFn } from '#shared/utils/s'",
      errors: [error('sharedFn', '#shared/utils/s')],
    },
    {
      filename: 'server/utils/ss.ts',
      code: "export { sharedFn } from '~~/shared/utils/s'",
      errors: [error('sharedFn', '~~/shared/utils/s')],
    },
    {
      filename: 'server/utils/a.ts',
      code: "export { b } from '~~/server/utils/b'",
      errors: [error('b', '~~/server/utils/b')],
    },
    {
      filename: 'shared/utils/slug.ts',
      code: "export { fmt } from '../../app/utils/format'",
      errors: [error('fmt', '../../app/utils/format')],
    },

    // --- filename spellings ---------------------------------------------------
    {
      filename: '/repo/apps/web/server/utils/db.ts',
      code: "export { x } from './sibling'",
      errors: [error('x', './sibling')],
    },
    {
      filename: 'layers/base/app/composables/useThing.mts',
      code: "export { x } from './sibling'",
      errors: [error('x', './sibling')],
    },
    {
      filename: 'C:\\repo\\app\\utils\\format.ts',
      code: "export { x } from './sibling'",
      errors: [error('x', './sibling')],
    },

    // --- a real file next to it, as opposed to a directory ---------------------
    {
      filename: join(root, 'app/utils/barrel.ts'),
      code: "export { x } from './sibling'",
      errors: [error('x', './sibling')],
    },
  ],
})
