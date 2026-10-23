import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import vueParser from 'vue-eslint-parser'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/nuxt/require-safe-redirect-query'

RuleTester.describe = describe
RuleTester.it = it

const ts = new RuleTester({
  languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: 'module' },
})

const vue = new RuleTester({
  languageOptions: {
    parser: vueParser,
    parserOptions: { ecmaVersion: 2022, sourceType: 'module', parser: tsParser },
  },
})

const PAGE = 'app/pages/sign-in.vue'
const ROUTE = 'server/api/auth/entry.get.ts'
const sfc = (script: string) =>
  `<script setup lang="ts">\n${script}\n</script>\n<template><div /></template>`

vue.run('require-safe-redirect-query (vue)', rule, {
  valid: [
    // narduk-auth reset-password.vue and AuthLoginCard.vue.
    {
      filename: PAGE,
      code: sfc(
        'const to = sanitizeLocalRedirectPath(route.query.next, config.public.authRedirectPath)',
      ),
    },
    {
      filename: PAGE,
      code: sfc(
        'const to = resolveLocalRedirectRequest(props.redirectPath, route.query.next, fallback)',
      ),
    },
    // pacc-trac sign-in.vue: a guard named by the safe* convention.
    {
      filename: PAGE,
      code: sfc(
        "const returnNext = computed(() => safeLoginRedirect(route.query.redirect) ?? '/')",
      ),
    },
    // An app helper named in the option.
    {
      filename: PAGE,
      code: sfc('const next = computed(() => facilityLoginNext(route.query.next))'),
      options: [{ guards: ['facilityLoginNext'] }],
    },
    // A type test reads the value without using it.
    { filename: PAGE, code: sfc("const has = typeof route.query.next === 'string'") },
    { filename: PAGE, code: sfc('if (Array.isArray(route.query.redirect)) bad()') },
    // One const hop whose every use reaches a guard.
    {
      filename: PAGE,
      code: sfc(
        "const next = typeof route.query.next === 'string' ? route.query.next : undefined\nawait navigateTo(sanitizeLocalRedirectPath(next, '/'))",
      ),
    },
    // Wrappers that pass the value on to a guard.
    {
      filename: PAGE,
      code: sfc(
        "const to = sanitizeSameOriginPath(decodeURIComponent(String(route.query.redirect)), '/')",
      ),
    },
    {
      filename: PAGE,
      code: sfc(
        "const r = computed(() => route.query.redirect)\nawait navigateTo(sanitizeSameOriginPath(r.value, '/'))",
      ),
    },
    {
      filename: PAGE,
      code: sfc('watch(() => route.query.next, (next) => log(next))'),
    },
    { filename: PAGE, code: sfc("const ok = route.query.next?.startsWith('/') ?? false") },
    // Not a redirect parameter, and not a query object.
    { filename: PAGE, code: sfc('const tab = route.query.tab') },
    { filename: PAGE, code: sfc('const n = props.next') },
    { filename: PAGE, code: sfc('const r = db.query.users') },
    // Test trees are exempt.
    { filename: 'tests/sign-in.test.ts', code: 'navigateTo(route.query.redirect)' },
  ],
  invalid: [
    {
      filename: PAGE,
      code: sfc('await navigateTo(route.query.redirect as string)'),
      errors: [{ messageId: 'unguarded', data: { param: 'redirect' } }],
    },
    {
      filename: PAGE,
      code: sfc("const to = computed(() => (useRoute().query.returnTo as string) || '/')"),
      errors: [{ messageId: 'unguarded', data: { param: 'returnTo' } }],
    },
    // pacc-trac terms/index.vue: `startsWith('/')` lets `//evil.example` through.
    ...[
      'await navigateTo(route.query.redirect[0])',
      'await navigateTo(route.query.redirect.trim())',
      'await navigateTo(route.query.redirect.toString())',
      'const r = route.query.redirect\nawait navigateTo(Array.isArray(r) ? r[0] : r)',
      "const parsed = schema.safeParse(route.query.redirect)\nawait navigateTo(parsed.data ?? '/')",
      "const r = computed(() => route.query.redirect)\nawait navigateTo(r.value ?? '/')",
      // Read only by the template (`<NuxtLink :to="next">`).
      'const next = route.query.next as string',
    ].map((code) => ({
      filename: PAGE,
      code: sfc(code),
      errors: [{ messageId: 'unguarded' as const }],
    })),
    {
      filename: 'app/pages/terms/index.vue',
      code: sfc(
        "const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : null\nawait navigateTo(redirect && redirect.startsWith('/') ? redirect : '/')",
      ),
      errors: [{ messageId: 'unguarded', data: { param: 'redirect' } }],
    },
    {
      filename: PAGE,
      code: sfc('const { returnTo } = route.query\nrouter.push(returnTo as string)'),
      errors: [{ messageId: 'unguarded', data: { param: 'returnTo' } }],
    },
    {
      filename: PAGE,
      code: sfc("const q = route.query\nwindow.location.href = String(q['next'])"),
      errors: [{ messageId: 'unguarded', data: { param: 'next' } }],
    },
    {
      filename: PAGE,
      code: sfc("await navigateTo(route.query.next + '?welcome=1')"),
      errors: [{ messageId: 'unguarded', data: { param: 'next' } }],
    },
  ],
})

ts.run('require-safe-redirect-query (server)', rule, {
  valid: [
    {
      filename: ROUTE,
      code: "const { next } = getQuery(event)\nreturn sendRedirect(event, sanitizeNextPath(next as string, '/'))",
    },
    {
      filename: ROUTE,
      code: "const q = getQuery(event)\nconst next = q.next\nreturn sendRedirect(event, sanitizeNextPath(next, '/'))",
    },
    {
      filename: ROUTE,
      code: "const target = isSameOriginPath(new URL(request.url).searchParams.get('returnTo'))",
    },
    { filename: ROUTE, code: 'const page = getQuery(event).cursor' },
  ],
  invalid: [
    {
      filename: ROUTE,
      code: 'const { next } = getQuery(event)\nreturn sendRedirect(event, next as string)',
      errors: [{ messageId: 'unguarded', data: { param: 'next' } }],
    },
    {
      filename: ROUTE,
      code: 'return sendRedirect(event, String(getQuery(event).redirect))',
      errors: [{ messageId: 'unguarded', data: { param: 'redirect' } }],
    },
    {
      filename: ROUTE,
      code: "const to = new URL(request.url).searchParams.get('redirect_to')\nreturn Response.redirect(to!, 302)",
      errors: [{ messageId: 'unguarded', data: { param: 'redirect_to' } }],
    },
    {
      filename: ROUTE,
      code: "const params = new URLSearchParams(search)\nlocation.assign(params.get('callbackUrl') ?? '/')",
      errors: [{ messageId: 'unguarded', data: { param: 'callbackUrl' } }],
    },
    {
      filename: ROUTE,
      code: 'const { goto } = getQuery(event)\nreturn sendRedirect(event, goto as string)',
      options: [{ params: ['goto'] }],
      errors: [{ messageId: 'unguarded', data: { param: 'goto' } }],
    },
  ],
})
