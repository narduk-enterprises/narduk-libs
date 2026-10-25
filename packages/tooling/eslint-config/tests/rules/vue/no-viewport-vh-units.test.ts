import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import vueParser from 'vue-eslint-parser'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/vue/no-viewport-vh-units'

RuleTester.describe = describe
RuleTester.it = it

const vue = new RuleTester({
  languageOptions: {
    parser: vueParser,
    parserOptions: { ecmaVersion: 2022, sourceType: 'module', parser: tsParser },
  },
})

const FILE = 'app/pages/index.vue'
const tpl = (body: string) => ({ filename: FILE, code: `<template>${body}</template>` })

vue.run('no-viewport-vh-units', rule, {
  valid: [
    tpl('<div style="height: 100dvh">x</div>'),
    tpl('<div style="min-height: 100svh; max-height: 90lvh">x</div>'),
    tpl('<div :style="{ height: h }">x</div>'),
    tpl('<div :style="{ minHeight: \'calc(100dvh - 4rem)\' }">x</div>'),
    tpl('<div class="h-dvh" title="100vh">x</div>'),
    tpl('<div :style="`height: ${n}dvh`">x</div>'),
    tpl(`<div :style="legacy === '100vh' ? { height: '100dvh' } : {}">x</div>`),
    { filename: FILE, code: '<template><div /></template><style>.a { height: 100vh }</style>' },
  ],
  invalid: [
    { ...tpl('<div style="height: 100VH">x</div>'), errors: [{ messageId: 'vhUnit' }] },
    { ...tpl('<div style="height: 100vh">x</div>'), errors: [{ messageId: 'vhUnit' }] },
    { ...tpl('<div style="max-height:.5vh">x</div>'), errors: [{ messageId: 'vhUnit' }] },
    { ...tpl('<div :style="{ minHeight: \'100vh\' }">x</div>'), errors: [{ messageId: 'vhUnit' }] },
    {
      ...tpl("<div :style=\"[base, { height: open ? '60vh' : 'auto' }]\">x</div>"),
      errors: [{ messageId: 'vhUnit' }],
    },
    {
      ...tpl('<div :style="`max-height: calc(${n}vh - 4rem)`">x</div>'),
      errors: [{ messageId: 'vhUnit' }],
    },
  ],
})
