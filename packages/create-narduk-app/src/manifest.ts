import type { Capability, ProductSpec } from './types.js'

export const PACKAGE_VERSIONS = {
  '@cloudflare/workers-types': '4.20260511.1',
  '@iconify-json/lucide': '1.2.108',
  '@loganrenz/narduk-mapkit': '0.2.0',
  '@narduk-enterprises/eslint-config': '1.2.17',
  '@narduk-enterprises/narduk-ai': '0.1.0',
  '@narduk-enterprises/narduk-analytics': '1.19.19',
  '@narduk-enterprises/narduk-auth': '1.19.26',
  '@narduk-enterprises/narduk-core': '1.19.40',
  '@narduk-enterprises/narduk-seo': '1.19.22',
  '@narduk-enterprises/narduk-uploads': '1.19.18',
  '@nuxt/test-utils': '4.0.3',
  '@nuxt/ui': '4.6.0',
  '@playwright/test': '1.59.1',
  '@tailwindcss/vite': '4.2.1',
  '@types/node': '22.19.19',
  'drizzle-kit': '0.31.10',
  'drizzle-orm': '0.45.2',
  eslint: '9.39.4',
  'happy-dom': '20.9.0',
  knip: '6.14.1',
  nuxt: '4.4.2',
  prettier: '3.8.3',
  tailwindcss: '4.2.1',
  typescript: '5.9.3',
  vitest: '4.1.6',
  'vue-tsc': '3.2.5',
  wrangler: '4.90.1',
  zod: '4.4.3',
} as const

const capabilityPackages: Record<Capability, string> = {
  ai: '@narduk-enterprises/narduk-ai',
  analytics: '@narduk-enterprises/narduk-analytics',
  auth: '@narduk-enterprises/narduk-auth',
  mapkit: '@loganrenz/narduk-mapkit',
  seo: '@narduk-enterprises/narduk-seo',
  uploads: '@narduk-enterprises/narduk-uploads',
}

export function packageNameForCapability(capability: Capability): string {
  return capabilityPackages[capability]
}

export function packageVersionsForCapabilities(
  capabilities: readonly Capability[],
): Record<string, string> {
  const names = [
    '@narduk-enterprises/narduk-core',
    ...capabilities.map(packageNameForCapability),
    'drizzle-orm',
    'nuxt',
    'zod',
  ]

  return Object.fromEntries(
    [...new Set(names)]
      .sort()
      .map((name) => [name, PACKAGE_VERSIONS[name as keyof typeof PACKAGE_VERSIONS]]),
  )
}

function dependencyEntries(capabilities: readonly Capability[]): Record<string, string> {
  const names = [
    '@iconify-json/lucide',
    '@narduk-enterprises/narduk-core',
    ...capabilities.map(packageNameForCapability),
    '@nuxt/ui',
    'drizzle-orm',
    'nuxt',
    'zod',
  ]

  return Object.fromEntries(
    [...new Set(names)]
      .sort()
      .map((name) => [name, PACKAGE_VERSIONS[name as keyof typeof PACKAGE_VERSIONS]]),
  )
}

function devDependencyEntries(): Record<string, string> {
  const names = [
    '@cloudflare/workers-types',
    '@narduk-enterprises/eslint-config',
    '@nuxt/test-utils',
    '@playwright/test',
    '@tailwindcss/vite',
    '@types/node',
    'drizzle-kit',
    'eslint',
    'happy-dom',
    'knip',
    'prettier',
    'tailwindcss',
    'typescript',
    'vitest',
    'vue-tsc',
    'wrangler',
  ]

  return Object.fromEntries(
    names.sort().map((name) => [name, PACKAGE_VERSIONS[name as keyof typeof PACKAGE_VERSIONS]]),
  )
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

export function createRootPackageManifest(
  appName: string,
  capabilities: readonly Capability[],
  visibility: 'private' | 'public',
): string {
  return json({
    name: appName,
    version: '0.1.0',
    private: true,
    packageManager: 'pnpm@10.33.4',
    narduk: {
      capabilities: [...capabilities],
      visibility,
    },
    scripts: {
      build: 'pnpm --filter web run build',
      dev: 'pnpm --filter web run dev',
      format: 'prettier --write "**/*.{ts,mts,vue,js,mjs,json,yaml,yml,css,md}"',
      'format:check': 'prettier --check "**/*.{ts,mts,vue,js,mjs,json,yaml,yml,css,md}"',
      knip: 'knip',
      lint: 'pnpm --filter web run lint',
      quality:
        'pnpm run format:check && pnpm run lint && pnpm run typecheck && pnpm run build && pnpm run test',
      test: 'pnpm --filter web run test:unit && pnpm exec playwright test',
      typecheck: 'pnpm --filter web run typecheck',
    },
    devDependencies: {
      '@narduk-enterprises/eslint-config': PACKAGE_VERSIONS['@narduk-enterprises/eslint-config'],
      '@playwright/test': PACKAGE_VERSIONS['@playwright/test'],
      '@types/node': PACKAGE_VERSIONS['@types/node'],
      eslint: PACKAGE_VERSIONS.eslint,
      knip: PACKAGE_VERSIONS.knip,
      prettier: PACKAGE_VERSIONS.prettier,
      typescript: PACKAGE_VERSIONS.typescript,
    },
  })
}

export function createWebPackageManifest(
  appName: string,
  capabilities: readonly Capability[],
  localPort: number,
): string {
  return json({
    name: 'web',
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: {
      build: 'nuxt build',
      dev: 'nuxt dev',
      'format:check': 'prettier --check "**/*.{ts,mts,vue,js,mjs,json,yaml,yml,css,md}"',
      lint: 'eslint . --max-warnings 0',
      'nuxt:prepare': 'nuxt prepare',
      'test:e2e': 'playwright test',
      'test:unit': 'vitest run --config vitest.config.ts',
      typecheck: 'nuxt typecheck',
    },
    narduk: {
      capabilities: [...capabilities],
      localDevNuxtPort: localPort,
    },
    dependencies: dependencyEntries(capabilities),
    devDependencies: devDependencyEntries(),
    metadata: {
      generatedBy: '@narduk-enterprises/create-narduk-app',
      appName,
    },
  })
}

export function createMigrationSourcesManifest(capabilities: readonly Capability[]): string {
  const packageSources = [
    {
      directory: 'node_modules/@narduk-enterprises/narduk-core/drizzle',
      source: '@narduk-enterprises/narduk-core',
      sourceVersion: PACKAGE_VERSIONS['@narduk-enterprises/narduk-core'],
    },
    ...(capabilities.includes('auth')
      ? [
          {
            directory: 'node_modules/@narduk-enterprises/narduk-auth/drizzle',
            source: '@narduk-enterprises/narduk-auth',
            sourceVersion: PACKAGE_VERSIONS['@narduk-enterprises/narduk-auth'],
          },
        ]
      : []),
    {
      directory: 'apps/web/drizzle',
      source: 'app',
      sourceVersion: '0.1.0',
    },
  ]

  return json({
    identity: ['source', 'filename', 'checksum'],
    schemaVersion: 1,
    sources: packageSources,
  })
}

export function createProductSpec(spec: ProductSpec | undefined): ProductSpec | undefined {
  if (!spec) return undefined
  const keys: Array<keyof ProductSpec> = [
    'audience',
    'constraints',
    'primaryAction',
    'problem',
    'successMetrics',
    'valueProposition',
  ]
  const entries = keys
    .map((key) => [key, spec[key]?.trim()] as const)
    .filter((entry): entry is readonly [keyof ProductSpec, string] => Boolean(entry[1]))

  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}
