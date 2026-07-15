import {
  addComponent,
  addImports,
  addServerHandler,
  addTypeTemplate,
  createResolver,
  defineNuxtModule,
} from '@nuxt/kit'

export interface NardukMapKitNuxtModuleOptions {
  component?: boolean
  composables?: boolean
  tokenRoute?: boolean
  tokenRoutePath?: string
}

interface MutableRuntimeConfig {
  appleKeyId?: string
  applePrivateKey?: string
  appleSecretKey?: string
  appleTeamId?: string
  mapkitAllowedOrigins?: string
  public: {
    appUrl?: string
    mapkitToken?: string
    mapkitTokenEndpoint?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

function normalizeRoutePath(path: string): string {
  const trimmed = path.trim()
  if (!trimmed.startsWith('/')) throw new Error('tokenRoutePath must start with /')
  return trimmed.replace(/\/$/, '') || '/api/mapkit-token'
}

export default defineNuxtModule<NardukMapKitNuxtModuleOptions>({
  meta: {
    name: '@narduk-geo/narduk-mapkit-nuxt',
    configKey: 'nardukMapKit',
    compatibility: { nuxt: '>=4.0.0' },
  },
  defaults: {
    component: true,
    composables: true,
    tokenRoute: true,
    tokenRoutePath: '/api/mapkit-token',
  },
  setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)
    const tokenRoutePath = normalizeRoutePath(options.tokenRoutePath ?? '/api/mapkit-token')
    const runtimeConfig = nuxt.options.runtimeConfig as MutableRuntimeConfig
    runtimeConfig.applePrivateKey ??= ''
    runtimeConfig.appleSecretKey ??= ''
    runtimeConfig.appleTeamId ??= ''
    runtimeConfig.appleKeyId ??= ''
    runtimeConfig.mapkitAllowedOrigins ??= ''
    runtimeConfig.public.mapkitToken ??= ''
    runtimeConfig.public.mapkitTokenEndpoint ??= tokenRoutePath

    if (options.component) {
      addComponent({
        name: 'AppMapKit',
        filePath: resolver.resolve('./runtime/components/AppMapKit.vue'),
      })
    }

    if (options.composables) {
      addImports([
        {
          name: 'useMapKit',
          from: resolver.resolve('./runtime/composables/useMapKit'),
        },
        {
          name: 'useMapkitToken',
          from: resolver.resolve('./runtime/composables/useMapkitToken'),
        },
      ])
    }

    if (options.tokenRoute) {
      addServerHandler({
        route: tokenRoutePath,
        handler: resolver.resolve('./runtime/server/mapkit-token.get'),
        method: 'get',
      })
      addServerHandler({
        route: tokenRoutePath,
        handler: resolver.resolve('./runtime/server/mapkit-token.method-not-allowed'),
      })
    }

    addTypeTemplate({
      filename: 'types/narduk-mapkit-nuxt.d.ts',
      getContents: () => `
declare module '@nuxt/schema' {
  interface RuntimeConfig {
    appleKeyId: string
    applePrivateKey: string
    appleSecretKey: string
    appleTeamId: string
    mapkitAllowedOrigins: string
  }
  interface PublicRuntimeConfig {
    mapkitToken: string
    mapkitTokenEndpoint: string
  }
}
declare module 'h3' {
  interface H3EventContext {
    nardukMapKit?: {
      rateLimit?: import('@narduk-geo/narduk-mapkit/worker').MapKitRateLimitHook
    }
  }
}
export {}
`,
    })
  },
})
