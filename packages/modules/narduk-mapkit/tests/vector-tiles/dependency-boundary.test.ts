/**
 * `@mapbox/vector-tile` and `pbf` must stay reachable only from `./vector-tiles`.
 *
 * The point of splitting the decoder out is that a map consumer imports
 * `./client` and injects whatever decoder it wants -- in a worker, or not at
 * all for a raster overlay -- and never pays for a protobuf parser in its main
 * bundle. That guarantee lives entirely in the import graph: nothing about the
 * package manifest would notice if `src/client/vector-tiles.ts` grew an import
 * of the decoder tomorrow, and the regression would be silent and permanent.
 *
 * The graph is walked over `src` rather than `dist`, so it holds at unit-test
 * time and names a source file a reviewer would have to edit. Type-only edges
 * count: a type that names the decoder has made it part of the published
 * surface even though it vanishes at runtime.
 */
import { readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const packageJson = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>
  exports: Record<string, { import: string; types: string }>
}

const PROTOBUF = ['@mapbox/vector-tile', 'pbf']

const STATIC_IMPORT = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]/g
const DYNAMIC_IMPORT = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
/** `import './pull-mvt.js'` -- no bindings, so the `from` patterns miss it. */
const SIDE_EFFECT_IMPORT = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g

function specifiersIn(source: string): string[] {
  const found: string[] = []
  for (const pattern of [STATIC_IMPORT, DYNAMIC_IMPORT, SIDE_EFFECT_IMPORT]) {
    pattern.lastIndex = 0
    let match = pattern.exec(source)
    while (match !== null) {
      if (match[1] !== undefined) found.push(match[1])
      match = pattern.exec(source)
    }
  }
  return found
}

function sourceOf(distPath: string): string {
  return resolve(packageRoot, distPath.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, '.ts'))
}

/** Bare specifiers reachable from `entry`, with the file each came from. */
function bareImportsFrom(entry: string): Array<{ file: string; specifier: string }> {
  const seen = new Set<string>()
  const bare: Array<{ file: string; specifier: string }> = []
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.pop() as string
    if (seen.has(file)) continue
    seen.add(file)
    for (const specifier of specifiersIn(readFileSync(file, 'utf8'))) {
      if (specifier.startsWith('.')) {
        queue.push(resolve(dirname(file), specifier.replace(/\.js$/, '.ts')))
      } else {
        bare.push({ file: relative(packageRoot, file), specifier })
      }
    }
  }
  return bare
}

const otherEntries = Object.entries(packageJson.exports).filter(
  ([subpath]) => subpath !== './vector-tiles',
)

describe('the protobuf dependency boundary', () => {
  it.each(otherEntries)('%s cannot reach a protobuf dependency', (_subpath, target) => {
    const leaked = bareImportsFrom(sourceOf(target.import))
      .filter((entry) => PROTOBUF.some((name) => entry.specifier.startsWith(name)))
      .map((entry) => `${entry.file} -> ${entry.specifier}`)
    expect(leaked).toEqual([])
  })

  it('./vector-tiles is the entry that does reach them', () => {
    const subpath = packageJson.exports['./vector-tiles']
    expect(subpath).toEqual({
      import: './dist/vector-tiles/index.js',
      types: './dist/vector-tiles/index.d.ts',
    })
    const reached = new Set(
      bareImportsFrom(sourceOf('./dist/vector-tiles/index.js')).map((entry) => entry.specifier),
    )
    for (const name of PROTOBUF) expect([...reached]).toContain(name)
  })

  it('declares both as real dependencies rather than leaving them to the consumer', () => {
    for (const name of PROTOBUF) expect(packageJson.dependencies[name]).toBeTruthy()
  })
})
