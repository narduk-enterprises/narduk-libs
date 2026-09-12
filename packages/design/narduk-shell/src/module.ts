import { addComponent, addImports, createResolver, defineNuxtModule } from '@nuxt/kit'
import { defu } from 'defu'

import { NARDUK_SHELL_APP_CONFIG } from './app-config'
import { NE_SHELL_COMPONENTS } from './registry'

// Named exports of the package root (`.`). Not a fourth subpath — the
// reserved map stays `.`, `./format`, `./theme.css`.
export {
  defineStatusMap,
  type NeStatusDescriptor,
  type NeStatusTone,
} from './runtime/utils/status-map'

/**
 * The suite's public runtime types, re-exported from the `.` subpath so an app
 * writes `import type { NeStateValue } from '@narduk-enterprises/narduk-shell'`.
 *
 * `export type` is erased, so this adds nothing to the module's Node-side
 * graph: no component source is loaded to read a type.
 */
export type {
  NeAsyncDataStatus,
  NeStateGap,
  NeStatePanelProps,
  NeStateValue,
} from './runtime/types'

/**
 * `useConfirm()`'s option and tone types, so a wrapper around the composable
 * can state its own signature, and a consuming app's unit test can type a stub,
 * without reaching for an auto-import that only exists inside Nuxt's transform.
 *
 * `useConfirm` itself is NOT re-exported here, and that is a hard constraint
 * rather than an omission. Nuxt loads this file with jiti
 * (`loadNuxtModuleInstance` -> `createJiti(...)` -> `jiti.import(src)`), and
 * jiti cannot load a single-file component. `use-confirm.ts` imports
 * `NeConfirmDialog.vue` at module scope to hand the component object to
 * `useOverlay().create()`, so a value re-export puts a `.vue` in this file's
 * eager Node graph and every app installing the module fails at config time
 * with `Unknown file extension ".vue"` — reproduced against jiti 2.7.0 on
 * 2026-09-11. `test/use-confirm.test.ts` walks the static graph and fails if a
 * `.vue` ever becomes reachable from here.
 *
 * The composable reaches app code through `addImports` below, which is not
 * gated on component registration.
 */
export type { NeConfirmOptions } from './runtime/composables/use-confirm'
export type { NeConfirmTone } from './runtime/components/ne-confirm-dialog-types'

/**
 * `useCollection()`'s public types, re-exported from `.` for the same reason
 * the confirm dialog's are: a page that wraps the composable, or a unit test
 * that stubs it, has to be able to state the shape outside Nuxt's auto-import
 * transform. `NeCollectionState` is also `NePager`'s `v-model:state` type.
 *
 * `useCollection` itself is NOT re-exported as a value, matching `useConfirm`:
 * this file is loaded by jiti at Nuxt config time, and the reserved export map
 * (`.`, `./format`, `./theme.css`) is not widened by a composable. It reaches
 * app code through `addImports` below.
 */
export type {
  NeCollection,
  NeCollectionFetchContext,
  NeCollectionOptions,
  NeCollectionQuery,
  NeCollectionState,
} from './runtime/composables/use-collection'

export type { NePagerProps } from './runtime/components/ne-pager-types'

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
