import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import vueParser from 'vue-eslint-parser'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/general/no-legacy-fetch-hook'

RuleTester.describe = describe
RuleTester.it = it

const vue = new RuleTester({
  languageOptions: {
    parser: vueParser,
    parserOptions: { ecmaVersion: 2022, sourceType: 'module', parser: tsParser },
  },
})

const ts = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  },
})

vue.run('no-legacy-fetch-hook', rule, {
  valid: [
    // --- ported from v1 ---
    {
      filename: 'app/pages/index.vue',
      code: `
        <script setup>
        const { data } = await useFetch('/api')
        </script>
      `,
    },

    // --- new: documented boundaries -------------------------------------
    // Value-position function rather than a shorthand method. `node.method` is
    // false, so v1 did not report it and neither does this port. Recorded so
    // the gap is a known one.
    {
      filename: 'app/pages/legacy-value.vue',
      code: `
        <script>
        export default {
          fetch: async function () { return {} }
        }
        </script>
      `,
    },
    // Nested inside `methods:` — not the Options-API `fetch` hook.
    {
      filename: 'app/pages/methods.vue',
      code: `
        <script>
        export default {
          methods: {
            async fetch() { return {} }
          }
        }
        </script>
      `,
    },
    // Wrapped in `defineComponent(...)`: the Property's grandparent is a
    // CallExpression, not an ExportDefaultDeclaration.
    {
      filename: 'app/pages/defined.vue',
      code: `
        <script lang="ts">
        import { defineComponent } from 'vue'
        export default defineComponent({
          async fetch() { return {} }
        })
        </script>
      `,
    },
    // A same-named local API call is not a hook.
    {
      filename: 'app/pages/call.vue',
      code: `
        <script setup>
        const res = await fetch('/api')
        </script>
      `,
    },
  ],
  invalid: [
    // --- ported from v1 ---
    {
      filename: 'app/pages/legacy.vue',
      code: `
        <script>
        export default {
          async fetch() {
            return { data: {} }
          }
        }
        </script>
      `,
      errors: [{ messageId: 'legacyFetch' }],
    },

    // --- new: adversarial ------------------------------------------------
    // Non-async spelling of the same hook, in a `lang="ts"` block, with a
    // sibling template — the realistic migrated-from-Nuxt-2 shape.
    {
      filename: 'app/pages/products/[id].vue',
      code: `<script lang="ts">
export default {
  data() { return { items: [] } },
  fetch() { this.items = [] }
}
</script>
<template><div /></template>`,
      errors: [{ messageId: 'legacyFetch' }],
    },
  ],
})

// Without vue-eslint-parser there are no parser services, so the rule installs
// an empty visitor. Asserted rather than assumed.
ts.run('no-legacy-fetch-hook (no parser services)', rule, {
  valid: [
    {
      filename: 'app/composables/thing.ts',
      code: 'export default { async fetch() { return {} } }',
    },
  ],
  invalid: [],
})
