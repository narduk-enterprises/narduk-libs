import { addComponent, createResolver, defineNuxtModule } from '@nuxt/kit'
import { defu } from 'defu'

import { NARDUK_SHELL_APP_CONFIG } from './app-config'
import { NE_SHELL_COMPONENTS } from './registry'

const PACKAGE_NAME = '@narduk-enterprises/narduk-shell'
const THEME_STYLESHEET = '@narduk-enterprises/narduk-shell/theme.css'

// Re-exported from the module entry rather than from a fourth subpath: item 1
// fixed the exports map at `.`, `./format` and `./theme.css`, and an app that
// wants to read or extend the preset should not need a new specifier.
export {
  NARDUK_SHELL_APP_CONFIG,
  type NardukShellAppConfig,
  type NardukShellColorAliases,
  type NardukShellUiAppConfig,
} from './app-config'

export interface NardukShellModuleOptions {
  /**
   * Register the suite's components. Turning this off leaves the package
   * installed but registers nothing, which is how an app opts out of the
   * global names without removing the module (it still gets `./format` and
   * `./theme.css` by direct import).
   */
  components?: boolean
  /**
   * Load `theme.css` — the NE token layer and its `--ui-*` bridge — as a
   * global stylesheet. Turning this off keeps the components and leaves the
   * app on Nuxt UI's own defaults, which is the escape hatch for an app that
   * has its own finished design era and only wants the markup.
   */
  theme?: boolean
}

interface MinimalNuxt {
  options: {
    // Nuxt types this as string | RegExp | function entries; the module only
    // ever appends its own package name and only needs to read membership.
    build: { transpile: unknown[] }
    // Global stylesheet specifiers, in load order.
    css: string[]
    // Module-supplied app config; the app's own app.config.ts still wins.
    appConfig?: Record<string, unknown>
  }
}

export default defineNuxtModule<NardukShellModuleOptions>({
  meta: {
    name: 'narduk-shell',
    configKey: 'nardukShell',
    compatibility: { nuxt: '>=4.0.0' },
  },
  defaults: {
    components: true,
    theme: true,
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

    if (options.theme !== false) {
      // Front of the list on purpose. Nuxt keeps `css` in array order, and the
      // app's own entries are already in it by the time a module runs, so
      // unshifting puts the suite's tokens *underneath* whatever the app
      // styles on top of them. The sheet's declarations are unlayered, which
      // is what lets them beat Nuxt UI's own `@layer theme` defaults without
      // depending on which stylesheet Vite emits first.
      if (!nuxtOptions.css.includes(THEME_STYLESHEET)) {
        nuxtOptions.css.unshift(THEME_STYLESHEET)
      }

      // A default, not an assignment: `defu` keeps any alias the app (or
      // another module, such as narduk-core) already set.
      nuxtOptions.appConfig = defu(
        (nuxtOptions.appConfig ?? {}) as Record<string, unknown>,
        NARDUK_SHELL_APP_CONFIG,
      )
    }

    if (options.components === false) return

    // One explicit addComponent per registry entry. Never addComponentsDir:
    // a directory scan is shadowed silently by an app-local component of the
    // same name, and silence is exactly the failure mode this suite exists to
    // remove. See src/registry.ts.
    for (const component of NE_SHELL_COMPONENTS) {
      addComponent({
        name: component.name,
        filePath: resolver.resolve(component.filePath),
      })
    }
  },
})
