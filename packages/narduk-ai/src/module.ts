import { fileURLToPath } from 'node:url'

import {
  addComponentsDir,
  addImportsDir,
  addServerScanDir,
  createResolver,
  defineNuxtModule,
} from '@nuxt/kit'
import { defu } from 'defu'

// eslint-disable-next-line nuxt-redundant-auto-import/no-redundant-auto-import -- module setup executes before Nuxt runtime auto-imports exist.
import { validateXaiApiKey } from '../shared/utils/xaiRuntimeConfig'

const PACKAGE_NAME = '@narduk-enterprises/narduk-ai'

interface MutableNuxtOptionsRecord {
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

export interface NardukAiModuleOptions {
  app?: boolean
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

export default defineNuxtModule<NardukAiModuleOptions>({
  meta: {
    name: PACKAGE_NAME,
    configKey: 'nardukAi',
    compatibility: { nuxt: '>=3.16.0' },
  },
  defaults: {
    app: true,
    server: true,
  },
  setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)
    const nuxtOptions = nuxt.options as unknown as MutableNuxtOptionsRecord
    const runtimeConfigTypesPath = fileURLToPath(
      new URL('../shared/types/runtime-config.d.ts', import.meta.url),
    )

    pushUnique(nuxtOptions.build.transpile, PACKAGE_NAME)
    addNitroInlinePackage(nuxtOptions, PACKAGE_NAME)

    if (options.app) {
      addImportsDir(resolver.resolve('../app/composables'))
      addComponentsDir({
        path: resolver.resolve('../app/components'),
        pathPrefix: false,
      })
    }

    if (options.server) {
      addServerScanDir(resolver.resolve('../server'))
    }

    nuxtOptions.runtimeConfig = defu(nuxtOptions.runtimeConfig, {
      // This is deliberately private. Do not add xaiApiKey to `public`.
      xaiApiKey: validateXaiApiKey(process.env.XAI_API_KEY ?? process.env.NUXT_XAI_API_KEY),
    })

    const registerAiTypes = (prepareOptions: TypePrepareOptions) => {
      registerTypeReference(prepareOptions, runtimeConfigTypesPath)
    }

    nuxt.hook('nitro:prepare:types', registerAiTypes)
    nuxt.hook('prepare:types', registerAiTypes)
  },
})
