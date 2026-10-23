import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import vueParser from 'vue-eslint-parser'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/vue/no-restricted-utility-classes'

RuleTester.describe = describe
RuleTester.it = it

const vue = new RuleTester({
  languageOptions: {
    parser: vueParser,
    parserOptions: { ecmaVersion: 2022, sourceType: 'module', parser: tsParser },
  },
})

const FILE = 'app/components/Card.vue'
const tpl = (body: string) => ({ filename: FILE, code: `<template>${body}</template>` })
const script = (body: string) => ({
  filename: FILE,
  code: `<script setup lang="ts">\n${body}\n</script>\n<template><div /></template>`,
})

vue.run('no-restricted-utility-classes', rule, {
  valid: [
    tpl('<div class="text-muted bg-elevated border-default text-ink">x</div>'),
    tpl('<div class="bg-[var(--chart-1)] bg-(--color-ink) text-[13px] h-dvh">x</div>'),
    tpl('<div :class="`text-${tone}-500 bg-${tone}-50`">x</div>'),
    tpl('<div title="text-slate-500 h-screen">x</div>'),
    tpl('<div :aria-label="\'bg-gray-900\'">x</div>'),
    tpl('<div :class="{ active: isOn(\'blue\') }">x</div>'),
    script("const label = 'text-slate-500'"),
    script("track('bg-gray-900')"),
    {
      ...tpl('<div class="text-slate-500 bg-[#fff]">x</div>'),
      options: [{ allowRawPalette: true }],
    },
  ],
  invalid: [
    {
      ...tpl('<div class="p-4 hover:text-slate-500 dark:bg-gray-900/80">x</div>'),
      errors: [
        { messageId: 'rawPalette', column: 27 },
        { messageId: 'rawPalette', column: 48 },
      ],
    },
    {
      ...tpl('<NuxtLink to="/" active-class="!text-blue-600">x</NuxtLink>'),
      errors: [{ messageId: 'rawPalette' }],
    },
    {
      ...tpl('<div class="text-[#9aa4b0] md:bg-[oklch(0.7_0.1_200)]">x</div>'),
      errors: [{ messageId: 'arbitraryColor' }, { messageId: 'arbitraryColor' }],
    },
    {
      ...tpl(
        "<div :class=\"[{ 'bg-blue-50': on }, cond ? 'text-red-500' : 'text-muted']\">x</div>",
      ),
      errors: [{ messageId: 'rawPalette' }, { messageId: 'rawPalette' }],
    },
    {
      ...tpl('<UCard :ui="{ body: \'bg-zinc-50\' }">x</UCard>'),
      errors: [{ messageId: 'rawPalette' }],
    },
    {
      ...script("const classes = cn('text-gray-500', on && 'bg-sky-100')"),
      errors: [{ messageId: 'rawPalette' }, { messageId: 'rawPalette' }],
    },
    {
      ...script("const button = tv({ base: 'border-stone-200' })"),
      errors: [{ messageId: 'rawPalette' }],
    },
    {
      ...tpl('<div class="h-screen md:min-h-screen lg:max-h-screen max-h-[60vh]">x</div>'),
      output:
        '<template><div class="h-dvh md:min-h-dvh lg:max-h-screen max-h-[60vh]">x</div></template>',
      errors: [
        { messageId: 'viewportHeight' },
        { messageId: 'viewportHeight' },
        { messageId: 'viewportHeight' },
        { messageId: 'viewportHeight' },
      ],
    },
    {
      ...tpl('<div :class="[\'h-screen\', `${a} min-h-screen`]">x</div>'),
      output: '<template><div :class="[\'h-dvh\', `${a} min-h-screen`]">x</div></template>',
      errors: [{ messageId: 'viewportHeight' }, { messageId: 'viewportHeight' }],
    },
    {
      ...tpl('<div class="text-slate-500 h-screen">x</div>'),
      options: [{ allowRawPalette: true }],
      output: '<template><div class="text-slate-500 h-dvh">x</div></template>',
      errors: [{ messageId: 'viewportHeight' }],
    },
  ],
})
