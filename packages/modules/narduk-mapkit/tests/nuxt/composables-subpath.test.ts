/**
 * `./nuxt/composables` -- the explicit-import door for the Vue composables the
 * module otherwise delivers by auto-import.
 *
 * Two things can rot here, and a packaging linter sees neither. The subpath can
 * drift out of step with `addImports`, leaving a composable an app can write
 * bare but a test cannot import. And the barrel can grow an export whose graph
 * reaches `#imports`, a specifier that resolves only inside a Nuxt build -- the
 * subpath would then throw on import everywhere else, including in the
 * `check:package` gate. The graph is walked over `src` so both hold at
 * `pnpm test:unit` time, before a build, and name the source file to edit.
 */
import { readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import * as subpath from '../../src/nuxt/runtime/composables/index.js'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const packageJson = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>
  exports: Record<string, { import: string; types: string }>
  peerDependencies: Record<string, string>
}

const STATIC_IMPORT = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]/g
const TYPE_ONLY = /^\s*(?:import|export)\s+type\s/

/** Specifiers `source` imports. `runtimeOnly` drops `import type` / `export type` edges. */
function specifiersIn(source: string, runtimeOnly: boolean): string[] {
  const found: string[] = []
  STATIC_IMPORT.lastIndex = 0
  let match = STATIC_IMPORT.exec(source)
  while (match !== null) {
    // The `type` keyword is read off the matched statement rather than
    // captured: a `\s+(type\s+)?` group inside the pattern can trade
    // whitespace with the `[^;]*?` after it, which is super-linear
    // backtracking (`regexp/no-super-linear-backtracking`).
    if (match[1] !== undefined && !(runtimeOnly && TYPE_ONLY.test(match[0]))) found.push(match[1])
    match = STATIC_IMPORT.exec(source)
  }
  return found
}

/** Every `src` file reachable from `entry`, and every bare specifier on the way. */
function walk(entry: string, runtimeOnly = false): { bare: Set<string>; files: Set<string> } {
  const files = new Set<string>()
  const bare = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.pop() as string
    if (files.has(file)) continue
    files.add(file)
    for (const specifier of specifiersIn(readFileSync(file, 'utf8'), runtimeOnly)) {
      if (specifier.startsWith('.'))
        queue.push(resolve(dirname(file), specifier.replace(/\.js$/, '.ts')))
      else bare.add(specifier)
    }
  }
  return { bare, files }
}

const BARREL = resolve(packageRoot, 'src/nuxt/runtime/composables/index.ts')

describe('./nuxt/composables', () => {
  it('is declared, and points at the composables barrel', () => {
    expect(packageJson.exports['./nuxt/composables']).toEqual({
      import: './dist/nuxt/runtime/composables/index.js',
      types: './dist/nuxt/runtime/composables/index.d.ts',
    })
  })

  it('exports the composables an app writes bare', () => {
    expect(typeof subpath.useMapKitView).toBe('function')
    expect(typeof subpath.useMapKitFullscreen).toBe('function')
  })

  it('reaches nothing a consumer outside a Nuxt build cannot resolve', () => {
    // `#imports` is the specific hazard -- `useMapKit()` reaches it through
    // `runtime/options.ts` -- but any bare specifier the manifest does not
    // declare would fail an installed consumer just as hard, so the assertion
    // is the whole set against the manifest, not a denylist.
    const declared = new Set([
      ...Object.keys(packageJson.dependencies),
      ...Object.keys(packageJson.peerDependencies),
    ])
    const undeclared = [...walk(BARREL).bare].filter((specifier) => !declared.has(specifier))
    expect(undeclared).toEqual([])
  })

  it('leaves useMapKit to auto-import, where #imports resolves', () => {
    expect('useMapKit' in subpath).toBe(false)
    const optionsGraph = [
      ...walk(resolve(packageRoot, 'src/nuxt/runtime/composables/useMapKit.ts')).bare,
    ]
    expect(
      optionsGraph,
      'useMapKit no longer needs a Nuxt build -- it can join the subpath',
    ).toContain('#imports')
  })

  it('carries every auto-imported composable that can live outside Nuxt', () => {
    // The module's own `addImports` list is the definition of "public by
    // auto-import"; this keeps the subpath from silently falling behind it.
    const registered = [
      ...readFileSync(resolve(packageRoot, 'src/nuxt/index.ts'), 'utf8').matchAll(
        /name: '(useMapKit[A-Za-z]*)'/g,
      ),
    ].map((match) => match[1] as string)
    expect(registered.toSorted()).toEqual(['useMapKit', 'useMapKitFullscreen', 'useMapKitView'])
    expect(registered.filter((name) => name !== 'useMapKit').toSorted()).toEqual(
      Object.keys(subpath).toSorted(),
    )
  })

  it('keeps the module entry free of the Vue runtime', () => {
    // Nuxt imports `./nuxt` to LOAD the module, in Node, before an app exists.
    // Re-exporting the composables from there would pull Vue into that graph.
    // Runtime edges only: `./nuxt` re-exports the composables' option and
    // result TYPES, which erase at build time and pull in nothing.
    const files = [...walk(resolve(packageRoot, 'src/nuxt/index.ts'), true).files].map((file) =>
      relative(packageRoot, file),
    )
    expect(files).not.toContain('src/nuxt/runtime/composables/index.ts')
    expect(files).not.toContain('src/nuxt/runtime/composables/useMapKitView.ts')
  })
})
