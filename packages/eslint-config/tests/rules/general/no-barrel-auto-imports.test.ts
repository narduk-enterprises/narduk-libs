import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/general/no-barrel-auto-imports'

RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  },
})

ruleTester.run('no-barrel-auto-imports', rule, {
  valid: [
    // --- ported from v1 (absolute filenames) -----------------------------
    {
      filename: '/repo/app/composables/useCustomers.ts',
      code: 'export function useCustomers() { return {} }',
    },
    { filename: '/repo/app/pages/customers/index.vue', code: 'export default {}' },
    { filename: '/repo/app/services/index.ts', code: 'export {}' },

    // --- new: scope boundaries -------------------------------------------
    // Segment-anchored: `myapp` is not `app`, so `myapp/composables` is out of
    // scope even though the string `app/composables` occurs inside it.
    { filename: 'packages/myapp/composables/index.ts', code: 'export {}' },
    // Non-script extensions are skipped: `app/pages/index.vue` is a real page.
    { filename: 'app/pages/index.vue', code: 'export default {}' },
    // Only `index.*` is a barrel.
    { filename: 'app/composables/useThing.ts', code: 'export function useThing() {}' },
    { filename: 'app/components/AppIndex.ts', code: 'export {}' },
    // Directories outside the auto-import set are unaffected.
    { filename: 'app/utils/index.ts', code: 'export {}' },
    { filename: 'server/api/index.ts', code: 'export {}' },
  ],
  invalid: [
    // --- ported from v1 (absolute filenames) -----------------------------
    {
      filename: '/repo/app/composables/index.ts',
      code: 'export {}',
      errors: [{ messageId: 'noBarrelAutoImports' }],
    },
    {
      filename: '/repo/app/components/customers/index.ts',
      code: 'export {}',
      errors: [{ messageId: 'noBarrelAutoImports' }],
    },
    {
      filename: '/repo/app/layouts/index.mts',
      code: 'export {}',
      errors: [{ messageId: 'noBarrelAutoImports' }],
    },

    // --- new: THE review finding -----------------------------------------
    // v1 matched `'/app/composables/'` with a LEADING SLASH, so every one of
    // these relative filenames — the ones ESLint reports on a normal
    // `pnpm lint` — silently passed. The deep review counted this gate dead
    // across 8 rules. These four cases are the regression proof.
    {
      filename: 'app/composables/index.ts',
      code: 'export {}',
      errors: [
        {
          messageId: 'noBarrelAutoImports',
          data: { fileName: 'index.ts', directory: 'app/composables' },
        },
      ],
    },
    {
      filename: 'app/components/index.ts',
      code: 'export {}',
      errors: [{ messageId: 'noBarrelAutoImports' }],
    },
    {
      filename: 'app/layouts/index.js',
      code: 'export {}',
      errors: [{ messageId: 'noBarrelAutoImports' }],
    },
    {
      filename: 'app/pages/admin/index.ts',
      code: 'export {}',
      errors: [{ messageId: 'noBarrelAutoImports' }],
    },

    // --- new: adversarial ------------------------------------------------
    // Windows separators normalize to `/` before the gate runs.
    {
      filename: 'C:\\repo\\app\\composables\\index.ts',
      code: 'export {}',
      errors: [{ messageId: 'noBarrelAutoImports' }],
    },
    // A nested app inside a monorepo package still matches on the real
    // `app/<dir>` segment pair.
    {
      filename: 'apps/web/app/components/forms/index.mjs',
      code: 'export {}',
      errors: [{ messageId: 'noBarrelAutoImports' }],
    },
  ],
})
