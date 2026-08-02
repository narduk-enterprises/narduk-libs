import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import vueParser from 'vue-eslint-parser'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/general/no-static-mermaid-import'

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

ts.run('no-static-mermaid-import (ts)', rule, {
  valid: [
    // --- ported from v1 ---
    { filename: 'app/foo.ts', code: "void import('mermaid')" },
    { filename: 'app/types.ts', code: "import type { MermaidConfig } from 'mermaid'" },
    { filename: 'app/type-specifier.ts', code: "import { type MermaidConfig } from 'mermaid'" },

    // --- new: documented boundaries -------------------------------------
    // Only the exact specifier matches. A subpath import of the same heavy
    // package is NOT reported; recorded here so the gap is visible instead of
    // assumed closed.
    {
      filename: 'app/subpath.ts',
      code: "import mermaid from 'mermaid/dist/mermaid.esm.mjs'",
    },
    // Static re-export is also a static dependency edge, and is likewise not
    // reported (the rule only visits ImportDeclaration).
    { filename: 'app/reexport.ts', code: "export { default } from 'mermaid'" },
    // Similar-looking package names must not be swept up.
    { filename: 'app/other.ts', code: "import x from 'mermaid-isomorphic'" },
  ],
  invalid: [
    // --- ported from v1 ---
    {
      filename: 'app/bad.ts',
      code: "import mermaid from 'mermaid'",
      errors: [{ messageId: 'useDynamicImport' }],
    },

    // --- new: adversarial ------------------------------------------------
    // Side-effect import has zero specifiers. `isTypeOnlyImport` guards on
    // `specifiers.length > 0`, so this must NOT be exempted by it.
    {
      filename: 'app/side-effect.ts',
      code: "import 'mermaid'",
      errors: [{ messageId: 'useDynamicImport' }],
    },
    // Namespace import — the review's namespace-import weakness class. Here it
    // IS covered, because the gate is the module specifier, not the binding.
    {
      filename: 'app/ns.ts',
      code: "import * as mermaid from 'mermaid'",
      errors: [{ messageId: 'useDynamicImport' }],
    },
    // Mixed value + type specifiers: `every(type)` is false, so still reported.
    {
      filename: 'app/mixed.ts',
      code: "import mermaid, { type MermaidConfig } from 'mermaid'",
      errors: [{ messageId: 'useDynamicImport' }],
    },
  ],
})

vue.run('no-static-mermaid-import (vue SFC)', rule, {
  valid: [
    // --- ported from v1 ---
    { filename: 'app/ok.vue', code: '<script setup>\nconst x = 1\n</script>' },

    // --- new: SFC + lang="ts" type-only import ---------------------------
    {
      filename: 'app/components/Diagram.vue',
      code: '<script setup lang="ts">\nimport type { MermaidConfig } from \'mermaid\'\nconst c: MermaidConfig = {}\n</script>',
    },
    {
      filename: 'app/components/Lazy.vue',
      code: '<script setup lang="ts">\nasync function render() { const m = await import(\'mermaid\'); return m }\n</script>',
    },
  ],
  invalid: [
    // --- ported from v1 ---
    {
      filename: 'app/bad.vue',
      code: "<script setup>\nimport mermaid from 'mermaid'\n</script>",
      errors: [{ messageId: 'useDynamicImport' }],
    },

    // --- new: relative SFC filename + lang="ts" ---------------------------
    {
      filename: 'app/components/Diagram.vue',
      code: '<script setup lang="ts">\nimport mermaid from \'mermaid\'\nmermaid.initialize({})\n</script>\n<template><div /></template>',
      errors: [{ messageId: 'useDynamicImport' }],
    },
  ],
})
