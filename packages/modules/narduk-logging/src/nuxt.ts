import { addServerImports, addServerPlugin, createResolver, defineNuxtModule } from '@nuxt/kit'
import type { RequestLoggingOptions } from './h3.js'

export interface ModuleOptions {
  service: string
  environment?: string
  release?: string
  level?: RequestLoggingOptions['level']
  format?: RequestLoggingOptions['format']
  requestLogging?: boolean
  skipPaths?: string[]
  redact?: string[]
  includeStack?: boolean
}

export default defineNuxtModule<ModuleOptions>({
  meta: { name: '@narduk-enterprises/narduk-logging', configKey: 'nardukLogging' },
  defaults: { service: '', requestLogging: true },
  setup(options, nuxt) {
    if (!options.service?.trim()) throw new TypeError('nardukLogging.service is required')
    const resolver = createResolver(import.meta.url)
    const nitroOptions = (nuxt.options as typeof nuxt.options & { nitro?: { preset?: string } })
      .nitro
    nuxt.options.runtimeConfig.nardukLogging = {
      ...options,
      environment: options.environment ?? (nuxt.options.dev ? 'development' : 'production'),
      level: options.level ?? (nuxt.options.dev ? 'debug' : 'info'),
      runtime: nitroOptions?.preset?.startsWith('cloudflare') ? 'worker' : 'node',
      ...(nuxt.options.runtimeConfig.nardukLogging as Partial<RequestLoggingOptions> | undefined),
    }
    addServerPlugin(resolver.resolve('./runtime/nitro-plugin'))
    addServerImports({ name: 'useLogger', from: resolver.resolve('./h3') })
  },
})
