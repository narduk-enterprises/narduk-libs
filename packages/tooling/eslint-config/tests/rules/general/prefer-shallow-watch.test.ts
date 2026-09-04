import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import vueParser from 'vue-eslint-parser'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/general/prefer-shallow-watch'

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

vue.run('prefer-shallow-watch (vue SFC)', rule, {
  valid: [
    // --- ported from v1 ---
    {
      filename: 'app/components/Ok.vue',
      code: `
        <script setup>
        watch(state, () => {})
        </script>
      `,
    },
    {
      filename: 'app/components/Suppressed.vue',
      code: `
        <script setup>
        /* vue-official allow-deep-watch */
        watch(state, () => {}, { deep: true })
        </script>
      `,
    },
  ],
  invalid: [
    // --- ported from v1 ---
    {
      filename: 'app/components/Deep.vue',
      code: `
        <script setup>
        watch(state, () => {}, { deep: true })
        </script>
      `,
      errors: [{ messageId: 'preferShallowWatch' }],
    },

    // --- new: SFC with lang="ts" and a real component path ----------------
    {
      filename: 'app/components/Settings.vue',
      code: `<script setup lang="ts">
import { watch, reactive } from 'vue'
const form = reactive({ a: 1 })
watch(form, () => save(), { deep: true, immediate: true })
</script>
<template><form /></template>`,
      errors: [{ messageId: 'preferShallowWatch' }],
    },
  ],
})

ts.run('prefer-shallow-watch (composables)', rule, {
  valid: [
    // --- ported from v1 ---
    {
      filename: 'app/composables/useFoo.ts',
      code: `
        import { watch } from 'vue'
        watch(refs, () => {})
      `,
    },
    {
      filename: 'app/composables/useSuppressed.ts',
      code: `
        import { watch } from 'vue'
        /* vue-official allow-deep-watch */
        watch(state, () => {}, { deep: true })
      `,
    },

    // --- new: documented boundaries -------------------------------------
    // Aliased import — the callee Identifier is `vueWatch`, so no report. The
    // review's repo-wide alias weakness class.
    {
      filename: 'app/composables/useAliased.ts',
      code: `import { watch as vueWatch } from 'vue'
vueWatch(obj, () => {}, { deep: true })`,
    },
    // A MemberExpression callee never matches. This is the same guard that
    // keeps the rule free of the `no-fetch-in-watch` false positive the review
    // proved (`chokidar.watch`, `fs.watch`) — asserted rather than assumed.
    {
      filename: 'app/composables/useWatcher.ts',
      code: `import chokidar from 'chokidar'
chokidar.watch(dir, { deep: true })`,
    },
    // `deep: false` is exactly what the rule is asking for.
    {
      filename: 'app/composables/useShallow.ts',
      code: `import { watch } from 'vue'
watch(obj, () => {}, { deep: false })`,
    },
    // The options object must be a literal — a passed-through variable is not
    // statically readable.
    {
      filename: 'app/composables/useOptionsVar.ts',
      code: `import { watch } from 'vue'
watch(obj, () => {}, opts)`,
    },
    // `strict: false` disables reporting entirely.
    {
      filename: 'app/composables/useLoose.ts',
      code: `import { watch } from 'vue'
watch(obj, () => {}, { deep: true })`,
      options: [{ strict: false }],
    },
  ],
  invalid: [
    // --- ported from v1 ---
    {
      filename: 'app/composables/useBar.ts',
      code: `
        import { watch } from 'vue'
        watch(obj, () => {}, { deep: true })
      `,
      errors: [{ messageId: 'preferShallowWatch' }],
    },

    // --- new: adversarial ------------------------------------------------
    // A comment that is merely nearby, not the suppression token, must not
    // suppress.
    {
      filename: 'app/composables/useNearMiss.ts',
      code: `import { watch } from 'vue'
/* deep watch is fine here honestly */
watch(obj, () => {}, { deep: true })`,
      errors: [{ messageId: 'preferShallowWatch' }],
    },
    // Quoted key spelling of the same option.
    {
      filename: 'app/composables/useQuoted.ts',
      code: `import { watch } from 'vue'
watch(obj, () => {}, { 'deep': true })`,
      errors: [{ messageId: 'preferShallowWatch' }],
    },
  ],
})
