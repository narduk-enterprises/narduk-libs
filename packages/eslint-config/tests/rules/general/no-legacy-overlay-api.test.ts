import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import vueParser from 'vue-eslint-parser'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/general/no-legacy-overlay-api'

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

ts.run('no-legacy-overlay-api', rule, {
  valid: [
    // --- ported from v1 ---
    {
      filename: 'app/composables/useConfirmDialog.ts',
      code: `
        const overlay = useOverlay()
        const modal = overlay.create(ConfirmDialog, {
          destroyOnClose: true,
          props: { title: 'Confirm' }
        })

        async function confirm() {
          return await modal.open()
        }
      `,
    },
    {
      filename: 'app/composables/useOpen.ts',
      code: `
        const modal = useOverlay().create(ConfirmDialog)
        function open() {
          modal.open({ title: 'Hello' })
        }
      `,
    },
    {
      filename: 'app/composables/useShadowed.ts',
      code: `
        const overlay = useOverlay()

        function inspect(overlay: { create: (_component: unknown, options?: { events?: object }) => { result: Promise<unknown> } }) {
          const modal = overlay.create(ConfirmDialog, {
            events: {
              confirm: () => {}
            }
          })

          return modal.result
        }

        overlay.create(ConfirmDialog)
      `,
    },
    {
      filename: 'app/composables/useLocalFactory.ts',
      code: `
        function useOverlay() {
          return {
            create(_component: unknown, _options?: { events?: object }) {
              return {
                result: Promise.resolve(true)
              }
            }
          }
        }

        async function inspect() {
          const modal = useOverlay().create(ConfirmDialog, {
            events: {
              confirm: () => {}
            }
          })

          return await modal.result
        }
      `,
    },

    // --- new: import-source verification ----------------------------------
    // A same-named composable from an unrelated package must NOT be reported.
    // This is the property the review singled out ("verifies import source")
    // and it had no test of its own.
    {
      filename: 'app/composables/useThirdParty.ts',
      code: `
        import { useOverlay } from 'some-other-overlay-lib'
        const overlay = useOverlay()
        const modal = overlay.create(Dialog, { events: { confirm: () => {} } })
        export const r = modal.result
      `,
    },

    // --- new: documented alias/namespace boundaries ------------------------
    // Aliased import: the callee Identifier is `useOv`, so the factory is
    // never tracked. The review's repo-wide alias weakness class.
    {
      filename: 'app/composables/useAliased.ts',
      code: `
        import { useOverlay as useOv } from '#imports'
        const overlay = useOv()
        const modal = overlay.create(Dialog, { events: { confirm: () => {} } })
        export const r = modal.result
      `,
    },
    // Namespace import: the callee is a MemberExpression.
    {
      filename: 'app/composables/useNamespaced.ts',
      code: `
        import * as ui from '@nuxt/ui'
        const overlay = ui.useOverlay()
        const modal = overlay.create(Dialog, { events: { confirm: () => {} } })
        export const r = modal.result
      `,
    },
    // A computed option key is not statically readable.
    {
      filename: 'app/composables/useComputedKey.ts',
      code: `
        const overlay = useOverlay()
        overlay.create(Dialog, { [optionKey]: {} })
      `,
    },
    // `.result` on something unrelated to an overlay.
    {
      filename: 'app/composables/useUnrelated.ts',
      code: `
        const parsed = schema.safeParse(input)
        export const r = parsed.result
      `,
    },
  ],
  invalid: [
    // --- ported from v1 ---
    {
      filename: 'app/composables/useEvents.ts',
      code: `
        const overlay = useOverlay()
        const modal = overlay.create(ConfirmDialog, {
          props: { title: 'Confirm' },
          events: {
            confirm: () => modal.close(true)
          }
        })
      `,
      errors: [{ messageId: 'noEventsOption' }],
    },
    {
      filename: 'app/composables/useResult.ts',
      code: `
        const overlay = useOverlay()
        const modal = overlay.create(ConfirmDialog)

        async function confirm() {
          return await modal.result
        }
      `,
      errors: [{ messageId: 'noResultProperty' }],
    },
    {
      filename: 'app/composables/useChained.ts',
      code: `
        async function confirm() {
          return await useOverlay().create(ConfirmDialog).result
        }
      `,
      errors: [{ messageId: 'noResultProperty' }],
    },

    // --- new: adversarial --------------------------------------------------
    // Explicit import from each allow-listed source must still report.
    {
      filename: 'app/composables/useNuxtUiImport.ts',
      code: `
        import { useOverlay } from '@nuxt/ui'
        const overlay = useOverlay()
        overlay.create(Dialog, { events: { confirm: () => {} } })
      `,
      errors: [{ messageId: 'noEventsOption' }],
    },
    {
      filename: 'app/composables/useImportsAlias.ts',
      code: `
        import { useOverlay } from '#imports'
        const overlay = useOverlay()
        const modal = overlay.create(Dialog)
        export const r = modal.result
      `,
      errors: [{ messageId: 'noResultProperty' }],
    },
    // String-literal option key spelling.
    {
      filename: 'app/composables/useQuotedKey.ts',
      code: `
        const overlay = useOverlay()
        overlay.create(Dialog, { 'events': { confirm: () => {} } })
      `,
      errors: [{ messageId: 'noEventsOption' }],
    },
  ],
})

vue.run('no-legacy-overlay-api (vue SFC)', rule, {
  valid: [
    {
      filename: 'app/components/Ok.vue',
      code: `<script setup lang="ts">
const overlay = useOverlay()
const modal = overlay.create(ConfirmDialog)
async function confirm() { return await modal.open() }
</script>
<template><div /></template>`,
    },
  ],
  invalid: [
    // --- new: the same defect inside an SFC script block --------------------
    {
      filename: 'app/components/Confirm.vue',
      code: `<script setup lang="ts">
const overlay = useOverlay()
const modal = overlay.create(ConfirmDialog, { events: { confirm: () => {} } })
</script>
<template><div /></template>`,
      errors: [{ messageId: 'noEventsOption' }],
    },
    {
      filename: 'app/components/Result.vue',
      code: `<script setup lang="ts">
const overlay = useOverlay()
const modal = overlay.create(ConfirmDialog)
const done = await modal.result
</script>
<template><div /></template>`,
      errors: [{ messageId: 'noResultProperty' }],
    },
  ],
})
