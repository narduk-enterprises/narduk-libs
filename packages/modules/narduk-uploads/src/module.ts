import { addImportsDir, addServerScanDir, createResolver, defineNuxtModule } from '@nuxt/kit'

const PACKAGE_NAME = '@narduk-enterprises/narduk-uploads'

interface MutableNuxtOptionsRecord {
  build: {
    transpile: string[]
  }
  nitro?: Record<string, unknown>
}

export interface NardukUploadsModuleOptions {
  imports?: boolean
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

export default defineNuxtModule<NardukUploadsModuleOptions>({
  meta: {
    name: '@narduk-enterprises/narduk-uploads',
    configKey: 'nardukUploads',
    compatibility: { nuxt: '>=4.0.0' },
  },
  defaults: {
    imports: true,
    server: true,
  },
  setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)
    const nuxtOptions = nuxt.options as unknown as MutableNuxtOptionsRecord

    pushUnique(nuxtOptions.build.transpile, PACKAGE_NAME)
    addNitroInlinePackage(nuxtOptions, PACKAGE_NAME)

    if (options.imports) {
      addImportsDir(resolver.resolve('../runtime/app/composables'))
    }

    if (options.server) {
      addServerScanDir(resolver.resolve('../runtime/server'))
    }
  },
})
