import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import vueParser from 'vue-eslint-parser'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/hydration/no-render-clock'

RuleTester.describe = describe
RuleTester.it = it

const vue = new RuleTester({
  languageOptions: {
    parser: vueParser,
    parserOptions: { ecmaVersion: 2022, sourceType: 'module', parser: tsParser },
  },
})

const FILE = 'app/components/StationHero.vue'
const setup = (script: string, template = '<div />') =>
  `<script setup lang="ts">\n${script}\n</script>\n<template>${template}</template>`
const error = (read: string) => ({ messageId: 'renderClock' as const, data: { read } })

vue.run('no-render-clock', rule, {
  valid: [
    {
      name: 'onMounted',
      filename: FILE,
      code: setup('const now = ref(0)\nonMounted(() => { now.value = Date.now() })'),
    },
    {
      name: 'onBeforeMount',
      filename: FILE,
      code: setup('onBeforeMount(() => { t.value = performance.now() })'),
    },
    { name: 'onUpdated', filename: FILE, code: setup('onUpdated(() => { t.value = new Date() })') },
    {
      name: 'watch callback',
      filename: FILE,
      code: setup('watch(src, () => { at.value = Date.now() })'),
    },
    {
      name: 'watchEffect callback',
      filename: FILE,
      code: setup('watchEffect(() => { at.value = Date.now() })'),
    },
    {
      name: 'script event handler',
      filename: FILE,
      code: setup(
        'function onClick() { clicked.value = Date.now() }',
        '<button @click="onClick" />',
      ),
    },
    {
      name: 'template v-on handler',
      filename: FILE,
      code: setup('const at = ref(0)', '<button @click="at = Date.now()" />'),
    },
    {
      name: 'import.meta.client guard',
      filename: FILE,
      code: setup('if (import.meta.client) { start = Date.now() }'),
    },
    {
      name: 'import.meta.server guard',
      filename: FILE,
      code: setup('if (import.meta.server) { start = Date.now() }'),
    },
    {
      name: 'guarded ternary',
      filename: FILE,
      code: setup('const start = import.meta.client ? Date.now() : 0'),
    },
    {
      name: 'guarded &&',
      filename: FILE,
      code: setup('const start = import.meta.client && Date.now()'),
    },
    {
      name: 'guarded inside computed',
      filename: FILE,
      code: setup('const x = computed(() => (import.meta.client ? Date.now() : 0))'),
    },
    {
      name: 'useState factory',
      filename: FILE,
      code: setup("const now = useState('now', () => Date.now())"),
    },
    {
      name: 'setInterval tick',
      filename: FILE,
      code: setup('onMounted(() => setInterval(() => { now.value = Date.now() }, 1000))'),
    },
    {
      name: 'new Date(value) is a conversion',
      filename: FILE,
      code: setup('const d = new Date(props.at)', '<time>{{ new Date(at).toISOString() }}</time>'),
    },
    {
      name: 'plain <script> block is not setup',
      filename: FILE,
      code: '<script lang="ts">\nexport const loadedAt = Date.now()\n</script>\n<template><div /></template>',
    },
    {
      name: 'ClientOnly template content',
      filename: FILE,
      code: setup('', '<ClientOnly><span>{{ Date.now() }}</span></ClientOnly>'),
    },
    {
      name: '.client.vue never hydrates',
      filename: 'app/components/Clock.client.vue',
      code: setup('const now = Date.now()'),
    },
    {
      name: '.server.vue never hydrates',
      filename: 'app/components/Clock.server.vue',
      code: setup('const now = Date.now()'),
    },
    {
      name: 'non-vue files are out of scope',
      filename: 'app/composables/useClock.ts',
      code: 'export const now = Date.now()',
    },
    {
      name: 'named helper function (invocation is out of scope)',
      filename: FILE,
      code: setup('function age(at: number) { return Date.now() - at }'),
    },
  ],
  invalid: [
    {
      name: 'top-level Date.now() in script setup',
      filename: FILE,
      code: setup('const now = Date.now()'),
      errors: [error('Date.now()')],
    },
    {
      name: 'top-level new Date()',
      filename: FILE,
      code: setup('const today = new Date()'),
      errors: [error('new Date()')],
    },
    {
      name: 'top-level performance.now()',
      filename: FILE,
      code: setup('const t0 = performance.now()'),
      errors: [error('performance.now()')],
    },
    {
      name: 'ref(Date.now())',
      filename: FILE,
      code: setup('const now = ref(Date.now())'),
      errors: [error('Date.now()')],
    },
    {
      name: 'computed getter',
      filename: FILE,
      code: setup('const age = computed(() => Date.now() - props.at)'),
      errors: [error('Date.now()')],
    },
    {
      name: 'computed { get }',
      filename: FILE,
      code: setup('const age = computed({ get() { return Date.now() - at.value }, set() {} })'),
      errors: [error('Date.now()')],
    },
    {
      name: 'array callback inside computed',
      filename: FILE,
      code: setup(
        'const fresh = computed(() => items.value.filter((i) => i.at > Date.now() - 1000))',
      ),
      errors: [error('Date.now()')],
    },
    {
      name: 'template interpolation',
      filename: FILE,
      code: setup('', '<span>{{ Math.round((Date.now() - at) / 1000) }}</span>'),
      errors: [error('Date.now()')],
    },
    {
      name: 'template v-bind',
      filename: FILE,
      code: setup('', '<time :datetime="new Date().toISOString()" />'),
      errors: [error('new Date()')],
    },
    {
      name: 'buoys #202 shape: page-level age label',
      filename: 'app/pages/stations/[stationId].vue',
      code: setup('const ageMinutes = Math.floor((Date.now() - observedAt) / 60000)'),
      errors: [error('Date.now()')],
    },
  ],
})
