import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import vueParser from 'vue-eslint-parser'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/vue/no-static-element-interactions'

RuleTester.describe = describe
RuleTester.it = it

const vue = new RuleTester({
  languageOptions: {
    parser: vueParser,
    parserOptions: { ecmaVersion: 2022, sourceType: 'module', parser: tsParser },
  },
})

const FILE = 'app/components/Probe.vue'
const tpl = (body: string) => ({ filename: FILE, code: `<template>${body}</template>` })

vue.run('no-static-element-interactions', rule, {
  valid: [
    tpl('<UButton @click="go">Go</UButton>'),
    tpl('<UCard @click="open">x</UCard>'),
    tpl('<button type="button" @click="go">x</button>'),
    tpl('<a href="/x" @click="track">x</a>'),
    // Found on pacc-trac: a role="dialog" routes Escape and arrows.
    tpl('<div role="dialog" aria-modal="true" tabindex="-1" @keydown="onKey">x</div>'),
    // Found on pacc-trac: a drop zone is a pointer-only enhancement of a file input.
    tpl('<div @dragenter.prevent="on = true" @dragover.prevent @drop.prevent="take">x</div>'),
    // Found on pacc-trac: a drag row swallows the click that ends a drag.
    tpl('<div @pointerdown="start" @click.capture="swallowAfterDrag">x</div>'),
    tpl('<span @click.stop>x</span>'),
    tpl('<div aria-hidden="true" @click="go">x</div>'),
    tpl('<div role="presentation" @click="go">x</div>'),
    tpl('<div role="button" tabindex="0" @click="go" @keydown.enter="go">x</div>'),
    tpl('<div :role="dynamicRole" @click="go">x</div>'),
    tpl('<li @click="go">x</li>'),
    tpl('<header @keydown="onMenuKey">x</header>'),
  ],
  invalid: [
    {
      ...tpl('<div @click="open">x</div>'),
      errors: [{ messageId: 'staticElement', data: { element: 'div', event: 'click' } }],
    },
    {
      ...tpl('<span v-on:click="() => open(1)">x</span>'),
      errors: [{ messageId: 'staticElement', data: { element: 'span', event: 'click' } }],
    },
    {
      ...tpl('<div @keydown.enter="go">x</div>'),
      errors: [{ messageId: 'staticElement', data: { element: 'div', event: 'keydown' } }],
    },
    {
      ...tpl('<p @mousedown="go">x</p>'),
      errors: [{ messageId: 'staticElement', data: { element: 'p', event: 'mousedown' } }],
    },
    {
      ...tpl('<div role="button" tabindex="0" @click="go">x</div>'),
      errors: [{ messageId: 'missingKeyHandler', data: { role: 'button' } }],
    },
    {
      ...tpl('<div :role="\'menuitem\'" @click="go">x</div>'),
      errors: [{ messageId: 'missingKeyHandler', data: { role: 'menuitem' } }],
    },
    {
      ...tpl('<div aria-hidden="false" @click="go">x</div>'),
      errors: [{ messageId: 'staticElement' }],
    },
  ],
})
