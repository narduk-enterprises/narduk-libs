import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import nuxtPlugin from '@nuxt/eslint-plugin'
import { ESLint } from 'eslint'
import vuePlugin from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Mobile web QA rule 4: `100vh` / `h-screen` is the large viewport, so a phone's
 * browser chrome covers the bottom of the page. The design-system pack bans the
 * classes through `better-tailwindcss/no-restricted-classes`, with an autofix for
 * the two that have a drop-in `dvh` twin.
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
let baseConfig: never
let eslint: ESLint

beforeAll(async () => {
  const appConfig = (await import(
    new URL('../../eslint-app-config.mjs', import.meta.url).href
  )) as AppConfigModule
  appRoot = // Inside the package so the plugin resolves Tailwind from its devDependency;
    // without it the plugin disables no-restricted-classes with a warning.
    mkdtempSync(join(PACKAGE_DIR, 'tests', '.tmp-viewport-height-'))
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
    .filter((message) => message.ruleId === 'better-tailwindcss/no-restricted-classes')
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
