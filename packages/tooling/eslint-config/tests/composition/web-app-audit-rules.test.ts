import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import nuxtPlugin from '@nuxt/eslint-plugin'
import { ESLint } from 'eslint'
import vuePlugin from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * The checks a "perfect web app" audit of pacc-trac found missing, proven
 * through the packs as an app composes them rather than rule by rule: the
 * `a11y` pack's Nuxt UI awareness, native dialogs and `v-html` in `core`
 * (with the community tail off), and inline `vh` in `design-system`.
 */

type FlatConfig = { name?: string; rules?: Record<string, unknown> }

interface AppConfigModule {
  createAppLintConfig: (options: Record<string, unknown>) => FlatConfig[]
}

const withNuxtLike = (...configs: FlatConfig[]): FlatConfig[] => [
  {
    name: 'test/nuxt-managed-plugins',
    plugins: { '@typescript-eslint': tseslint.plugin, nuxt: nuxtPlugin, vue: vuePlugin },
  } as FlatConfig,
  ...configs,
]

const PACKAGE_DIR = fileURLToPath(new URL('../..', import.meta.url))

let appRoot: string
let eslint: ESLint

beforeAll(async () => {
  const appConfig = (await import(
    new URL('../../eslint-app-config.mjs', import.meta.url).href
  )) as AppConfigModule
  // Inside the package so better-tailwindcss resolves Tailwind, and outside
  // `tests/` because the redirect rule exempts test trees.
  appRoot = mkdtempSync(join(PACKAGE_DIR, '.tmp-web-app-audit-'))
  eslint = new ESLint({
    baseConfig: appConfig.createAppLintConfig({
      withNuxt: withNuxtLike,
      capabilityPacks: ['core', 'design-system', 'a11y'],
      communityLayer: false,
      appType: 'content',
      trustedHtmlFiles: ['app/components/Trusted.vue'],
      appRootDir: appRoot,
    }) as never,
    cwd: appRoot,
    overrideConfigFile: true,
  })
})

afterAll(() => {
  if (appRoot) rmSync(appRoot, { force: true, recursive: true })
})

const ruleIds = async (code: string, file = 'app/components/Probe.vue'): Promise<string[]> => {
  const [result] = await eslint.lintText(code, { filePath: join(appRoot, file) })
  const fatal = result?.messages.find((message) => message.fatal)
  if (fatal) throw new Error(fatal.message)
  return (result?.messages ?? []).map((message) => message.ruleId ?? '')
}

const template = (body: string) => `<template>\n  ${body}\n</template>\n`

describe('a11y pack: Nuxt UI awareness', () => {
  it.each([
    ['<NuxtLink to="/" />', 'vuejs-accessibility/anchor-has-content'],
    [
      '<ULink to="/"><UIcon name="i-lucide-home" /></ULink>',
      'vuejs-accessibility/anchor-has-content',
    ],
    ['<UInput v-model="q" autofocus />', 'vuejs-accessibility/no-autofocus'],
    ['<div @click="open">x</div>', 'narduk/no-static-element-interactions'],
    ['<h2></h2>', 'vuejs-accessibility/heading-has-content'],
    ['<NuxtImg src="/a.png" />', 'vuejs-accessibility/alt-text'],
  ])('reports %s', async (body, rule) => {
    expect(await ruleIds(template(body))).toContain(rule)
  })

  it.each([
    '<UButton @click="go">Go</UButton>',
    '<UButton icon="i-lucide-x" aria-label="Close" @click="close" />',
    '<NuxtLink to="/" aria-label="Home"><UIcon name="i-lucide-home" /></NuxtLink>',
    '<NuxtLink to="/">{{ label }}</NuxtLink>',
    '<NuxtLink to="/"><NuxtImg src="/logo.png" alt="Home" /></NuxtLink>',
    '<h2>{{ title }}</h2>',
    '<h2><slot /></h2>',
    '<UFormField label="Name"><UInput v-model="name" /></UFormField>',
    '<UCard @click="open">x</UCard>',
    '<div role="dialog" aria-label="Photo" tabindex="-1" @keydown="onKey">x</div>',
  ])('passes %s', async (body) => {
    expect(
      (await ruleIds(template(body))).filter(
        (id) => id.startsWith('vuejs-') || id === 'narduk/no-static-element-interactions',
      ),
    ).toEqual([])
  })

  it('takes a wrapping <label> around a Nuxt UI control as associated', async () => {
    const ids = await ruleIds(template('<label><UCheckbox v-model="on" /> Active</label>'))
    expect(ids).not.toContain('vuejs-accessibility/label-has-for')
  })

  it('runs the upstream click/static rules no longer', async () => {
    const ids = await ruleIds(template('<div @click="open">x</div>'))
    expect(ids).not.toContain('vuejs-accessibility/click-events-have-key-events')
    expect(ids).not.toContain('vuejs-accessibility/no-static-element-interactions')
  })
})

describe('core pack: native dialogs', () => {
  const script = (body: string) =>
    `<script setup lang="ts">\n${body}\n</script>\n<template><div /></template>\n`

  it.each([
    "if (!confirm('Delete?')) return",
    "window.alert('Saved')",
    "const name = globalThis.prompt('Name?')",
  ])('reports %s', async (body) => {
    const ids = await ruleIds(script(body))
    expect(
      ids.some((id) => id === 'no-restricted-globals' || id === 'no-restricted-properties'),
    ).toBe(true)
  })

  it('leaves a shadowing local alone', async () => {
    const ids = await ruleIds(
      script("const { confirm } = useConfirmDialog()\nawait confirm('Delete?')"),
    )
    expect(ids).not.toContain('no-restricted-globals')
  })

  it('reports in app scripts and leaves server code and tests alone', async () => {
    expect(await ruleIds("export const ask = () => confirm('x')\n", 'app/utils/ask.ts')).toContain(
      'no-restricted-globals',
    )
    expect(
      await ruleIds("export const ask = () => confirm('x')\n", 'server/utils/ask.ts'),
    ).not.toContain('no-restricted-globals')
    expect(
      await ruleIds("export const ask = () => confirm('x')\n", 'app/utils/ask.test.ts'),
    ).not.toContain('no-restricted-globals')
  })
})

describe('core pack: v-html', () => {
  it('reports v-html with the community tail off', async () => {
    expect(await ruleIds(template('<div v-html="body" />'))).toContain('vue/no-v-html')
  })

  it('still yields to trustedHtmlFiles', async () => {
    expect(
      await ruleIds(template('<div v-html="body" />'), 'app/components/Trusted.vue'),
    ).not.toContain('vue/no-v-html')
  })
})

describe('core pack: redirect query', () => {
  it('reports an unguarded redirect in a page', async () => {
    const code =
      '<script setup lang="ts">\nconst route = useRoute()\nawait navigateTo(route.query.next as string)\n</script>\n<template><div /></template>\n'
    expect(await ruleIds(code, 'app/pages/sign-in.vue')).toContain(
      'narduk/require-safe-redirect-query',
    )
  })
})

describe('design-system pack: inline vh', () => {
  it('reports 100vh in a style attribute and passes dvh', async () => {
    expect(await ruleIds(template('<div style="height: 100vh">x</div>'))).toContain(
      'narduk/no-viewport-vh-units',
    )
    expect(await ruleIds(template('<div style="height: 100dvh">x</div>'))).not.toContain(
      'narduk/no-viewport-vh-units',
    )
  })
})
