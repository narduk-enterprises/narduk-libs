import { addComponent, createResolver, defineNuxtModule } from '@nuxt/kit'

import { NE_SHELL_COMPONENTS } from './registry'

const PACKAGE_NAME = '@narduk-enterprises/narduk-shell'

export interface NardukShellModuleOptions {
  /**
   * Register the suite's components. Turning this off leaves the package
   * installed but registers nothing, which is how an app opts out of the
   * global names without removing the module (it still gets `./format` and
   * `./theme.css` by direct import).
   */
  components?: boolean
}

interface MutableNuxtOptions {
  build: {
    transpile: Array<string | RegExp | ((...args: never[]) => unknown)>
  }
}

interface MinimalNuxt {
  options: MutableNuxtOptions
}

export default defineNuxtModule<NardukShellModuleOptions>({
  meta: {
    name: 'narduk-shell',
    configKey: 'nardukShell',
    compatibility: { nuxt: '>=4.0.0' },
  },
  defaults: {
    components: true,
  },
  setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)
    const nuxtOptions = (nuxt as unknown as MinimalNuxt).options

    // The package ships TypeScript and single-file components rather than a
    // compiled bundle (the same shape narduk-core and narduk-analytics use),
    // so the consuming app has to run them through its own build.
    if (!nuxtOptions.build.transpile.includes(PACKAGE_NAME)) {
      nuxtOptions.build.transpile.push(PACKAGE_NAME)
    }

    if (options.components === false) return

    // One explicit addComponent per registry entry. Never Nuxt's directory-
    // scan registration: a directory scan is shadowed silently by an
    // app-local component of the same name, and silence is exactly the
    // failure mode this suite exists to remove. See src/registry.ts.
    // (The scan API's name is deliberately not spelled out here as one word:
    // test/module.test.ts asserts this file's source never contains it, and
    // that check can't tell a live call from a comment describing why there
    // isn't one.)
    for (const component of NE_SHELL_COMPONENTS) {
      addComponent({
        name: component.name,
        filePath: resolver.resolve(component.filePath),
      })
    }
  },
})
