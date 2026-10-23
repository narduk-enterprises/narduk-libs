import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import nuxtPlugin from '@nuxt/eslint-plugin'
import { ESLint } from 'eslint'
import vuePlugin from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Mobile web QA rule 4: `100vh` / `h-screen` is the large viewport, so a phone's
 * browser chrome covers the bottom of the page. The design-system pack bans the
 * classes through `narduk/no-restricted-utility-classes`, with an autofix for
 * the two that have a drop-in `dvh` twin, alongside the raw palette ban.
 *
 * The app root is outside the workspace, away from the package's own Tailwind
 * devDependency: the rule reads class names and must not need one.
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

let appRoot: string
let baseConfig: never
let eslint: ESLint

beforeAll(async () => {
  const appConfig = (await import(
    new URL('../../eslint-app-config.mjs', import.meta.url).href
  )) as AppConfigModule
  appRoot = mkdtempSync(join(tmpdir(), 'narduk-utility-classes-'))
  baseConfig = appConfig.createAppLintConfig({
    withNuxt: withNuxtLike,
    capabilityPacks: ['design-system'],
    appRootDir: appRoot,
  }) as never
  eslint = new ESLint({
    baseConfig,
    cwd: appRoot,
    fix: false,
    overrideConfigFile: true,
  })
})

afterAll(() => {
  if (appRoot) rmSync(appRoot, { force: true, recursive: true })
})

const template = (classes: string): string =>
  `<template>\n  <div class="${classes}">x</div>\n</template>\n`

const restrictedIn = async (classes: string): Promise<string[]> => {
  const [result] = await eslint.lintText(template(classes), {
    filePath: join(appRoot, 'app/components/Probe.vue'),
  })
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === 'narduk/no-restricted-utility-classes')
    .map((message) => message.message)
}

describe('viewport height classes', () => {
  it.each([
    'md:min-h-screen',
    'h-screen',
    'lg:max-h-screen',
    'min-h-[calc(100vh-8rem)]',
    'max-h-[60vh]',
  ])('flags %s and points at dvh/svh', async (cls) => {
    const messages = await restrictedIn(cls)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatch(/dvh or svh/)
  })

  it.each(['min-h-dvh', 'h-svh', 'min-h-[calc(100dvh-8rem)]', 'max-h-[85svh]', 'md:h-dvh'])(
    'passes %s',
    async (cls) => {
      expect(await restrictedIn(cls)).toEqual([])
    },
  )

  it('autofixes h-screen and min-h-screen, keeping variants', async () => {
    const fixer = new ESLint({
      baseConfig,
      cwd: appRoot,
      fix: true,
      overrideConfigFile: true,
    })
    const [result] = await fixer.lintText(template('h-screen md:min-h-screen lg:max-h-screen'), {
      filePath: join(appRoot, 'app/components/Probe.vue'),
    })
    expect(result?.output).toContain('class="h-dvh md:min-h-dvh lg:max-h-screen"')
  })
})

describe('raw palette and arbitrary colour classes', () => {
  it.each([
    'text-slate-500',
    'hover:text-slate-500',
    'dark:bg-gray-900',
    'md:group-hover:border-red-200',
    'data-[state=open]:bg-blue-50',
    'text-slate-400/80',
    'bg-zinc-900/[0.4]',
    '!text-slate-400',
    'text-slate-400!',
    'border-t-gray-200',
    'ring-offset-sky-300',
    'text-[#9aa4b0]',
    'hover:bg-[rgb(1_2_3)]',
    'border-[color:#fff]',
  ])('flags %s and points at a semantic token', async (cls) => {
    const messages = await restrictedIn(cls)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatch(/semantic token from your theme/)
  })

  it.each([
    'text-muted',
    'bg-elevated',
    'text-ink',
    'hover:text-primary',
    'bg-[var(--chart-1)]',
    'bg-(--color-ink)',
    'text-[13px]',
    'shadow-[0_0_0_1px_var(--ring)]',
    'text-white',
  ])('passes %s', async (cls) => {
    expect(await restrictedIn(cls)).toEqual([])
  })

  it('reads :class objects and arrays, skipping classes built around interpolation', async () => {
    const source = [
      '<template>',
      `  <div :class="[{ 'bg-blue-50': on }, 'text-gray-500', \`text-\${tone}-500\`]">x</div>`,
      '</template>',
      '',
    ].join('\n')
    const [result] = await eslint.lintText(source, {
      filePath: join(appRoot, 'app/components/Probe.vue'),
    })
    const names = (result?.messages ?? [])
      .filter((message) => message.ruleId === 'narduk/no-restricted-utility-classes')
      .map((message) => message.message.match(/`([^`]+)`/)?.[1])
    expect(names).toEqual(['bg-blue-50', 'text-gray-500'])
  })

  it('allowedRawPaletteFiles keeps the vh ban but allows the palette', async () => {
    const appConfig = (await import(
      new URL('../../eslint-app-config.mjs', import.meta.url).href
    )) as AppConfigModule
    const chartLint = new ESLint({
      baseConfig: appConfig.createAppLintConfig({
        withNuxt: withNuxtLike,
        capabilityPacks: ['design-system'],
        appRootDir: appRoot,
        allowedRawPaletteFiles: ['app/components/charts/**/*.vue'],
      }) as never,
      cwd: appRoot,
      overrideConfigFile: true,
    })
    const lint = async (path: string) => {
      const [result] = await chartLint.lintText(template('text-sky-500 h-screen'), {
        filePath: join(appRoot, path),
      })
      return (result?.messages ?? [])
        .filter((message) => message.ruleId === 'narduk/no-restricted-utility-classes')
        .map((message) => message.message.match(/`([^`]+)`/)?.[1])
    }
    expect(await lint('app/components/charts/Bars.vue')).toEqual(['h-screen'])
    expect(await lint('app/components/Card.vue')).toEqual(['text-sky-500', 'h-screen'])
  })

  it('allowedRawPaletteFiles requires the design-system pack', async () => {
    const appConfig = (await import(
      new URL('../../eslint-app-config.mjs', import.meta.url).href
    )) as AppConfigModule
    expect(() =>
      appConfig.createAppLintConfig({
        withNuxt: withNuxtLike,
        capabilityPacks: ['core'],
        appRootDir: appRoot,
        allowedRawPaletteFiles: ['app/charts/**'],
      }),
    ).toThrow(/design-system/)
  })
})
