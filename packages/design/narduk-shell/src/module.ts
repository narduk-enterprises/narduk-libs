import {
  addComponent,
  addImports,
  addServerImports,
  createResolver,
  defineNuxtModule,
} from '@nuxt/kit'
import { defu } from 'defu'

import { NARDUK_SHELL_APP_CONFIG } from './app-config'
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
    //
    // `parseSort` and `toCsv` joined them for the reason below, which is
    // worth writing down because it is not "one more convenience". Nuxt
    // reserves the specifier a module was REGISTERED under: `@nuxt/kit`
    // records an `entryPath` per installed module and Nuxt's
    // import-protection plugin refuses app code that imports it
    // ("Importing directly from module entry-points is not allowed"). That
    // entry path is normally the `./module` subpath -- `mlly`'s
    // `lookupNodeModuleSubpath` maps the resolved file back through the
    // `exports` map -- so a value import of the bare package name is fine.
    // It can only do that when the resolved path contains a `node_modules/`
    // segment. When this package resolves through a checkout instead (the
    // workspace link a sibling package gets, or an app's `link:`/`file:`
    // dependency on a clone), the lookup finds no package name, Nuxt falls
    // back to the raw `modules: ['@narduk-enterprises/narduk-shell']` string,
    // and EVERY value import of the package root -- `parseSort`, `toCsv`,
    // `defineStatusMap`, `NARDUK_SHELL_APP_CONFIG` -- is refused in both the
    // Vue app and the Nitro server. Reproduced on Nuxt 4.5.2 (rolldown) and
    // documented in README.md's "Reserved subpaths". Auto-imports are
    // immune: the generated import names the runtime file, never the package.
    addImports({
      name: 'defineStatusMap',
      from: resolver.resolve('./runtime/utils/status-map'),
    })
    addImports({
      name: 'parseSort',
      from: resolver.resolve('./runtime/utils/data-table'),
    })
    addImports({
      name: 'toCsv',
      from: resolver.resolve('./runtime/utils/data-table'),
    })
    addImports({
      name: 'useCollection',
      from: resolver.resolve('./runtime/composables/use-collection'),
    })
    addImports({
      name: 'useConfirm',
      from: resolver.resolve('./runtime/composables/use-confirm'),
    })

    // The same two names on the server. `toCsv` is documented for a server
    // route -- "a server route can write the same CSV NeCsvDownload does" --
    // and that route reaches for the package root exactly like a page does,
    // so it hits the same refusal for the same reason. Nitro keeps its own
    // auto-import registry, so `addImports` alone would leave the documented
    // half of `toCsv` broken. Both functions are plain TypeScript with no
    // Vue, Nuxt or DOM import, which is what makes them safe to expose there
    // (narduk-logging's `useLogger` is the estate's precedent for a package
    // exposing its own runtime through `addServerImports`).
    //
    // One inherited condition, which is not new and is not this module's to
    // fix: this package ships raw TypeScript, and Nitro's esbuild step skips
    // node_modules by default, so ANY server-side use of this package's code
    // -- this auto-import, or the `import { toCsv } from
    // '@narduk-enterprises/narduk-shell'` the README used to show -- needs an
    // app whose Nitro transpiles the estate's packages.
    // `@narduk-enterprises/narduk-core` sets exactly that for every Narduk app
    // (`allowNitroEsbuildForNardukPackages`), which is why the packed-consumer
    // smoke's generated app exercises this route. Registering the names is
    // free either way: an auto-import emits nothing until something uses it.
    addServerImports([
      { name: 'parseSort', from: resolver.resolve('./runtime/utils/data-table') },
      { name: 'toCsv', from: resolver.resolve('./runtime/utils/data-table') },
    ])

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
