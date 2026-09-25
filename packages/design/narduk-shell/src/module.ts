import { addComponent, addImports, createResolver, defineNuxtModule } from '@nuxt/kit'
import { defu } from 'defu'

import { NARDUK_SHELL_APP_CONFIG } from './app-config'
import {
  registerNuxtUiSources,
  SHELL_NUXT_UI_COMPONENTS,
  type NuxtUiSourcesHost,
} from './nuxt-ui-sources'
import { NE_SHELL_COMPONENTS } from './registry'

/**
 * The Nuxt module definition — narduk-libs#295.
 *
 * This file imports `@nuxt/kit`, which is exactly why it can no longer also
 * be `.`: Nuxt's import-protection plugin refuses any app-code import of a
 * file that pulls in `@nuxt/kit`, and an app writing
 * `import { defineStatusMap } from '@narduk-enterprises/narduk-shell'` hit
 * that refusal in a production `nuxt build` when this file WAS `.` (0.1.0,
 * found by `narduk-enterprises/buoys` PR #44 within an hour of publish).
 * `src/index.ts` is `.` now; its own header explains what stays working there
 * and the "root barrel reachability" test in `test/module.test.ts` fails the
 * moment this file becomes reachable from it by value again.
 *
 * This file kept its name and gained its own subpath, `./module`, instead of
 * moving, because of exactly how Nuxt resolves a string `modules: []` entry.
 * `@nuxt/kit`'s `loadNuxtModuleInstance` calls `resolveModuleURL` with
 * `suffixes: ['nuxt', 'nuxt/index', 'module', 'module/index', '', 'index']`
 * and takes the first one that resolves (verified directly against the
 * installed `@nuxt/kit@4.5.0` + `exsolve@1.1.0` source: `exsolve` tries each
 * suffix in that order and swallows the `ERR_PACKAGE_PATH_NOT_EXPORTED` an
 * undeclared one throws, rather than failing, so it falls through to the next
 * candidate). Declaring `./module` in `package.json` satisfies the `module`
 * suffix, so a consumer's unchanged `modules: ['@narduk-enterprises/narduk-shell']`
 * resolves to THIS file before Nuxt ever tries the bare, empty-suffix
 * fallback that would otherwise hand it `src/index.ts` — which has no default
 * export to call as a module anyway. `@narduk-enterprises/narduk-shell/module`
 * also works as an explicit specifier, for a consumer composing the module by
 * hand with `installModule()`.
 */
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

const PACKAGE_NAME = '@narduk-enterprises/narduk-shell'
const THEME_STYLESHEET = '@narduk-enterprises/narduk-shell/theme.css'

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

    // Tailwind and Nuxt UI's detection see layers only, and this is a module:
    // without this, utilities only the suite uses are never generated in the
    // app (narduk-libs#978). Above the `components === false` return, since
    // useConfirm still renders NeConfirmDialog with that option off.
    registerNuxtUiSources(
      nuxt as unknown as NuxtUiSourcesHost,
      [resolver.resolve('./runtime')],
      SHELL_NUXT_UI_COMPONENTS,
    )

    // Auto-imports that do not depend on component registration. One entry per
    // exposed name, alphabetical, so two backlog items adding one conflict on
    // adjacent lines rather than on the same one.
    //
    // Both sit ABOVE the `components === false` return on purpose. Turning
    // `components` off opts out of the suite's GLOBAL COMPONENT NAMES; it is
    // not an opt-out of the package, the same way ./format and ./theme.css
    // stay reachable by direct import. defineStatusMap is a plain utility.
    // useConfirm is self-contained for the same reason it is testable outside
    // Nuxt: it imports NeConfirmDialog.vue itself and hands the component
    // OBJECT to `useOverlay().create()`, and that dialog in turn imports its
    // own UModal/UButton, so nothing on the path is resolved by global name
    // and `components: false` cannot leave it mounting an unregistered
    // component. `test/use-confirm.test.ts` mounts it with no `Ne*`
    // registration at all, which is that claim's standing proof.
    addImports({
      name: 'defineStatusMap',
      from: resolver.resolve('./runtime/utils/status-map'),
    })
    addImports({
      name: 'useCollection',
      from: resolver.resolve('./runtime/composables/use-collection'),
    })
    addImports({
      name: 'useConfirm',
      from: resolver.resolve('./runtime/composables/use-confirm'),
    })

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
