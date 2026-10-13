import {
  addImportsDir,
  addServerHandler,
  addServerImportsDir,
  createResolver,
  defineNuxtModule,
} from '@nuxt/kit'

const PACKAGE_NAME = '@narduk-enterprises/narduk-uploads'

interface MutableNuxtOptionsRecord {
  build: {
    transpile: string[]
  }
  nitro?: Record<string, unknown>
  runtimeConfig: Record<string, unknown>
}

/**
 * One key prefix GET/HEAD /images/** serves. A key outside every configured
 * prefix is a 404 before R2 is read.
 */
export interface NardukUploadsImagePrefix {
  /** `Cache-Control` for every object under the prefix. */
  cacheControl: string
  /** Key prefix, e.g. `v1/`. Must be non-empty: an empty one would serve the whole bucket. */
  prefix: string
  /**
   * Take the content type from the key's extension when it names an
   * allow-listed raster, and from the stored metadata otherwise. The
   * allow-list still applies to the result, so SVG and non-images stay 415.
   */
  typeFromExtension?: boolean
}

export interface NardukUploadsModuleOptions {
  images?: {
    /** R2 binding the image route reads. Default `BUCKET`. */
    binding?: string
    /** Served prefixes. Default: `uploads/` with a one-year immutable cache. */
    prefixes?: NardukUploadsImagePrefix[]
  }
  imports?: boolean
  server?: boolean
  /** Register POST /api/upload. Off for an app that only serves R2 images. */
  uploadRoute?: boolean
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
    uploadRoute: true,
  },
  setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)
    const nuxtOptions = nuxt.options as unknown as MutableNuxtOptionsRecord

    pushUnique(nuxtOptions.build.transpile, PACKAGE_NAME)
    addNitroInlinePackage(nuxtOptions, PACKAGE_NAME)

    if (options.imports) {
      addImportsDir(resolver.resolve('../runtime/app/composables'))
    }

    const prefixes = options.images?.prefixes ?? []
    for (const entry of prefixes) {
      if (typeof entry.prefix !== 'string' || entry.prefix.length === 0) {
        throw new Error(
          `${PACKAGE_NAME}: images.prefixes entries need a non-empty prefix; an empty one would serve the whole bucket`,
        )
      }
    }
    // Read per request by the image route; an empty list keeps its uploads/ default.
    nuxtOptions.runtimeConfig.nardukUploads = {
      imagesBinding: options.images?.binding ?? 'BUCKET',
      imagePrefixes: prefixes,
    }

    if (options.server) {
      // Explicit handlers on the paths a scan of runtime/server produced, so
      // the upload route can be left out.
      addServerImportsDir(resolver.resolve('../runtime/server/utils'))
      if (options.uploadRoute) {
        addServerHandler({
          route: '/api/upload',
          method: 'post',
          handler: resolver.resolve('../runtime/server/api/upload.post.js'),
        })
      }
      const imageHandler = resolver.resolve('../runtime/server/routes/images/[...slug].get.js')
      addServerHandler({ route: '/images/**:slug', method: 'get', handler: imageHandler })
      addServerHandler({ route: '/images/**:slug', method: 'head', handler: imageHandler })
    }
  },
})
