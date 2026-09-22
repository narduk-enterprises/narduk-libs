import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import nuxtPlugin from '@nuxt/eslint-plugin'
import { ESLint } from 'eslint'
import vuePlugin from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * narduk-libs#55: with the theme rules on, `no-unknown-classes` reported 101 false
 * positives in the first consumer (borderwaitstat-us#11). They were classes the app
 * defines itself as bare selectors in its CSS, or in SFC `<style>` blocks, which the
 * plugin's theme lookup cannot see. The pack now collects those names and passes
 * them to the rule as an exact-match `ignore`.
 */

type FlatConfig = { name?: string; rules?: Record<string, unknown> }

interface CollectorModule {
  appDefinedClassesPattern: (options: {
    appRootDir: string
    entryPoint: string
  }) => string | undefined
  classSelectorsIn: (css: string) => string[]
  classesInCssImportGraph: (entryPath: string) => Set<string>
  classesInSfcStyles: (rootDir: string) => Set<string>
}

interface AppConfigModule {
  createAppLintConfig: (options: Record<string, unknown>) => FlatConfig[]
}

const PACKAGE_DIR = fileURLToPath(new URL('../..', import.meta.url))
const THEME_OVERRIDE_NAME = 'narduk/design-system-tailwind-theme'

let collector: CollectorModule
let appConfig: AppConfigModule
let appRoot: string

const write = (relativePath: string, content: string): void => {
  const target = join(appRoot, relativePath)
  mkdirSync(join(target, '..'), { recursive: true })
  writeFileSync(target, content)
}

beforeAll(async () => {
  collector = (await import(
    new URL('../../configs/app-defined-classes.mjs', import.meta.url).href
  )) as CollectorModule
  appConfig = (await import(
    new URL('../../eslint-app-config.mjs', import.meta.url).href
  )) as AppConfigModule

  // Inside the package, so `@import "tailwindcss"` resolves to its devDependency.
  appRoot = mkdtempSync(join(PACKAGE_DIR, 'tests', '.tmp-app-defined-classes-'))
  write(
    'app/assets/css/main.css',
    [
      '@import "tailwindcss";',
      '@import "./tokens.css";',
      '@import "brand-kit/brand.css";',
      '@import "brand-kit";',
      '/* .commented-out { } */',
      '.page-title { font-weight: 600; }',
      '@media (width < 620px) { .page-title { font-size: 1.5rem; } }',
    ].join('\n'),
  )
  write('app/assets/css/tokens.css', ':root { --gap: .5rem; }\n.ns-readout, .ns-label:hover { }\n')
  write(
    'node_modules/brand-kit/package.json',
    JSON.stringify({
      name: 'brand-kit',
      exports: { '.': './index.js', './brand.css': './brand.css' },
    }),
  )
  write('node_modules/brand-kit/index.js', 'export {}\n')
  write('node_modules/brand-kit/brand.css', '.brand-mark { }\n')
  write(
    'app/components/Card.vue',
    '<template><div class="card-shell" /></template>\n' +
      '<style scoped>\n.card-shell { background: url(bg.fixed.png); }\n' +
      '.card-shell :deep(.card-body) { content: ".not-a-class"; }\n</style>\n',
  )
  write('.nuxt/components/Generated.vue', '<style>.generated-only { }</style>\n')
  write('node_modules/some-lib/Lib.vue', '<style>.dependency-only { }</style>\n')
})

afterAll(() => {
  if (appRoot) rmSync(appRoot, { force: true, recursive: true })
})

describe('classSelectorsIn', () => {
  it('reads class selectors from rule preludes, including nested rules', () => {
    expect(
      collector.classSelectorsIn('.a, .b > .c:hover { color: red; &.d { } }\n.e::before { }'),
    ).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('ignores at-rule preludes, decimals, comments, strings and url() bodies', () => {
    expect(
      collector.classSelectorsIn(
        '@media (min-width: 40.5rem) { .inside { margin: 0 .5rem; } }\n' +
          '/* .comment { } */\n.x { content: ".string"; background: url(a.png); }',
      ),
    ).toEqual(['inside', 'x'])
  })
})

describe('what the collector walks', () => {
  it('follows relative imports and package imports that resolve to CSS', () => {
    expect(
      [...collector.classesInCssImportGraph(join(appRoot, 'app/assets/css/main.css'))].sort(),
    ).toEqual(['brand-mark', 'ns-label', 'ns-readout', 'page-title'])
  })

  it('reads SFC styles but skips dot-directories and node_modules', () => {
    expect([...collector.classesInSfcStyles(appRoot)].sort()).toEqual(['card-body', 'card-shell'])
  })

  it('returns no pattern when the app defines no classes of its own', () => {
    const bare = mkdtempSync(join(PACKAGE_DIR, 'tests', '.tmp-app-defined-classes-bare-'))
    try {
      writeFileSync(join(bare, 'main.css'), '@import "tailwindcss";\n')
      expect(
        collector.appDefinedClassesPattern({
          appRootDir: bare,
          entryPoint: join(bare, 'main.css'),
        }),
      ).toBeUndefined()
    } finally {
      rmSync(bare, { force: true, recursive: true })
    }
  })
})

describe('no-unknown-classes in a composed app config', () => {
  const composeForApp = (): FlatConfig[] =>
    appConfig.createAppLintConfig({
      withNuxt: (...configs: FlatConfig[]): FlatConfig[] => [
        {
          name: 'test/nuxt-managed-plugins',
          plugins: { '@typescript-eslint': tseslint.plugin, nuxt: nuxtPlugin, vue: vuePlugin },
        } as FlatConfig,
        ...configs,
      ],
      capabilityPacks: ['design-system'],
      appRootDir: appRoot,
    })

  it('passes the app-defined classes to the rule as one exact-match ignore', () => {
    const override = composeForApp().find((entry) => entry.name === THEME_OVERRIDE_NAME)

    expect(override?.rules?.['better-tailwindcss/no-unknown-classes']).toEqual([
      'error',
      { ignore: ['^(?:brand-mark|card-body|card-shell|ns-label|ns-readout|page-title)$'] },
    ])
  })

  it('reports only the classes nothing defines', async () => {
    const eslint = new ESLint({
      baseConfig: composeForApp() as never,
      cwd: appRoot,
      overrideConfigFile: true,
    })

    const [result] = await eslint.lintText(
      '<template>\n  <div class="page-title ns-readout brand-mark card-shell text-sm ' +
        'page-titel hover:page-title">x</div>\n</template>\n',
      { filePath: join(appRoot, 'app/components/Page.vue') },
    )

    const unknown = result?.messages
      .filter((message) => message.ruleId === 'better-tailwindcss/no-unknown-classes')
      .map((message) => message.message)

    expect(unknown).toEqual([
      'Unknown class detected: page-titel',
      'Unknown class detected: hover:page-title',
    ])
    expect(result?.messages.filter((message) => message.fatal)).toEqual([])
  })
})
