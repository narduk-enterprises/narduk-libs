import type { Capability, ProductSpec } from './types.js'

export const PACKAGE_VERSIONS = {
  '@cloudflare/workers-types': '5.20260714.1',
  '@iconify-json/lucide': '1.2.108',
  '@narduk-geo/narduk-mapkit': '1.0.0',
  '@narduk-geo/narduk-mapkit-nuxt': '1.0.0',
  '@narduk-enterprises/narduk-app-tools': '0.1.2',
  '@narduk-enterprises/eslint-config': '1.2.17',
  '@narduk-enterprises/narduk-ai': '0.1.2',
  '@narduk-enterprises/narduk-analytics': '1.19.23',
  '@narduk-enterprises/narduk-auth': '1.19.29',
  '@narduk-enterprises/narduk-core': '1.20.1',
  '@narduk-enterprises/narduk-seo': '2.0.1',
  '@narduk-enterprises/narduk-testkit': '1.0.0',
  '@narduk-enterprises/narduk-uploads': '1.19.18',
  '@nuxt/test-utils': '4.0.3',
  '@nuxt/ui': '4.6.0',
  '@playwright/test': '1.61.1',
  '@tailwindcss/vite': '4.2.1',
  '@types/node': '22.19.19',
  '@typescript-eslint/utils': '8.64.0',
  'drizzle-kit': '0.31.10',
  'drizzle-orm': '0.45.2',
  esbuild: '0.28.1',
  eslint: '9.39.4',
  glob: '13.0.6',
  'happy-dom': '20.9.0',
  knip: '6.14.1',
  nuxt: '4.4.8',
  '@nuxt/eslint': '1.15.2',
  // nuxt-og-image 6.7.3 moved to `@nuxt/kit@^4.5.0`; 6.7.2 is the release built
  // for the `@nuxt/kit` that the pinned Nuxt above ships. narduk-seo pins the
  // 6.7.4 release because a Nuxt-less consumer install resolves @nuxt/kit 4.5.0
  // and needs its oxc-parser 0.140 line, so the app pins its own Nuxt block.
  'nuxt-og-image': '6.7.2',
  prettier: '3.8.3',
  tailwindcss: '4.2.1',
  typescript: '5.9.3',
  vitest: '4.1.6',
  'vue-tsc': '3.2.5',
  wrangler: '4.110.0',
  zod: '4.4.3',
} as const

const capabilityPackages: Record<Capability, readonly string[]> = {
  ai: ['@narduk-enterprises/narduk-ai'],
  analytics: ['@narduk-enterprises/narduk-analytics'],
  auth: ['@narduk-enterprises/narduk-auth'],
  mapkit: ['@narduk-geo/narduk-mapkit', '@narduk-geo/narduk-mapkit-nuxt'],
  seo: ['@narduk-enterprises/narduk-seo'],
  uploads: ['@narduk-enterprises/narduk-uploads'],
}

export function packageNameForCapability(capability: Capability): string {
  return capabilityPackages[capability][0] as string
}

export function packageNamesForCapability(capability: Capability): readonly string[] {
  return capabilityPackages[capability]
}

export function packageVersionsForCapabilities(
  capabilities: readonly Capability[],
): Record<string, string> {
  const names = [
    ...Object.keys(dependencyEntries(capabilities)),
    ...Object.keys(devDependencyEntries()),
    '@narduk-enterprises/eslint-config',
    '@nuxt/eslint',
    '@typescript-eslint/utils',
    'esbuild',
    'glob',
    'knip',
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
    ...capabilities.flatMap(packageNamesForCapability),
    '@nuxt/ui',
    'drizzle-orm',
    'nuxt',
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
    '@narduk-enterprises/narduk-app-tools',
    '@narduk-enterprises/narduk-testkit',
    '@playwright/test',
    '@types/node',
    'drizzle-kit',
    'eslint',
    'happy-dom',
    'prettier',
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
      'cf:build': 'pnpm --filter web run cf:build',
      'cf:deploy': 'pnpm --filter web run cf:deploy',
      'cf:deploy:preview': 'pnpm --filter web run cf:deploy:preview',
      'db:migrate:local': 'pnpm --filter web run db:migrate:local',
      'db:migrate:remote': 'pnpm --filter web run db:migrate:remote',
      deploy: 'pnpm --filter web run deploy',
      'deploy:dry-run': 'pnpm --filter web run deploy:dry-run',
      'deploy:version': 'pnpm --filter web run deploy:version',
      dev: 'pnpm --filter web run dev',
      doctor: 'pnpm --filter web run doctor',
      format: 'prettier --write "**/*.{ts,mts,vue,js,mjs,json,yaml,yml,css,md}"',
      'format:check': 'prettier --check "**/*.{ts,mts,vue,js,mjs,json,yaml,yml,css,md}"',
      knip: 'knip',
      lint: 'pnpm --filter web run lint',
      'performance-budget': 'pnpm --filter web run performance-budget',
      quality:
        'pnpm run format:check && pnpm run lint && pnpm run knip && pnpm run typecheck && pnpm run build && pnpm run test',
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
    pnpm: {
      overrides: {
        '@narduk-enterprises/narduk-core': PACKAGE_VERSIONS['@narduk-enterprises/narduk-core'],
        ...(capabilities.includes('auth')
          ? {
              '@narduk-enterprises/narduk-auth':
                PACKAGE_VERSIONS['@narduk-enterprises/narduk-auth'],
            }
          : {}),
        '@nuxt/eslint': PACKAGE_VERSIONS['@nuxt/eslint'],
        // The generator pins `nuxt` exactly, so `@nuxt/kit` has to be pinned to
        // the same version. Narduk modules depend on `@nuxt/kit@^4.0.0`, so
        // without this every upstream Nuxt minor silently splits the app's kit
        // from its nuxt and drags in that kit's transitive dependency block.
        '@nuxt/kit': PACKAGE_VERSIONS.nuxt,
        'eslint-plugin-vitest>@typescript-eslint/utils':
          PACKAGE_VERSIONS['@typescript-eslint/utils'],
        esbuild: PACKAGE_VERSIONS.esbuild,
        glob: PACKAGE_VERSIONS.glob,
        ...(capabilities.includes('seo')
          ? { 'nuxt-og-image': PACKAGE_VERSIONS['nuxt-og-image'] }
          : {}),
      },
      allowedDeprecatedVersions: {
        '@esbuild-kit/core-utils': '*',
        '@esbuild-kit/esm-loader': '*',
      },
      onlyBuiltDependencies: [
        '@parcel/watcher',
        'core-js',
        'esbuild',
        'sharp',
        'unrs-resolver',
        'vue-demi',
        'workerd',
      ],
    },
  })
}

export function createWebPackageManifest(
  appName: string,
  capabilities: readonly Capability[],
  localPort: number,
  metadata: {
    description?: string
    displayName?: string
    siteUrl?: string
  } = {},
): string {
  return json({
    name: 'web',
    version: '0.1.0',
    private: true,
    type: 'module',
    ...(metadata.description ? { description: metadata.description } : {}),
    ...(metadata.siteUrl ? { homepage: metadata.siteUrl } : {}),
    scripts: {
      build: 'nuxt build',
      dev: 'narduk-app dev --project ' + appName + ' --config dev -- nuxt dev --host 127.0.0.1',
      'format:check': 'prettier --check "**/*.{ts,mts,vue,js,mjs,json,yaml,yml,css,md}"',
      lint: 'nuxt prepare && eslint . --max-warnings 0',
      'nuxt:prepare': 'nuxt prepare',
      'test:e2e': 'playwright test',
      'test:unit': 'vitest run --config vitest.config.ts',
      'cf:build': 'nuxt build --preset=cloudflare_module',
      'cf:deploy':
        'narduk-app db migrate --config migrations.sources.json --database ' +
        appName +
        '-db --remote --workers-build-only && narduk-app deploy deploy',
      'cf:deploy:preview': 'narduk-app deploy versions-upload',
      'db:migrate:local':
        'narduk-app db migrate --config migrations.sources.json --database ' +
        appName +
        '-db --local',
      'db:migrate:remote':
        'narduk-app db migrate --config migrations.sources.json --database ' +
        appName +
        '-db --remote',
      deploy: 'narduk-app deploy deploy',
      'deploy:dry-run': 'narduk-app deploy deploy --dry-run',
      'deploy:local': 'narduk-app deploy-local',
      'deploy:version': 'narduk-app deploy versions-upload',
      'dev:test': 'nuxt dev --host 127.0.0.1',
      doctor: 'narduk-app doctor',
      'performance-budget': 'narduk-app performance-budget --font-total-budget-kb 140',
      'registry-auth': 'narduk-app registry-auth',
      typecheck: 'nuxt typecheck',
    },
    narduk: {
      name: appName,
      ...(metadata.displayName
        ? { displayName: metadata.displayName, shortName: metadata.displayName }
        : {}),
      ...(metadata.siteUrl ? { url: metadata.siteUrl } : {}),
      capabilities: [...capabilities],
      localDevNuxtPort: localPort,
    },
    dependencies: dependencyEntries(capabilities),
    devDependencies: devDependencyEntries(),
  })
}

export function createMigrationSourcesManifest(capabilities: readonly Capability[]): string {
  const packageSources = [
    {
      id: '@narduk-enterprises/narduk-core',
      dir: 'node_modules/@narduk-enterprises/narduk-core/runtime/drizzle',
    },
    ...(capabilities.includes('auth')
      ? [
          {
            id: '@narduk-enterprises/narduk-auth',
            dir: 'node_modules/@narduk-enterprises/narduk-auth/drizzle',
          },
        ]
      : []),
    {
      id: 'app',
      dir: 'drizzle',
    },
  ]

  return json({
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
