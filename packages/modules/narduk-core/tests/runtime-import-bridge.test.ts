import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import * as vue from 'vue'

import {
  APP_RUNTIME_NUXT_IMPORTS,
  APP_RUNTIME_VUE_IMPORTS,
  selectMissingRuntimeImports,
} from '../src/runtime-import-bridge'

/**
 * narduk-core is installed as a module, so a consuming app's Nuxt never
 * auto-imports into core's own `runtime/app` files; the vite bridge in
 * `module.ts` injects what they use, but only for the names in
 * `src/runtime-import-bridge.ts`. 2.13.0 shipped LayerAppFooter calling
 * `useSsrNow` and AppBreadcrumbs calling `toRef` with neither bridged: both
 * compiled and then threw `ReferenceError` during SSR in every app.
 *
 * narduk-seo, narduk-analytics and narduk-auth are modules as well, and the
 * bridge matches their `app/` files too. This suite finds every Vue
 * composition API, and every composable, store or util those packages
 * auto-import, that one of their app files uses without importing or declaring
 * it, and requires each to be bridged. Nuxt's own composables are out of reach here --
 * they are not enumerable without a Nuxt build -- so those stay hand-kept.
 */
const MODULES_DIR = fileURLToPath(new URL('../../', import.meta.url))
const APP_DIR = fileURLToPath(new URL('../runtime/app/', import.meta.url))
const SIBLING_APP_DIRS = ['narduk-seo', 'narduk-analytics', 'narduk-auth'].map((pkg) =>
  fileURLToPath(new URL(`../../${pkg}/app/`, import.meta.url)),
)

/** Directories core registers as auto-import dirs (see `module.ts`). */
const AUTO_IMPORT_DIRS = ['composables', 'stores', 'utils']

/**
 * Vue runtime APIs a component file reaches for. Deliberately a pattern over
 * the real `vue` exports rather than every export: short or generic names
 * (`h`, `stop`, `render`) match template text such as `h-4` or `@click.stop`,
 * and compiler macros (`defineProps`, `withDefaults`) are never imported.
 */
const VUE_API_PATTERN =
  /^(?:computed|customRef|effectScope|getCurrentInstance|getCurrentScope|hasInjectionContext|inject|isProxy|isReactive|isReadonly|isRef|markRaw|nextTick|on[A-Z]\w*|provide|reactive|readonly|ref|shallowReactive|shallowReadonly|shallowRef|toRaw|toRef|toRefs|toValue|triggerRef|unref|use[A-Z]\w*|watch|watchEffect|watchPostEffect|watchSyncEffect)$/

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return filesUnder(path)
    return /\.(?:vue|[cm]?ts)$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [path] : []
  })
}

/**
 * A file's code with comments and member accesses removed. The bridge matches
 * loosely on purpose -- an unused injected import is harmless -- but this test
 * wants real uses only: a comment naming `useHydrationGuard`, a call to
 * `nuxtApp.provide(...)`, a `{ provide: ... }` key and a quoted message are not
 * uses of either global. (Template expressions resolve on the component
 * instance, never on these globals, so dropping quoted attribute values loses
 * nothing.)
 */
function codeUses(file: string): string {
  return readFileSync(file, 'utf8')
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .replaceAll(/(^|[^:])\/\/.*$/gm, '$1')
    .replaceAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, "''")
    .replaceAll(/\.\s*[a-z_$][\w$]*/gi, '.member')
    .replaceAll(/([{,]\s*)[a-z_$][\w$]*\s*:/gi, '$1key:')
}

function autoImportedCoreNames(): string[] {
  const names = new Set<string>()
  for (const dir of [APP_DIR, ...SIBLING_APP_DIRS].flatMap((root) =>
    AUTO_IMPORT_DIRS.map((sub) => join(root, sub)).filter((d) => existsSync(d)),
  )) {
    for (const file of filesUnder(dir)) {
      const code = readFileSync(file, 'utf8')
      for (const match of code.matchAll(/^export\s+(?:async\s+)?(?:function|const)\s+(\w+)/gm)) {
        names.add(match[1]!)
      }
    }
  }
  return [...names].sort()
}

/** Vue APIs are functions; `readonly string[]` is TypeScript, not Vue's `readonly()`. */
function callsIn(code: string, name: string): boolean {
  return new RegExp(`(?<![\\w$])${name}\\s*(?:<[^>()]*>\\s*)?\\(`).test(code)
}

const vueNames = Object.keys(vue)
  .filter((name) => VUE_API_PATTERN.test(name))
  .sort()
const coreNames = autoImportedCoreNames()

describe('narduk-core app runtime import bridge', () => {
  it('finds the names it scans for', () => {
    // Guards against a scan that silently finds nothing and passes.
    expect(vueNames).toEqual(expect.arrayContaining(['computed', 'toRef', 'onBeforeUnmount']))
    expect(coreNames).toEqual(expect.arrayContaining(['useSsrNow', 'useFormHandler']))
  })

  it('bridges every Vue API a runtime/app file uses without importing', () => {
    const unbridged = [APP_DIR, ...SIBLING_APP_DIRS].flatMap(filesUnder).flatMap((file) => {
      const code = codeUses(file)
      return selectMissingRuntimeImports(code, vueNames)
        .filter((name) => callsIn(code, name) && !APP_RUNTIME_VUE_IMPORTS.includes(name))
        .map((name) => `${relative(MODULES_DIR, file)}: ${name}`)
    })
    expect(unbridged).toEqual([])
  })

  it('bridges every core composable, store and util a runtime/app file uses without importing', () => {
    const unbridged = [APP_DIR, ...SIBLING_APP_DIRS].flatMap(filesUnder).flatMap((file) =>
      selectMissingRuntimeImports(codeUses(file), coreNames)
        .filter((name) => !APP_RUNTIME_NUXT_IMPORTS.includes(name))
        .map((name) => `${relative(MODULES_DIR, file)}: ${name}`),
    )
    expect(unbridged).toEqual([])
  })

  it('keeps the lists sorted and free of duplicates', () => {
    for (const list of [APP_RUNTIME_VUE_IMPORTS, APP_RUNTIME_NUXT_IMPORTS]) {
      expect([...new Set(list)].sort()).toEqual(list)
    }
  })
})
