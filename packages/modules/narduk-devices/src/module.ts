import { addServerScanDir, createResolver, defineNuxtModule } from '@nuxt/kit'

const PACKAGE_NAME = '@narduk-enterprises/narduk-devices'

interface MutableNuxtOptionsRecord {
  build: {
    transpile: string[]
  }
  nitro?: Record<string, unknown>
}

export interface NardukDevicesModuleOptions {
  /**
   * Register `server/` for Nitro auto-imports. Turn it off to import the
   * devices service and guards explicitly from their subpath exports.
   */
  server?: boolean
}

function pushUnique<T>(items: T[], item: T): void {
  if (!items.includes(item)) {
    items.push(item)
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

/**
 * The module wires server utilities only. It registers no pages, no
 * components, no runtime config, and no database binding: the consumer owns
 * identity and hands `createDevices` its own drizzle database.
 *
 * Migrations are not applied by this module either — a consumer adds
 * `node_modules/@narduk-enterprises/narduk-devices/drizzle` to its
 * `migrations.sources.json` (see README).
 */
export default defineNuxtModule<NardukDevicesModuleOptions>({
  meta: {
    name: PACKAGE_NAME,
    configKey: 'nardukDevices',
    compatibility: { nuxt: '>=4.0.0' },
  },
  defaults: {
    server: true,
  },
  setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)
    const nuxtOptions = nuxt.options as unknown as MutableNuxtOptionsRecord

    pushUnique(nuxtOptions.build.transpile, PACKAGE_NAME)
    addNitroInlinePackage(nuxtOptions, PACKAGE_NAME)

    if (options.server) {
      addServerScanDir(resolver.resolve('../server'))
    }
  },
})
