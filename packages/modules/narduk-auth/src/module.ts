import { fileURLToPath } from 'node:url'

import {
  addComponentsDir,
  addImportsDir,
  addServerScanDir,
  addTemplate,
  createResolver,
  defineNuxtModule,
  extendPages,
  extendRouteRules,
} from '@nuxt/kit'
import { defu } from 'defu'

// Explicit import (not a Nuxt auto-import): module setup runs in Node before Nuxt app auto-imports exist.
import { resolveAuthEnvironment as resolveAuthEnvironmentConfig } from '../shared/utils/auth-environment'

const PACKAGE_NAME = '@narduk-enterprises/narduk-auth'
const AUTH_PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store' as const,
  'X-Robots-Tag': 'noindex, nofollow' as const,
}
const AUTH_CLIENT_ROUTE_RULE = { ssr: false, headers: AUTH_PRIVATE_HEADERS } as const
const D1_QUERY_HELPER_AUTO_IMPORT_SOURCE_PATTERN = /(?:^|\/)server\/utils\/d1Query(?:\.ts)?$/
const authApiKeyTextAutoImportSourcePattern = /(?:^|\/)server\/utils\/authApiKeyText(?:\.ts)?$/

interface MutableNuxtOptionsRecord {
  alias: Record<string, string>
  appConfig?: Record<string, unknown>
  build: {
    transpile: string[]
  }
  nitro?: Record<string, unknown>
  runtimeConfig: Record<string, unknown>
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

interface NuxtAppResolveState {
  middleware: Array<{ name?: string; path: string }>
}

export interface NardukAuthModuleOptions {
  app?: boolean
  server?: boolean
}

function pushUnique<T>(items: T[], item: T): void {
  if (!items.includes(item)) {
    items.push(item)
  }
}

function shouldScanNitroAutoImportSource(file: string): boolean {
  if (D1_QUERY_HELPER_AUTO_IMPORT_SOURCE_PATTERN.test(file)) return false
  if (authApiKeyTextAutoImportSourcePattern.test(file)) return false
  return true
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

function addFallbackRouteMiddleware(
  nuxt: { hook: (name: 'app:resolve', handler: (app: NuxtAppResolveState) => void) => void },
  middleware: { name: string; path: string },
): void {
  nuxt.hook('app:resolve', (app) => {
    if (app.middleware.some((item) => item.name === middleware.name)) return
    app.middleware.push({ ...middleware })
  })
}

function addPageIfMissing(
  pages: Array<{ file?: string; name?: string; path?: string }>,
  page: { file: string; name: string; path: string },
): void {
  if (!pages.some((existing) => existing.path === page.path)) {
    pages.push(page)
  }
}

export default defineNuxtModule<NardukAuthModuleOptions>({
  meta: {
    name: PACKAGE_NAME,
    configKey: 'nardukAuth',
    compatibility: { nuxt: '>=3.16.0' },
  },
  defaults: {
    app: true,
    server: true,
  },
  setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)
    const nuxtOptions = nuxt.options as unknown as MutableNuxtOptionsRecord
    const authUserTypesPath = fileURLToPath(new URL('../app/types/auth.d.ts', import.meta.url))
    const authRuntimeConfigTypesPath = fileURLToPath(
      new URL('../shared/types/runtime-config.d.ts', import.meta.url),
    )
    const {
      appBackendPreset,
      authAuthorityUrl,
      authBackend,
      authProviders,
      supabasePublishableKey,
      supabaseServiceRoleKey,
      supabaseUrl,
    } = resolveAuthEnvironmentConfig(process.env)

    pushUnique(nuxtOptions.build.transpile, PACKAGE_NAME)
    addNitroInlinePackage(nuxtOptions, PACKAGE_NAME)
    nuxtOptions.alias = {
      ...nuxtOptions.alias,
      '#narduk-auth-server': resolver.resolve('../server'),
    }

    if (options.app) {
      addImportsDir(resolver.resolve('../app/composables'))
      addImportsDir(resolver.resolve('../app/utils'))
      addComponentsDir({
        path: resolver.resolve('../app/components'),
        pathPrefix: false,
      })
      addFallbackLayout(nuxt, { src: resolver.resolve('../app/layouts/auth.vue') }, 'auth')
      addFallbackLayout(nuxt, { src: resolver.resolve('../app/layouts/blank.vue') }, 'blank')
      addFallbackRouteMiddleware(nuxt, {
        name: 'auth',
        path: resolver.resolve('../app/middleware/auth.ts'),
      })
      addFallbackRouteMiddleware(nuxt, {
        name: 'guest',
        path: resolver.resolve('../app/middleware/guest.ts'),
      })
      extendPages((pages) => {
        addPageIfMissing(pages, {
          name: 'auth-native',
          path: '/auth/native',
          file: resolver.resolve('../app/pages/auth/native.vue'),
        })
        addPageIfMissing(pages, {
          name: 'auth-callback',
          path: '/auth/callback',
          file: resolver.resolve('../app/pages/auth/callback.vue'),
        })
        addPageIfMissing(pages, {
          name: 'auth-confirm',
          path: '/auth/confirm',
          file: resolver.resolve('../app/pages/auth/confirm.vue'),
        })
        addPageIfMissing(pages, {
          name: 'dashboard',
          path: '/dashboard',
          file: resolver.resolve('../app/pages/dashboard/index.vue'),
        })
        addPageIfMissing(pages, {
          name: 'login',
          path: '/login',
          file: resolver.resolve('../app/pages/login.vue'),
        })
        addPageIfMissing(pages, {
          name: 'logout',
          path: '/logout',
          file: resolver.resolve('../app/pages/logout.vue'),
        })
        addPageIfMissing(pages, {
          name: 'register',
          path: '/register',
          file: resolver.resolve('../app/pages/register.vue'),
        })
        addPageIfMissing(pages, {
          name: 'reset-password',
          path: '/reset-password',
          file: resolver.resolve('../app/pages/reset-password.vue'),
        })
        addPageIfMissing(pages, {
          name: 'settings',
          path: '/settings',
          file: resolver.resolve('../app/pages/settings/index.vue'),
        })
        addPageIfMissing(pages, {
          name: 'settings-api-keys',
          path: '/settings/api-keys',
          file: resolver.resolve('../app/pages/settings/api-keys.vue'),
        })
        addPageIfMissing(pages, {
          name: 'settings-passkeys',
          path: '/settings/passkeys',
          file: resolver.resolve('../app/pages/settings/passkeys.vue'),
        })
      })
    }

    if (options.server) {
      addServerScanDir(resolver.resolve('../server'))
    }

    nuxtOptions.appConfig = defu((nuxtOptions.appConfig ?? {}) as Record<string, unknown>, {
      auth: {
        redirectPath: '/dashboard/',
      },
    })
    nuxtOptions.nitro = defu((nuxtOptions.nitro ?? {}) as Record<string, unknown>, {
      imports: {
        dirsScanOptions: {
          fileFilter: shouldScanNitroAutoImportSource,
        },
        exclude: [
          /nuxt-auth-utils\/dist\/runtime\/server\/utils\/password/,
          D1_QUERY_HELPER_AUTO_IMPORT_SOURCE_PATTERN,
          authApiKeyTextAutoImportSourcePattern,
        ],
      },
    })
    nuxtOptions.runtimeConfig = defu(nuxtOptions.runtimeConfig, {
      appBackendPreset,
      authBackend,
      authAuthorityUrl,
      authAnonKey: supabasePublishableKey,
      authServiceRoleKey: supabaseServiceRoleKey,
      authStorageKey: process.env.AUTH_STORAGE_KEY || 'web-auth',
      authNativeClients: [],
      authLocalEmailVerification: false,
      turnstileSecretKey: process.env.TURNSTILE_SECRET_KEY || '',
      supabaseUrl,
      supabasePublishableKey,
      supabaseServiceRoleKey,
      public: {
        appBackendPreset,
        authBackend,
        authAuthorityUrl,
        authLoginPath: '/login',
        authRegisterPath: '/register',
        authCallbackPath: '/auth/callback',
        authConfirmPath: '/auth/confirm',
        authResetPath: '/reset-password',
        authLogoutPath: '/logout',
        authRedirectPath: '/dashboard/',
        authProviders,
        enforceCanonicalHost:
          process.env.ENFORCE_CANONICAL_HOST === 'true' ||
          process.env.AUTH_ENFORCE_CANONICAL_HOST === 'true',
        authEnforceCanonicalHost: process.env.AUTH_ENFORCE_CANONICAL_HOST === 'true',
        authPublicSignup: process.env.AUTH_PUBLIC_SIGNUP !== 'false',
        authRequireMfa: process.env.AUTH_REQUIRE_MFA === 'true',
        authTurnstileSiteKey: process.env.TURNSTILE_SITE_KEY || '',
        supabaseUrl,
        supabasePublishableKey,
      },
    })

    // Assigned after the defaults merge so it holds whatever the app authored:
    // narduk-core's /api/health then verifies the auth tables, and its build
    // rejects this module in an app that declares databaseBackend 'none'.
    const nardukHealth = nuxtOptions.runtimeConfig.nardukHealth
    nuxtOptions.runtimeConfig.nardukHealth = {
      ...(nardukHealth !== null && typeof nardukHealth === 'object' ? nardukHealth : {}),
      authTables: true,
    }

    for (const route of [
      '/login',
      '/login/**',
      '/register',
      '/register/**',
      '/reset-password',
      '/logout',
      '/auth/**',
      '/settings',
      '/settings/**',
      '/dashboard',
      '/dashboard/**',
    ]) {
      extendRouteRules(route, AUTH_CLIENT_ROUTE_RULE)
    }

    const registerAuthTypes = (prepareOptions: TypePrepareOptions) => {
      registerTypeReference(prepareOptions, authUserTypesPath)
      registerTypeReference(prepareOptions, authRuntimeConfigTypesPath)
    }

    nuxt.hook('nitro:prepare:types', registerAuthTypes)
    nuxt.hook('prepare:types', registerAuthTypes)
  },
})
