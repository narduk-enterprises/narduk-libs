/**
 * The `./testing` subpath must never be reachable from a production entry.
 *
 * A published test double is a liability if it can end up in an application
 * bundle: it is deliberately more permissive than Apple in some places and
 * deliberately explosive in others. `publint` and `check:package` prove the
 * subpath is *declared* correctly; this proves the import graph, which is the
 * half a packaging linter cannot see.
 *
 * The graph is walked over `src` rather than `dist` so the assertion holds at
 * `pnpm test:unit` time, before a build has run, and names the source file a
 * reviewer would have to edit.
 */
import { readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const packageJson = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
  exports: Record<string, { import: string; types: string }>
}

/** `./dist/client/index.js` -> the `src` file `tsc` compiled it from. */
function sourceOf(distPath: string): string {
  return resolve(packageRoot, distPath.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, '.ts'))
}

const STATIC_IMPORT = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]/g
const DYNAMIC_IMPORT = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g

function specifiersIn(source: string): string[] {
  const found: string[] = []
  for (const pattern of [STATIC_IMPORT, DYNAMIC_IMPORT]) {
    pattern.lastIndex = 0
    let match = pattern.exec(source)
    while (match !== null) {
      if (match[1] !== undefined) found.push(match[1])
      match = pattern.exec(source)
    }
  }
  return found
}

/**
 * Every `src` file reachable from `entry`, including through `import type`.
 *
 * Type-only edges are followed on purpose. They vanish at runtime, so they
 * would not put the fake in a bundle -- but a production entry whose *types*
 * name the fake has still made it part of the published production surface,
 * and that is the boundary this test defends.
 */
function reachableFrom(entry: string): Set<string> {
  const seen = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.pop() as string
    if (seen.has(file)) continue
    seen.add(file)
    for (const specifier of specifiersIn(readFileSync(file, 'utf8'))) {
      if (!specifier.startsWith('.')) continue
      queue.push(resolve(dirname(file), specifier.replace(/\.js$/, '.ts')))
    }
  }
  return seen
}

const productionEntries = Object.entries(packageJson.exports).filter(
  ([subpath]) => subpath !== './testing',
)

describe('./testing package boundary', () => {
  it.each(productionEntries)('%s cannot reach src/testing', (_subpath, target) => {
    const leaked = [...reachableFrom(sourceOf(target.import))]
      .map((file) => relative(packageRoot, file))
      .filter((file) => file.startsWith('src/testing/'))
    expect(leaked).toEqual([])
  })

  it('exposes the fake only under ./testing', () => {
    const testingTargets = Object.entries(packageJson.exports)
      .filter(([, target]) => target.import.startsWith('./dist/testing/'))
      .map(([subpath]) => subpath)
    expect(testingTargets).toEqual(['./testing'])
    expect(packageJson.exports['./testing']).toEqual({
      import: './dist/testing/index.js',
      types: './dist/testing/index.d.ts',
    })
  })

  it('the fake itself imports nothing outside src/testing', () => {
    const outside = [...reachableFrom(resolve(packageRoot, 'src/testing/index.ts'))]
      .map((file) => relative(packageRoot, file))
      .filter((file) => !file.startsWith('src/testing/'))
    expect(outside).toEqual([])
  })

  it('the fake declares no runtime dependency', () => {
    const bare = ['src/testing/index.ts', 'src/testing/runtime.ts', 'src/testing/types.ts'].flatMap(
      (file) =>
        specifiersIn(readFileSync(resolve(packageRoot, file), 'utf8')).filter(
          (specifier) => !specifier.startsWith('.'),
        ),
    )
    expect(bare).toEqual([])
  })
})
