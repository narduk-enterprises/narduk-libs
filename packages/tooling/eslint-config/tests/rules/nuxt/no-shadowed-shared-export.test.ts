import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import vueParser from 'vue-eslint-parser'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/nuxt/no-shadowed-shared-export'

RuleTester.describe = describe
RuleTester.it = it

const ts = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  },
})

const vue = new RuleTester({
  languageOptions: {
    parser: vueParser,
    parserOptions: { ecmaVersion: 2022, sourceType: 'module', parser: tsParser },
  },
})

const MEDIAN = 'export function median(values: number[]) { return values[0] }'

ts.run('no-shadowed-shared-export', rule, {
  valid: [
    // Miss: a name no released package exports.
    { filename: 'shared/utils/orders.ts', code: 'export function orderTotal() { return 1 }' },
    // Miss: under six characters, and SCREAMING_CASE, are never candidates.
    { filename: 'shared/utils/numbers.ts', code: 'export function mean() { return 1 }' },
    { filename: 'shared/utils/limits.ts', code: 'export const DEFAULT_PAGE_SIZE = 20' },
    // Miss: generic words (`sleep`, `isRecord`) are ordinary local vocabulary.
    { filename: 'shared/utils/async.ts', code: 'export const sleep = (ms: number) => ms' },
    { filename: 'shared/utils/guards.ts', code: 'const isRecord = (v: unknown) => !!v' },
    // Miss: a nested helper is local detail, not a module-level copy.
    {
      filename: 'shared/utils/numbers.ts',
      code: 'export function stats(values: number[]) { function median() { return 1 } return median() }',
    },
    // Miss: a type of the same name is not a function, const or class.
    { filename: 'shared/types.ts', code: 'export type median = number' },
    // Miss: an import is the shared one, not a copy.
    {
      filename: 'shared/utils/numbers.ts',
      code: "import { median } from '@narduk-enterprises/narduk-core/shared/utils/numbers'\nexport const mid = median([1])",
    },
    // Miss: tests, fixtures and declaration files.
    { filename: 'tests/unit/numbers.test.ts', code: MEDIAN },
    { filename: 'app/fixtures/numbers.ts', code: MEDIAN },
    { filename: 'shared/utils/numbers.d.ts', code: 'export declare function median(): number' },
    // Miss: the owning packages' own sources are the export.
    {
      filename: '/repo/packages/modules/narduk-core/shared/utils/numbers.ts',
      code: MEDIAN,
    },
    // Allow-list: the option names the copy as intentional.
    {
      filename: 'shared/utils/numbers.ts',
      code: MEDIAN,
      options: [{ allow: ['median'] }],
    },
    // Allow-list: `LIBS-KEEP: <name> <reason>` on the line above.
    {
      filename: 'shared/utils/numbers.ts',
      code: `// LIBS-KEEP: median rounds ties with toFixed, which core's does not\n${MEDIAN}`,
    },
    // Allow-list: LIBS-KEEP within three lines above, past a doc comment.
    {
      filename: 'shared/utils/numbers.ts',
      code: `// LIBS-KEEP: median Kelvin-aware copy\n/** Median of the values. */\n/** Rounds ties. */\n${MEDIAN}`,
    },
    // Allow-list: LIBS-KEEP trailing the declaration's line.
    {
      filename: 'shared/utils/numbers.ts',
      code: 'const median = (v: number[]) => v[0] // LIBS-KEEP: median different rounding',
    },
  ],
  invalid: [
    // Hit: the done-when case, a local `median` that does not import core's.
    {
      filename: 'shared/utils/numbers.ts',
      code: MEDIAN,
      errors: [{ messageId: 'shadowed', data: { name: 'median', pkg: 'narduk-core' } }],
    },
    // Hit: const, class and non-exported declarations are seen too.
    {
      filename: 'app/utils/text.ts',
      code: 'const slugify = (value: string) => value.toLowerCase()',
      errors: [{ messageId: 'shadowed', data: { name: 'slugify', pkg: 'narduk-core' } }],
    },
    {
      filename: 'server/utils/errors.ts',
      code: 'export class BoundedBodyTooLargeError extends Error {}',
      errors: [
        { messageId: 'shadowed', data: { name: 'BoundedBodyTooLargeError', pkg: 'narduk-core' } },
      ],
    },
    // Hit: a name two packages export names both owners.
    {
      filename: 'app/utils/format.ts',
      code: 'export function formatNumber(value: number) { return String(value) }',
      errors: [
        {
          messageId: 'shadowed',
          data: { name: 'formatNumber', pkg: 'narduk-core, @narduk-enterprises/narduk-shell' },
        },
      ],
    },
    // Hit: a named default export is still a top-level declaration.
    {
      filename: 'shared/utils/numbers.ts',
      code: 'export default function median(values: number[]) { return values[0] }',
      errors: [{ messageId: 'shadowed' }],
    },
    // Hit: one report per declarator.
    {
      filename: 'app/utils/text.ts',
      code: 'const plural = () => 1, ordinal = () => 2',
      errors: [{ messageId: 'shadowed' }, { messageId: 'shadowed' }],
    },
    // Hit: a LIBS-KEEP for another name does not excuse this one.
    {
      filename: 'shared/utils/numbers.ts',
      code: `// LIBS-KEEP: slugify other reason\n${MEDIAN}`,
      errors: [{ messageId: 'shadowed' }],
    },
    // Hit: a LIBS-KEEP more than three lines away is not about this declaration.
    {
      filename: 'shared/utils/numbers.ts',
      code: `// LIBS-KEEP: median reason\n\n\n\n\n${MEDIAN}`,
      errors: [{ messageId: 'shadowed' }],
    },
    // Hit: an allow-list for another name does not excuse this one.
    {
      filename: 'shared/utils/numbers.ts',
      code: MEDIAN,
      options: [{ allow: ['slugify'] }],
      errors: [{ messageId: 'shadowed' }],
    },
  ],
})

vue.run('no-shadowed-shared-export (.vue)', rule, {
  valid: [
    {
      filename: 'app/components/Stats.vue',
      code: '<script setup lang="ts">\n// LIBS-KEEP: median component-local\nconst median = (v: number[]) => v[0]\n</script>\n<template><div /></template>',
    },
  ],
  invalid: [
    {
      filename: 'app/components/Stats.vue',
      code: '<script setup lang="ts">\nconst median = (v: number[]) => v[0]\n</script>\n<template><div /></template>',
      errors: [{ messageId: 'shadowed', data: { name: 'median', pkg: 'narduk-core' } }],
    },
  ],
})
