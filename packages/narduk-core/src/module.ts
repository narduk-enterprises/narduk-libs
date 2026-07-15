import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  addComponentsDir,
  addImportsDir,
  addPlugin,
  addServerScanDir,
  addTemplate,
  createResolver,
  defineNuxtModule,
  installModule,
} from '@nuxt/kit'
import { defu } from 'defu'

import {
  applyCoreRollupBuildWarningPolicy,
  applyCoreViteBuildWarningPolicy,
  createCoreViteBuildLogger,
} from '../runtime/shared/vite-build-warnings'

const PACKAGE_NAME = '@narduk-enterprises/narduk-core'

const d1QueryHelperAutoImportSourcePattern = /(?:^|\/)server\/utils\/d1Query(?:\.ts)?$/
const authApiKeyTextAutoImportSourcePattern = /(?:^|\/)server\/utils\/authApiKeyText(?:\.ts)?$/

interface MutableNuxtIconConfig {
  serverBundle?: Record<string, unknown> | string | false
}

interface MutableNuxtOptions {
  options: {
    icon?: unknown
  }
}

interface TypeReference {
  path?: string
  types?: string
}

interface TypePrepareOptions {
  references?: TypeReference[]
  tsConfig?: {
    include?: string[]
  }
}

interface NuxtAppTemplateState {
  layouts: Record<string, { file: string; name: string }>
}

type OpenApiProductionMode = false | 'runtime' | 'prerender'

interface MutableNuxtOptionsRecord {
  alias: Record<string, string>
  app: Record<string, unknown>
  appConfig?: Record<string, unknown>
  build: {
    transpile: string[]
  }
  colorMode?: unknown
  compatibilityDate?: string
  css: string[]
  devServer?: Record<string, unknown>
  future?: Record<string, unknown>
  icon?: unknown
  nitro?: Record<string, unknown>
  runtimeConfig: Record<string, unknown>
  ui?: unknown
  vite?: Record<string, unknown> & {
    plugins?: unknown[]
  }
}

export interface NardukCoreModuleOptions {
  app?: boolean
  coreModules?: boolean
  image?: boolean
  server?: boolean
}

function pushUnique<T>(items: T[], item: T): void {
  if (!items.includes(item)) {
    items.push(item)
  }
}

function resolveDevServerPort(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65_535 ? parsed : fallback
}

function addFallbackLayout(
  nuxt: { hook: (name: 'app:templates', handler: (app: NuxtAppTemplateState) => void) => void },
  template: { src: string },
  name: string,
): void {
  const { filename } = addTemplate(template)
  nuxt.hook('app:templates', (app) => {
    if (name in app.layouts) return
    app.layouts[name] = {
      file: `#build/${filename}`,
      name,
    }
  })
}

function addNitroInlinePackage(nuxtOptions: MutableNuxtOptionsRecord, packageName: string): void {
  const nitro = (nuxtOptions.nitro ??= {}) as {
    externals?: {
      inline?: string[]
    }
  }
  nitro.externals ??= {}
  nitro.externals.inline ??= []
  pushUnique(nitro.externals.inline, packageName)
}

function allowNitroEsbuildForNardukPackages(nuxtOptions: MutableNuxtOptionsRecord): void {
  const nitro = (nuxtOptions.nitro ??= {}) as {
    esbuild?: {
      options?: Record<string, unknown>
    }
  }
  nitro.esbuild ??= {}
  nitro.esbuild.options ??= {}
  nitro.esbuild.options.exclude = /node_modules\/(?!.*@narduk-enterprises(?:\+|\/)narduk-)/
}

function identifierReferencePattern(name: string): string {
  return `(?<![\\w$])${name}(?![\\w$])`
}

function hasIdentifier(code: string, name: string): boolean {
  return new RegExp(identifierReferencePattern(name)).test(code)
}

function hasImportOrDeclaration(code: string, name: string): boolean {
  const identifier = identifierReferencePattern(name)

  return (
    new RegExp(
      `import\\s+(?:type\\s+)?(?:\\{[^}]*${identifier}[^}]*\\}|\\*\\s+as\\s+${identifier}|${identifier})`,
      'm',
    ).test(code) ||
    new RegExp(`\\b(?:export\\s+)?(?:async\\s+)?function\\s+${name}(?![\\w$])`).test(code) ||
    new RegExp(
      `\\b(?:export\\s+)?(?:const|let|var|class|interface|type)\\s+${name}(?![\\w$])`,
    ).test(code)
  )
}

function selectMissingRuntimeImports(code: string, names: string[]): string[] {
  return names.filter((name) => hasIdentifier(code, name) && !hasImportOrDeclaration(code, name))
}

function isNardukPackageServerRuntimeFile(id: string): boolean {
  const normalizedId = id.replaceAll('\\', '/')
  if (!/\.[cm]?[jt]s$/.test(normalizedId)) return false

  const packageMarker = '@narduk-enterprises/narduk-'
  const packageIndex = normalizedId.indexOf(packageMarker)
  if (packageIndex === -1) {
    return /\/packages\/narduk-[^/]+\/(?:runtime\/)?server\//.test(normalizedId)
  }

  const afterPackage = normalizedId.slice(packageIndex + packageMarker.length)
  return afterPackage.includes('/server/') || afterPackage.includes('/runtime/server/')
}

function isNardukPackageAppRuntimeFile(id: string): boolean {
  const normalizedId = id.replaceAll('\\', '/')
  const fileId = normalizedId.split('?')[0] ?? normalizedId
  if (!/\.(?:vue|[cm]?[jt]s)$/.test(fileId)) return false

  const packageMarker = '@narduk-enterprises/narduk-'
  const packageIndex = fileId.indexOf(packageMarker)
  if (packageIndex === -1) {
    return /\/packages\/narduk-[^/]+\/(?:runtime\/)?app\//.test(fileId)
  }

  const afterPackage = fileId.slice(packageIndex + packageMarker.length)
  return afterPackage.includes('/app/') || afterPackage.includes('/runtime/app/')
}

function injectAppRuntimeImports(code: string, id: string, imports: string): string | null {
  if (imports.trim() === '') return null

  const normalizedId = id.replaceAll('\\', '/')
  const fileId = normalizedId.split('?')[0] ?? normalizedId

  if (fileId.endsWith('.vue') && !normalizedId.includes('?vue&type=script')) {
    const scriptSetupMatch = /<script\s+setup\b[^>]*>/i.exec(code)
    if (!scriptSetupMatch || scriptSetupMatch.index === undefined) return null

    const insertAt = scriptSetupMatch.index + scriptSetupMatch[0].length
    return `${code.slice(0, insertAt)}\n${imports}\n${code.slice(insertAt)}`
  }

  return `${imports}\n${code}`
}

function addNardukAppRuntimeImportBridge(nuxtOptions: MutableNuxtOptionsRecord): void {
  const vite = (nuxtOptions.vite ??= {})
  vite.plugins ??= []

  if (
    vite.plugins.some(
      (plugin) =>
        typeof plugin === 'object' &&
        plugin !== null &&
        (plugin as { name?: string }).name === 'narduk-app-runtime-import-bridge',
    )
  ) {
    return
  }

  const vueImports = [
    'computed',
    'nextTick',
    'onMounted',
    'onUnmounted',
    'reactive',
    'ref',
    'shallowRef',
    'toRefs',
    'toValue',
    'unref',
    'watch',
    'watchEffect',
  ]
  const nuxtImports = [
    'clearError',
    'createError',
    'defineNuxtPlugin',
    'defineNuxtRouteMiddleware',
    'defineOgImage',
    'definePageMeta',
    'formatBuildTimeLocal',
    'navigateTo',
    'reloadNuxtApp',
    'useAdminOgImagePreviews',
    'useAppConfig',
    'useAppFetch',
    'useAsyncData',
    'useAuth',
    'useAuthRuntimePublic',
    'useColorModeToggle',
    'useCookie',
    'useCsrfFetch',
    'useFetch',
    'useHead',
    'useItemListSchema',
    'useManagedSupabaseClient',
    'useNardukNetworkDirectory',
    'useNotifications',
    'useNuxtApp',
    'useOgImageData',
    'useRequestURL',
    'useRoute',
    'useRouter',
    'useRuntimeConfig',
    'useSeo',
    'useSeoMeta',
    'useSiteConfig',
    'useState',
    'useToast',
    'useUserSession',
    'useWebPageSchema',
    'useWebSiteSchema',
  ]

  vite.plugins.push({
    name: 'narduk-app-runtime-import-bridge',
    enforce: 'pre',
    transform(code: string, id: string) {
      if (!isNardukPackageAppRuntimeFile(id)) return null

      const importGroups: Array<[string[], string]> = [
        [selectMissingRuntimeImports(code, vueImports), 'vue'],
        [selectMissingRuntimeImports(code, nuxtImports), '#imports'],
      ]

      const imports = importGroups
        .filter(([names]) => names.length > 0)
        .map(([names, from]) => `import { ${names.sort().join(', ')} } from '${from}'`)
        .join('\n')

      const transformed = injectAppRuntimeImports(code, id, imports)
      if (!transformed) return null

      return {
        code: transformed,
        map: null,
      }
    },
  })
}

function addNardukServerRuntimeImportBridge(nuxtOptions: MutableNuxtOptionsRecord): void {
  const nitro = (nuxtOptions.nitro ??= {}) as {
    rollupConfig?: {
      onwarn?: (warning: unknown, warn: (warning: unknown) => void) => unknown
      plugins?: Array<{ name?: string } | unknown>
    }
  }
  nitro.rollupConfig ??= {}
  applyCoreRollupBuildWarningPolicy(nitro.rollupConfig)
  nitro.rollupConfig.plugins ??= []

  if (
    nitro.rollupConfig.plugins.some(
      (plugin) =>
        typeof plugin === 'object' &&
        plugin !== null &&
        (plugin as { name?: string }).name === 'narduk-server-runtime-import-bridge',
    )
  ) {
    return
  }

  const h3Imports = [
    'appendResponseHeader',
    'createError',
    'defineEventHandler',
    'deleteCookie',
    'getCookie',
    'getQuery',
    'getRequestHeader',
    'getRequestHeaders',
    'getRequestURL',
    'getRouterParam',
    'getValidatedQuery',
    'readBody',
    'sendRedirect',
    'setCookie',
    'setResponseHeader',
    'setResponseHeaders',
    'setResponseStatus',
  ]
  const nitroImports = ['defineNitroPlugin', 'useRuntimeConfig']
  const coreDatabaseImports = ['useDatabase']
  const coreLoggerImports = ['useLogger']

  nitro.rollupConfig.plugins.push({
    name: 'narduk-server-runtime-import-bridge',
    transform(code: string, id: string) {
      if (!isNardukPackageServerRuntimeFile(id)) return null

      const importGroups: Array<[string[], string]> = [
        [selectMissingRuntimeImports(code, h3Imports), 'h3'],
        [selectMissingRuntimeImports(code, nitroImports), 'nitropack/runtime'],
        [selectMissingRuntimeImports(code, coreDatabaseImports), '#layer/server/utils/database'],
        [selectMissingRuntimeImports(code, coreLoggerImports), '#layer/server/utils/logger'],
      ]

      const imports = importGroups
        .filter(([names]) => names.length > 0)
        .map(([names, from]) => `import { ${names.sort().join(', ')} } from '${from}'`)

      if (imports.length === 0) return null
      return {
        code: `${imports.join('\n')}\n${code}`,
        map: null,
      }
    },
  })
}

function readPackageVersion(): string {
  const candidates = [
    resolve(process.cwd(), 'apps/web/package.json'),
    resolve(process.cwd(), 'package.json'),
  ]

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue

    try {
      const parsed = JSON.parse(readFileSync(candidate, 'utf-8')) as { version?: string }
      if (parsed.version) return parsed.version
    } catch {
      // Ignore malformed or unreadable package manifests and fall through.
    }
  }

  return ''
}

function readGitSha(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

function isAuthApiKeyTextAutoImportSource(file: string): boolean {
  return authApiKeyTextAutoImportSourcePattern.test(file)
}

function shouldScanNitroAutoImportSource(file: string): boolean {
  return !d1QueryHelperAutoImportSourcePattern.test(file) && !isAuthApiKeyTextAutoImportSource(file)
}

function dedupeIconServerCollections(nuxt: MutableNuxtOptions) {
  const { icon } = nuxt.options
  if (!icon || typeof icon !== 'object') return
  if (!('serverBundle' in icon)) return

  const { serverBundle } = icon as MutableNuxtIconConfig
  if (!serverBundle || typeof serverBundle !== 'object') return

  const { collections } = serverBundle
  if (!Array.isArray(collections)) return

  serverBundle.collections = [...new Set(collections)]
}

function dedupeIconServerCollectionsModule(_: unknown, nuxt: MutableNuxtOptions) {
  dedupeIconServerCollections(nuxt)
}

function registerTypeReference(options: TypePrepareOptions, path: string): void {
  options.references ??= []
  if (!options.references.some((reference) => reference.path === path)) {
    options.references.push({ path })
  }

  options.tsConfig ??= {}
  options.tsConfig.include ??= []
  if (!options.tsConfig.include.includes(path)) {
    options.tsConfig.include.push(path)
  }
}

export default defineNuxtModule<NardukCoreModuleOptions>({
  meta: {
    name: PACKAGE_NAME,
    configKey: 'nardukCore',
    compatibility: { nuxt: '>=3.16.0' },
  },
  defaults: {
    app: true,
    coreModules: true,
    image: true,
    server: true,
  },
  async setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)
    const runtimeRoot = resolver.resolve('../runtime')
    const nuxtOptions = nuxt.options as unknown as MutableNuxtOptionsRecord
    const databaseBackend = process.env.NUXT_DATABASE_BACKEND === 'postgres' ? 'postgres' : 'd1'
    const appVersion =
      process.env.APP_VERSION || process.env.npm_package_version || readPackageVersion()
    const buildVersion =
      process.env.BUILD_VERSION ||
      process.env.GITHUB_SHA?.slice(0, 12) ||
      process.env.CF_PAGES_COMMIT_SHA?.slice(0, 12) ||
      readGitSha() ||
      appVersion
    const buildTime = process.env.BUILD_TIME || new Date().toISOString()
    const openApiProduction: OpenApiProductionMode = (() => {
      switch (process.env.NUXT_OPENAPI_PRODUCTION) {
        case 'false':
        case 'disabled':
          return false
        case 'runtime':
          return 'runtime'
        default:
          return 'prerender'
      }
    })()
    const colorModePreference = process.env.NUXT_COLOR_MODE_PREFERENCE || 'system'
    const devServerPort = resolveDevServerPort(process.env.NUXT_PORT, 3000)
    const ormTablesEntry =
      databaseBackend === 'postgres' ? 'server/database/pg-schema.ts' : 'server/database/schema.ts'
    const postgresRuntimeEntry =
      process.env.NUXT_DATABASE_BACKEND === 'postgres'
        ? 'internal/postgres-runtime.ts'
        : 'internal/postgres-runtime.stub.ts'
    const includeLegacyUtilitiesCss = !['0', 'false', 'off'].includes(
      (process.env.NARDUK_CORE_LEGACY_UTILITIES ?? '').trim().toLowerCase(),
    )
    const allowGeolocation = ['1', 'true', 'yes', 'on'].includes(
      (process.env.NUXT_PUBLIC_ALLOW_GEOLOCATION ?? '').trim().toLowerCase(),
    )
    const verboseBuildLogs = ['1', 'true', 'yes', 'on'].includes(
      (process.env.NARDUK_VERBOSE_BUILD_LOGS ?? '').trim().toLowerCase(),
    )
    const coreRuntimeConfigTypesPath = resolver.resolve(
      '../runtime/shared/types/runtime-config.d.ts',
    )

    pushUnique(nuxtOptions.build.transpile, PACKAGE_NAME)

    nuxtOptions.alias = {
      ...nuxtOptions.alias,
      '#layer': runtimeRoot,
      '#narduk-core/schema': resolver.resolve(`../runtime/${ormTablesEntry}`),
      '#narduk-core/postgres-runtime': resolver.resolve(`../runtime/${postgresRuntimeEntry}`),
    }

    if (options.coreModules) {
      dedupeIconServerCollections({ options: nuxtOptions })
      await installModule('@pinia/nuxt')
      await installModule('@nuxtjs/color-mode')
      await installModule('@nuxt/ui')
      await installModule('@nuxt/fonts')
      if (options.image !== false) {
        await installModule('@nuxt/image')
      }
      await installModule('@nuxt/eslint')
      await installModule('nuxt-auth-utils')
      dedupeIconServerCollectionsModule(null, { options: nuxtOptions })
    }

    if (options.app) {
      addImportsDir(resolver.resolve('../runtime/app/composables'))
      addImportsDir(resolver.resolve('../runtime/app/stores'))
      addImportsDir(resolver.resolve('../runtime/app/utils'))
      addComponentsDir({
        path: resolver.resolve('../runtime/app/components'),
        pathPrefix: false,
      })
      addPlugin(resolver.resolve('../runtime/app/plugins/00-runtime-public.client'))
      addPlugin(resolver.resolve('../runtime/app/plugins/build-info.client'))
      addPlugin(resolver.resolve('../runtime/app/plugins/build-meta'))
      addPlugin(resolver.resolve('../runtime/app/plugins/fetch.client'))
      addFallbackLayout(
        nuxt,
        { src: resolver.resolve('../runtime/app/layouts/dashboard.vue') },
        'dashboard',
      )
      addFallbackLayout(
        nuxt,
        { src: resolver.resolve('../runtime/app/layouts/landing.vue') },
        'landing',
      )

      pushUnique(
        nuxtOptions.css,
        fileURLToPath(new URL('../runtime/app/assets/css/main.css', import.meta.url)),
      )
      if (includeLegacyUtilitiesCss) {
        pushUnique(
          nuxtOptions.css,
          fileURLToPath(new URL('../runtime/app/assets/css/legacy-utilities.css', import.meta.url)),
        )
      }
    }

    if (options.server) {
      addServerScanDir(resolver.resolve('../runtime/server'))
    }

    nuxtOptions.appConfig = defu((nuxtOptions.appConfig ?? {}) as Record<string, unknown>, {
      ui: {
        colors: {
          primary: 'emerald',
          neutral: 'slate',
        },
      },
    })

    nuxtOptions.runtimeConfig = defu(nuxtOptions.runtimeConfig, {
      databaseBackend,
      hyperdriveBinding: process.env.NUXT_HYPERDRIVE_BINDING || 'HYPERDRIVE',
      rateLimitPolicies: {},
      cronSecret: process.env.CRON_SECRET || '',
      logLevel: process.env.LOG_LEVEL || 'warn',
      session: {
        password: process.env.NUXT_SESSION_PASSWORD || '',
      },
      public: {
        appVersion,
        buildVersion,
        buildTime,
        cspScriptSrc: process.env.CSP_SCRIPT_SRC || '',
        cspConnectSrc: process.env.CSP_CONNECT_SRC || '',
        cspFrameSrc: process.env.CSP_FRAME_SRC || '',
        cspWorkerSrc: process.env.CSP_WORKER_SRC || '',
        allowGeolocation,
      },
    })

    nuxtOptions.compatibilityDate ??= '2026-03-03'
    nuxtOptions.devServer = defu((nuxtOptions.devServer ?? {}) as Record<string, unknown>, {
      port: devServerPort,
    })
    nuxtOptions.future = defu((nuxtOptions.future ?? {}) as Record<string, unknown>, {
      compatibilityVersion: 4,
    })
    nuxtOptions.ui = defu((nuxtOptions.ui ?? {}) as Record<string, unknown>, { colorMode: true })
    nuxtOptions.colorMode = defu((nuxtOptions.colorMode ?? {}) as Record<string, unknown>, {
      preference: colorModePreference,
      fallback: 'dark',
    })
    nuxtOptions.icon = defu((nuxtOptions.icon ?? {}) as Record<string, unknown>, {
      provider: 'server',
      fallbackToApi: false,
      serverBundle: {
        collections: ['lucide'],
        remote: false,
      },
    })
    nuxtOptions.vite = defu((nuxtOptions.vite ?? {}) as Record<string, unknown>, {
      customLogger: createCoreViteBuildLogger(),
      logLevel: 'warn' as const,
      build: {
        reportCompressedSize: false,
      },
    })
    nuxtOptions.nitro = defu((nuxtOptions.nitro ?? {}) as Record<string, unknown>, {
      preset: 'cloudflare-module',
      logLevel: verboseBuildLogs ? 3 : 1,
      logging: {
        compressedSizes: verboseBuildLogs,
        buildSuccess: true,
      },
      experimental: {
        openAPI: true,
      },
      imports: {
        dirsScanOptions: {
          fileFilter: shouldScanNitroAutoImportSource,
        },
        exclude: [
          /nuxt-auth-utils\/dist\/runtime\/server\/utils\/password/,
          d1QueryHelperAutoImportSourcePattern,
          authApiKeyTextAutoImportSourcePattern,
        ],
      },
      openAPI: {
        meta: {
          title: process.env.APP_NAME?.trim()
            ? `${process.env.APP_NAME.trim()} API`
            : 'Application API',
          description: 'Auto-generated OpenAPI specification for this application.',
          version: appVersion || '0.0.0',
        },
        production: openApiProduction,
        ui: {
          scalar: false,
          swagger: false as const,
        },
      },
      esbuild: {
        options: {
          target: 'esnext',
        },
      },
      externals: {
        inline: ['drizzle-orm', 'postgres'],
      },
    })
    addNitroInlinePackage(nuxtOptions, PACKAGE_NAME)
    allowNitroEsbuildForNardukPackages(nuxtOptions)
    addNardukAppRuntimeImportBridge(nuxtOptions)
    addNardukServerRuntimeImportBridge(nuxtOptions)
    ;(nuxt.hook as (name: string, handler: (value: TypePrepareOptions) => void) => void)(
      'nitro:prepare:types',
      (prepareOptions) => {
        registerTypeReference(prepareOptions, coreRuntimeConfigTypesPath)
      },
    )
    nuxt.hook('prepare:types', (prepareOptions) => {
      registerTypeReference(prepareOptions, coreRuntimeConfigTypesPath)
    })
    nuxt.hook('imports:extend', (imports) => {
      for (let i = imports.length - 1; i >= 0; i--) {
        const entry = imports[i]
        if (typeof entry?.from === 'string' && isAuthApiKeyTextAutoImportSource(entry.from)) {
          imports.splice(i, 1)
          continue
        }

        if (
          entry?.name === 'options' &&
          typeof entry.from === 'string' &&
          entry.from.includes('useResizable')
        ) {
          imports.splice(i, 1)
        }
      }
    })
    nuxt.hook('vite:extendConfig', (config) => {
      applyCoreViteBuildWarningPolicy(config)
    })
  },
})
