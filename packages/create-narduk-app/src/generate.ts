import { existsSync } from 'node:fs'
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'

import {
  createMigrationSourcesManifest,
  createProductSpec,
  createRootPackageManifest,
  createWebPackageManifest,
  packageVersionsForCapabilities,
} from './manifest.js'
import {
  CreateNardukAppError,
  GENERATOR_NAME,
  GENERATOR_VERSION,
  SUPPORTED_CAPABILITIES,
} from './types.js'
import type {
  AppVisibility,
  Capability,
  CreateNardukAppOptions,
  CreateNardukAppReport,
  GeneratedFile,
  ProductSpec,
} from './types.js'

const DEFAULT_DESCRIPTION = 'A production-ready Nuxt application built with Narduk libraries.'
const DEFAULT_COMPATIBILITY_DATE = '2026-06-01'

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function text(...values: string[]): string {
  return values.join('\n') + '\n'
}

function titleCase(value: string): string {
  return value
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function normalizeAppName(options: CreateNardukAppOptions): string {
  const candidate = options.appName ?? options.name
  if (!candidate?.trim()) throw new CreateNardukAppError('An app name is required.')

  const appName = candidate.trim().toLowerCase()
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(appName)) {
    throw new CreateNardukAppError(
      'Invalid app name "' + candidate + '". Use lowercase letters, numbers, and single hyphens.',
    )
  }

  return appName
}

function normalizeCapabilities(input: CreateNardukAppOptions['capabilities']): Capability[] {
  const requested = typeof input === 'string' ? input.split(',') : (input ?? [])
  const normalized = requested.map((value) => value.trim().toLowerCase()).filter(Boolean)

  for (const capability of normalized) {
    if (capability === 'core') continue
    if (capability === 'pwa') {
      throw new CreateNardukAppError(
        'The pwa capability is permanently unsupported by create-narduk-app.',
      )
    }
    if (capability === 'ingestion') {
      throw new CreateNardukAppError(
        'The ingestion capability is not available here; use the future narduk-data package when it exists.',
      )
    }
    if (!(SUPPORTED_CAPABILITIES as readonly string[]).includes(capability)) {
      throw new CreateNardukAppError(
        'Unsupported capability "' +
          capability +
          '". Supported capabilities: ' +
          SUPPORTED_CAPABILITIES.join(', ') +
          '.',
      )
    }
  }

  return SUPPORTED_CAPABILITIES.filter((capability) => normalized.includes(capability))
}

function normalizePort(value: number | undefined): number {
  const port = value ?? 3000
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new CreateNardukAppError('local port must be an integer between 1024 and 65535.')
  }
  return port
}

function normalizeVisibility(value: AppVisibility | undefined): AppVisibility {
  if (!value) return 'private'
  if (value !== 'private' && value !== 'public') {
    throw new CreateNardukAppError('visibility must be either private or public.')
  }
  return value
}

function normalizeSiteUrl(value: string | undefined, localPort: number): string {
  const siteUrl = value?.trim() || 'http://localhost:' + localPort
  let parsed: URL
  try {
    parsed = new URL(siteUrl)
  } catch {
    throw new CreateNardukAppError('Invalid site URL "' + siteUrl + '".')
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new CreateNardukAppError('siteUrl must be an http(s) URL without embedded credentials.')
  }

  return parsed.toString().replace(/\/$/u, '')
}

function normalizeProductSpec(options: CreateNardukAppOptions): ProductSpec | undefined {
  return createProductSpec(options.productSpec ?? options.product ?? options.spec)
}

function tsString(value: string): string {
  const singleQuotes = value.match(/'/gu)?.length ?? 0
  const doubleQuotes = value.match(/"/gu)?.length ?? 0
  const jsonValue = JSON.stringify(value).replaceAll('<', '\\u003C')
  if (singleQuotes > doubleQuotes) return jsonValue
  return `'${jsonValue.slice(1, -1).replaceAll('\\"', '"').replaceAll("'", "\\'")}'`
}

function markdownProductSpec(spec: ProductSpec | undefined): string {
  const fields: Array<[string, string | undefined]> = [
    ['Problem', spec?.problem],
    ['Audience', spec?.audience],
    ['Value proposition', spec?.valueProposition],
    ['Primary action', spec?.primaryAction],
    ['Success metrics', spec?.successMetrics],
    ['Constraints', spec?.constraints],
  ]
  const filled = fields.filter(([, value]) => value)

  if (filled.length === 0) {
    return text(
      '## Product brief',
      '',
      'Add the product problem, audience, and success measures here.',
    )
  }

  return (
    text('## Product brief', '') +
    filled.map(([label, value]) => text('### ' + label, '', value ?? '')).join('\n')
  )
}

function moduleList(capabilities: readonly Capability[]): string {
  const moduleNames = [
    '@nuxt/ui',
    '@narduk-enterprises/narduk-core',
    ...capabilities.map((capability) =>
      capability === 'mapkit'
        ? '@narduk-geo/narduk-mapkit-nuxt'
        : '@narduk-enterprises/narduk-' + capability,
    ),
  ]
  const inline = `  modules: [${moduleNames.map(tsString).join(', ')}],`
  if (inline.length <= 100) return inline
  return ['  modules: [', ...moduleNames.map((module) => `    ${tsString(module)},`), '  ],'].join(
    '\n',
  )
}

interface NormalizedCreateOptions {
  appName: string
  capabilities: Capability[]
  description: string
  displayName: string
  localPort: number
  productSpec?: ProductSpec
  siteUrl: string
  visibility: AppVisibility
}

function normalizeOptions(options: CreateNardukAppOptions): NormalizedCreateOptions {
  const appName = normalizeAppName(options)
  const capabilities = normalizeCapabilities(options.capabilities)
  const localPort = normalizePort(options.localDevPort ?? options.localPort)
  const visibility = normalizeVisibility(options.visibility)
  const siteUrl = normalizeSiteUrl(options.siteUrl, localPort)
  const displayName = options.displayName?.trim() || titleCase(appName)
  const description = options.description?.trim() || DEFAULT_DESCRIPTION
  const productSpec = normalizeProductSpec(options)

  if (!displayName) throw new CreateNardukAppError('displayName cannot be empty.')
  if (!description) throw new CreateNardukAppError('description cannot be empty.')

  return {
    appName,
    capabilities,
    description,
    displayName,
    localPort,
    productSpec,
    siteUrl,
    visibility,
  }
}

function filesFor(options: NormalizedCreateOptions): GeneratedFile[] {
  const {
    appName,
    capabilities,
    description,
    displayName,
    localPort,
    productSpec,
    siteUrl,
    visibility,
  } = options
  const modules = moduleList(capabilities)
  const uploadBindingLines = capabilities.includes('uploads')
    ? [
        '  "r2_buckets": [',
        '    {',
        '      "binding": "UPLOADS",',
        '      "bucket_name": "' + appName + '-uploads",',
        '    },',
        '  ],',
      ]
    : []
  const knipIgnoreDependencies = [
    '@iconify-json/lucide',
    ...(capabilities.includes('mapkit') ? ['@narduk-geo/narduk-mapkit'] : []),
    'vue-tsc',
  ]

  const files: GeneratedFile[] = [
    {
      path: '.gitignore',
      contents: text(
        'node_modules',
        '.nuxt',
        '.output',
        '.narduk/recovery',
        '.npmrc.auth',
        '.wrangler',
        '.wrangler.deploy.production.json',
        '.data',
        'coverage',
        'playwright-report',
        'test-results',
        '.env',
        '.env.*',
        '!.env.example',
      ),
    },
    {
      path: '.npmrc',
      contents: text(
        '@narduk-enterprises:registry=https://npm.pkg.github.com',
        '@narduk-geo:registry=https://npm.pkg.github.com',
        '//npm.pkg.github.com/:_authToken=${GH_PACKAGES_READ-UNCONFIGURED}',
      ),
    },
    {
      path: '.prettierignore',
      contents: text(
        'node_modules',
        '.nuxt',
        '.output',
        '.wrangler',
        '.wrangler.deploy.production.json',
        'coverage',
        'playwright-report',
        'pnpm-lock.yaml',
        'test-results',
      ),
    },
    {
      path: '.github/workflows/ci.yml',
      contents: text(
        'name: CI',
        '',
        'on:',
        '  push:',
        '    branches: [main]',
        '  pull_request:',
        '',
        'permissions:',
        '  contents: read',
        '',
        'jobs:',
        '  quality:',
        visibility === 'private'
          ? '    runs-on: [self-hosted, Linux, proxmox]'
          : '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/checkout@v7',
        '      - uses: pnpm/action-setup@v6',
        '        with:',
        '          version: 10.33.4',
        '          dest: ${{ runner.temp }}/setup-pnpm',
        '      - uses: actions/setup-node@v7',
        '        with:',
        '          node-version: 22.22.3',
        '          cache: pnpm',
        '          registry-url: https://npm.pkg.github.com',
        "          scope: '@narduk-enterprises'",
        '      - run: pnpm install --frozen-lockfile',
        '        env:',
        '          GH_PACKAGES_READ: ${{ secrets.GH_PACKAGES_READ }}',
        '          NODE_AUTH_TOKEN: ${{ secrets.GH_PACKAGES_READ }}',
        '      - run: pnpm exec playwright install --with-deps chromium',
        '      - run: pnpm run quality',
      ),
    },
    {
      path: 'AGENTS.md',
      contents: text(
        '# ' + displayName + ' agent guide',
        '',
        'This repository is app-owned. Keep changes inside the requested app or web package scope, preserve unrelated work, and validate with the direct package scripts before handoff.',
        '',
        'The shared libraries are dependencies, not a control plane. This app creates files only when an operator explicitly asks for a change. Do not add credential material, hidden network calls, background reconciliation, or generated state to the repository.',
        '',
        'The web app guidance in [apps/web/AGENTS.md](apps/web/AGENTS.md) covers Nuxt, Worker, database, and capability boundaries.',
      ),
    },
    {
      path: 'README.md',
      contents: text(
        '# ' + displayName,
        '',
        description,
        '',
        '## Development',
        '',
        '- pnpm install',
        '- pnpm run dev',
        '- pnpm run quality',
        '- pnpm run test',
        '',
        'The committed `.npmrc` routes `@narduk-enterprises/*` and `@narduk-geo/*` to GitHub Packages and reads `GH_PACKAGES_READ` from the process environment. It contains no credential value.',
        '',
        'Before the first push, the onboarding skill configures package authentication, runs pnpm install, and commits pnpm-lock.yaml. CI and Workers Builds always use a frozen lockfile.',
        '',
        'Cloudflare Workers Builds uses `pnpm run cf:build` as its build command, `pnpm run cf:deploy` for the production deploy command, and `pnpm run cf:deploy:preview` for non-production branches. Local `pnpm run deploy` remains recovery-only; `pnpm run deploy:dry-run` is credential-free.',
        '',
        'The app is configured for local Nuxt development on port ' +
          localPort +
          ' and the declared site URL is ' +
          siteUrl +
          '. Cloudflare resources are represented as local configuration only; provisioning and deployment are explicit operator workflows outside this generator.',
        '',
        '## Capabilities',
        '',
        capabilities.length > 0
          ? capabilities.map((capability) => '- ' + capability).join('\n')
          : '- core',
      ),
    },
    {
      path: 'SPEC.md',
      contents: text(
        '# ' + displayName + ' product specification',
        '',
        '- Display name: ' + displayName,
        '- Package name: ' + appName,
        '- Description: ' + description,
        '- Site URL: ' + siteUrl,
        '- Visibility: ' + visibility,
        '- Local port: ' + localPort,
        '- Capabilities: ' + (capabilities.length > 0 ? capabilities.join(', ') : 'core'),
        '',
        markdownProductSpec(productSpec).trimEnd(),
      ),
    },
    {
      path: 'apps/web/AGENTS.md',
      contents: text(
        '# Web app guidance',
        '',
        'Keep browser and server code under apps/web. Use #narduk-db for app-owned database imports and keep app schema changes in server/database with a matching migration in drizzle.',
        '',
        'Nuxt modules are explicit in nuxt.config.ts. Capability metadata in package manifests documents the generated selection; runtime behavior comes from the explicit module and package configuration.',
        '',
        'Use the direct scripts from apps/web/package.json for format, lint, typecheck, unit tests, and builds. Keep secrets in the local environment and never commit them.',
      ),
    },
    {
      path: 'apps/web/app/app.config.ts',
      contents: text(
        'export default defineAppConfig({',
        '  appName: ' + tsString(displayName) + ',',
        '  siteUrl: ' + tsString(siteUrl) + ',',
        '})',
      ),
    },
    {
      path: 'apps/web/app/app.vue',
      contents: text(
        '<template>',
        '  <UApp>',
        '    <NuxtLayout>',
        '      <NuxtPage />',
        '    </NuxtLayout>',
        '  </UApp>',
        '</template>',
      ),
    },
    {
      path: 'apps/web/app/pages/index.vue',
      contents: capabilities.includes('seo')
        ? text(
            '<script setup lang="ts">',
            'const displayName = ' + tsString(displayName),
            'const description = ' + tsString(description),
            '',
            'useSeo({',
            '  title: displayName,',
            '  description,',
            '  canonicalUrl: ' + tsString(siteUrl) + ',',
            '})',
            '',
            'useWebPageSchema({',
            '  name: displayName,',
            '  description,',
            '})',
            '</script>',
            '',
            '<template>',
            '  <main>',
            '    <h1>{{ displayName }}</h1>',
            '    <p>{{ description }}</p>',
            '  </main>',
            '</template>',
          )
        : text(
            '<script setup lang="ts">',
            'const displayName = ' + tsString(displayName),
            'const description = ' + tsString(description),
            '</script>',
            '',
            '<template>',
            '  <main>',
            '    <h1>{{ displayName }}</h1>',
            '    <p>{{ description }}</p>',
            '  </main>',
            '</template>',
          ),
    },
    {
      path: 'apps/web/drizzle.config.ts',
      contents: text(
        "import { defineConfig } from 'drizzle-kit'",
        '',
        'export default defineConfig({',
        "  dialect: 'sqlite',",
        "  schema: './server/database/schema.ts',",
        "  out: './drizzle',",
        '  dbCredentials: {',
        "    url: './.data/" + appName + ".sqlite',",
        '  },',
        '})',
      ),
    },
    {
      path: 'apps/web/drizzle/README.md',
      contents: text(
        '# App migrations',
        '',
        'Keep app-owned SQL migrations in this directory. Migration identity is the tuple source, filename, checksum; package-owned migration sources are listed in migrations.sources.json.',
      ),
    },
    {
      path: 'apps/web/drizzle/0000_app_records.sql',
      contents: text(
        'CREATE TABLE `app_records` (',
        '  `id` text PRIMARY KEY NOT NULL,',
        '  `label` text NOT NULL,',
        '  `created_at` integer NOT NULL',
        ');',
      ),
    },
    {
      path: 'apps/web/eslint.config.mjs',
      contents: text(
        "import rootConfig from '../../eslint.config.mjs'",
        '',
        'export default rootConfig',
      ),
    },
    {
      path: 'eslint.config.mjs',
      contents: text(
        "import { composeSharedConfigs } from '@narduk-enterprises/eslint-config/config'",
        '',
        'export default [',
        "  ...composeSharedConfigs('core', 'correctness', 'complexity', 'formatting'),",
        "  { ignores: ['node_modules/**', '.nuxt/**', '.output/**', '.wrangler/**'] },",
        ']',
      ),
    },
    {
      path: 'apps/web/nuxt.config.ts',
      contents: text(
        "import { fileURLToPath } from 'node:url'",
        '',
        'const localPort = ' + localPort,
        'const siteUrl = ' + tsString(siteUrl),
        'const appName = ' + tsString(displayName),
        'const appDescription = ' + tsString(description),
        '',
        'export default defineNuxtConfig({',
        '  compatibilityDate: ' + tsString(DEFAULT_COMPATIBILITY_DATE) + ',',
        '  future: {',
        '    compatibilityVersion: 4,',
        '  },',
        modules,
        '  alias: {',
        "    '#narduk-db': fileURLToPath(new URL('./server/database/schema.ts', import.meta.url)),",
        '  },',
        '  devServer: {',
        '    port: localPort,',
        '  },',
        ...(capabilities.includes('seo')
          ? [
              '  fonts: {',
              "    defaults: { subsets: ['latin'] },",
              '  },',
              '  sitemap: {',
              '    zeroRuntime: true,',
              '  },',
            ]
          : []),
        '  site: {',
        '    name: appName,',
        '    url: siteUrl,',
        '  },',
        ...(capabilities.includes('seo') ? ["  routeRules: { '/': { prerender: true } },"] : []),
        '  runtimeConfig: {',
        "    xaiApiKey: process.env.XAI_API_KEY || '',",
        '    public: {',
        '      appDescription,',
        '      appName,',
        '      appUrl: siteUrl,',
        '      localPort,',
        '      siteUrl,',
        '    },',
        '  },',
        '  nitro: {',
        "    preset: 'cloudflare_module',",
        '    openAPI: {',
        '      meta: {',
        '        title: ' + tsString(displayName + ' API') + ',',
        '        description: appDescription,',
        "        version: '0.1.0',",
        '      },',
        '    },',
        '  },',
        '})',
      ),
    },
    {
      path: 'apps/web/package.json',
      contents: createWebPackageManifest(appName, capabilities, localPort, {
        description,
        displayName,
        siteUrl,
      }),
    },
    {
      path: 'apps/web/server/api/health.get.ts',
      contents: text(
        'export default defineEventHandler(() => ({',
        '  ok: true,',
        '  app: ' + tsString(appName) + ',',
        '}))',
      ),
    },
    {
      path: 'apps/web/server/database/schema.ts',
      contents: text(
        "import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'",
        '',
        "export const appRecords = sqliteTable('app_records', {",
        "  id: text('id').primaryKey(),",
        "  label: text('label').notNull(),",
        "  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),",
        '})',
        '',
        'export type AppRecord = typeof appRecords.$inferSelect',
        'export type NewAppRecord = typeof appRecords.$inferInsert',
      ),
    },
    {
      path: 'apps/web/server/utils/database.ts',
      contents: text(
        "import { createAppDatabase } from '@narduk-enterprises/narduk-core/server/utils/database'",
        '',
        "import * as schema from '#narduk-db'",
        '',
        'export const useAppDatabase = createAppDatabase(schema)',
      ),
    },
    {
      path: 'apps/web/tsconfig.json',
      contents: text(
        '{',
        '  "extends": "./.nuxt/tsconfig.json",',
        '  "compilerOptions": {',
        '    "strict": true,',
        '    "types": ["@cloudflare/workers-types"]',
        '  }',
        '}',
      ),
    },
    {
      path: 'apps/web/vitest.config.ts',
      contents: text(
        "import { defineConfig } from 'vitest/config'",
        '',
        'export default defineConfig({',
        '  test: {',
        "    environment: 'happy-dom',",
        "    include: ['tests/unit/**/*.test.ts'],",
        '  },',
        '})',
      ),
    },
    {
      path: 'apps/web/wrangler.jsonc',
      contents: text(
        '{',
        '  "name": ' + JSON.stringify(appName) + ',',
        '  "main": "./.output/server/index.mjs",',
        '  "no_bundle": true,',
        '  "find_additional_modules": true,',
        '  "base_dir": ".output/server",',
        '  "rules": [{ "type": "ESModule", "globs": ["**/*.mjs"] }],',
        '  "compatibility_date": ' + JSON.stringify(DEFAULT_COMPATIBILITY_DATE) + ',',
        '  "compatibility_flags": ["nodejs_compat"],',
        '  "d1_databases": [',
        '    {',
        '      "binding": "DB",',
        '      "database_name": ' + JSON.stringify(appName + '-db') + ',',
        '      "database_id": "00000000-0000-0000-0000-000000000000",',
        '      "migrations_dir": "drizzle",',
        '    },',
        '  ],',
        ...uploadBindingLines,
        '}',
      ),
    },
    {
      path: 'apps/web/tests/e2e/home.spec.ts',
      contents: text(
        "import { expect, test } from '@playwright/test'",
        '',
        "test('home page renders', async ({ page }) => {",
        "  await page.goto('/')",
        "  await expect(page.getByRole('heading', { name: " +
          tsString(displayName) +
          ' })).toBeVisible()',
        '})',
      ),
    },
    {
      path: 'apps/web/tests/unit/smoke.test.ts',
      contents: text(
        "import { registerAppSmokeTests } from '@narduk-enterprises/narduk-testkit/server/kit/smoke'",
        '',
        'registerAppSmokeTests({ describeName: ' + tsString(appName) + ' })',
      ),
    },
    {
      path: 'knip.json',
      contents: text(
        '{',
        '  "$schema": "https://unpkg.com/knip@6/schema.json",',
        '  "include": ["dependencies", "devDependencies", "unlisted", "binaries", "unresolved"],',
        '  "workspaces": {',
        '    "apps/web": {',
        '      "entry": ["app/pages/**/*.{ts,vue}", "server/api/**/*.ts", "server/utils/**/*.ts"],',
        '      "project": ["**/*.{ts,mts,vue,js,mjs}"],',
        '      "paths": {',
        '        "#narduk-db": ["server/database/schema.ts"]',
        '      }',
        '    }',
        '  },',
        '  "ignoreDependencies": [' +
          knipIgnoreDependencies.map((dependency) => JSON.stringify(dependency)).join(', ') +
          ']',
        '}',
      ),
    },
    {
      path: 'apps/web/migrations.sources.json',
      contents: createMigrationSourcesManifest(capabilities),
    },
    {
      path: 'package.json',
      contents: createRootPackageManifest(appName, capabilities, visibility),
    },
    {
      path: 'playwright.config.ts',
      contents: text(
        "import { defineConfig, devices } from '@playwright/test'",
        '',
        'export default defineConfig({',
        "  testDir: './apps/web/tests/e2e',",
        '  fullyParallel: true,',
        '  forbidOnly: Boolean(process.env.CI),',
        '  retries: process.env.CI ? 2 : 0,',
        "  reporter: 'line',",
        '  use: {',
        "    baseURL: 'http://127.0.0.1:" + localPort + "',",
        "    trace: 'on-first-retry',",
        '  },',
        '  webServer: {',
        '    command:',
        "      'NUXT_SESSION_PASSWORD=narduk-test-only-session-password-000000 NUXT_OG_IMAGE_SECRET=narduk-test-only-og-image-secret-000000 pnpm --filter web run dev:test',",
        "    url: 'http://127.0.0.1:" + localPort + "',",
        '    reuseExistingServer: !process.env.CI,',
        '  },',
        '  projects: [',
        '    {',
        "      name: 'chromium',",
        "      use: { ...devices['Desktop Chrome'] },",
        '    },',
        '  ],',
        '})',
      ),
    },
    {
      path: 'pnpm-workspace.yaml',
      contents: text('packages:', '  - apps/*'),
    },
    {
      path: 'prettier.config.mjs',
      contents: text(
        'export default {',
        '  semi: false,',
        '  singleQuote: true,',
        "  trailingComma: 'all',",
        '  printWidth: 100,',
        "  endOfLine: 'lf',",
        '}',
      ),
    },
    {
      path: 'renovate.json',
      contents: text(
        '{',
        '  "extends": ["config:recommended"],',
        '  "packageRules": [',
        '    {',
        '      "rangeStrategy": "pin",',
        '      "matchManagers": ["pnpm"]',
        '    },',
        '    {',
        '      "groupName": "narduk libraries",',
        '      "matchPackageNames": ["@narduk-enterprises/**"],',
        '      "rangeStrategy": "pin"',
        '    },',
        '    {',
        '      "groupName": "narduk mapkit",',
        '      "matchPackageNames": ["@narduk-geo/narduk-mapkit", "@narduk-geo/narduk-mapkit-nuxt"],',
        '      "rangeStrategy": "pin"',
        '    }',
        '  ]',
        '}',
      ),
    },
  ]

  return files.sort((left, right) => compareStrings(left.path, right.path))
}

async function directoryIsNonEmpty(targetDir: string): Promise<boolean> {
  if (!existsSync(targetDir)) return false
  const entries = await readdir(targetDir)
  return entries.length > 0
}

function safeRelativePath(targetDir: string, filePath: string): string {
  const normalized = relative(targetDir, filePath)
  if (!normalized || normalized.startsWith('..' + sep) || normalized === '..') {
    throw new CreateNardukAppError('Refusing to write outside target directory: ' + filePath)
  }
  return normalized
}

export function buildGeneratedFiles(options: CreateNardukAppOptions): GeneratedFile[] {
  return filesFor(normalizeOptions(options))
}

export async function createNardukApp(
  options: CreateNardukAppOptions,
): Promise<CreateNardukAppReport> {
  const targetDir = resolve(options.targetDir)
  const force = options.force ?? false
  const normalized = normalizeOptions(options)
  const files = filesFor(normalized)

  if (existsSync(targetDir)) {
    const targetStats = await stat(targetDir)
    if (!targetStats.isDirectory()) {
      throw new CreateNardukAppError('Target path is not a directory: ' + targetDir)
    }
    if (!force && (await directoryIsNonEmpty(targetDir))) {
      throw new CreateNardukAppError(
        'Target directory is not empty: ' +
          targetDir +
          '. Choose an empty directory or pass force: true.',
      )
    }
  } else {
    await mkdir(targetDir, { recursive: true })
  }

  for (const file of files) {
    const destination = resolve(targetDir, file.path)
    safeRelativePath(targetDir, destination)
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, file.contents, 'utf8')
  }

  const gitInitialized = !options.noGit
  if (gitInitialized) await initializeGit(targetDir)

  return {
    appName: normalized.appName,
    capabilities: normalized.capabilities,
    description: normalized.description,
    displayName: normalized.displayName,
    files: files.map((file) => file.path),
    generator: { name: GENERATOR_NAME, version: GENERATOR_VERSION },
    gitInitialized,
    localPort: normalized.localPort,
    packageVersions: packageVersionsForCapabilities(normalized.capabilities),
    schemaVersion: 1,
    siteUrl: normalized.siteUrl,
    targetDir,
    validationResults: [
      {
        check: 'capabilities',
        detail: `Validated ${normalized.capabilities.length} explicit capability selection(s); core is implicit.`,
        passed: true,
      },
      {
        check: 'exact-package-versions',
        detail: 'Every generated package dependency uses an exact SemVer version.',
        passed: true,
      },
      {
        check: 'generated-paths',
        detail: `Validated ${files.length} generated path(s) inside the target directory.`,
        passed: true,
      },
    ],
    visibility: normalized.visibility,
    ...(normalized.productSpec ? { productSpec: normalized.productSpec } : {}),
  }
}

async function initializeGit(targetDir: string): Promise<void> {
  const { execFile } = await import('node:child_process')
  await new Promise<void>((resolvePromise, reject) => {
    execFile('git', ['init', '--quiet'], { cwd: targetDir }, (error) => {
      if (error)
        reject(new CreateNardukAppError('Unable to initialize local git: ' + error.message))
      else resolvePromise()
    })
  })
}
