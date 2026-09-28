import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import * as root from '../src/index.js'
import * as overlay from '../src/overlay/index.js'

/**
 * The package entry is the union of the core, render, overlay and tile
 * barrels. It spells the overlay's names out instead of `export *`-ing the
 * overlay barrel, because that barrel also re-exports seven stretch types the
 * core barrel already provides. These checks keep the explicit list honest:
 * every type and value any of the four barrels exports must be reachable from
 * the entry, and nothing else.
 */
const srcDir = fileURLToPath(new URL('../src/', import.meta.url))
const barrels = ['core', 'render', 'overlay', 'tile'] as const

/** Overlay types that name core stretch types; the entry must still export them. */
const OVERLAY_STRETCH_TYPES = [
  'GridDisplayRangeListener',
  'GridDisplayRangeMeta',
  'GridPercentileStat',
  'GridRangeStretch',
  'GridStretchReason',
  'GridStretchTier',
  'GridStretchTimers',
] as const

function typeLevelExports() {
  const files = [`${srcDir}index.ts`, ...barrels.map((barrel) => `${srcDir}${barrel}/index.ts`)]
  const program = ts.createProgram(files, {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    lib: ['lib.es2023.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
  })
  const checker = program.getTypeChecker()
  const exportsOf = (file: string) => {
    const sourceFile = program.getSourceFile(file)
    if (!sourceFile) throw new Error(`not in program: ${file}`)
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile)
    if (!moduleSymbol) throw new Error(`no module symbol: ${file}`)
    return new Map(
      checker.getExportsOfModule(moduleSymbol).map((symbol) => {
        const target =
          symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
        return [symbol.name, target] as const
      }),
    )
  }
  const entryFile = program.getSourceFile(files[0]!)
  return {
    entry: exportsOf(files[0]!),
    barrels: Object.fromEntries(
      barrels.map((barrel) => [barrel, exportsOf(`${srcDir}${barrel}/index.ts`)]),
    ) as Record<(typeof barrels)[number], ReturnType<typeof exportsOf>>,
    entryDiagnostics: entryFile ? ts.getPreEmitDiagnostics(program, entryFile) : [],
  }
}

describe('package entry exports', () => {
  const surface = typeLevelExports()

  it('compiles without diagnostics', () => {
    expect(
      surface.entryDiagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')),
    ).toEqual([])
  })

  it('exports exactly the union of the core, render, overlay and tile barrels', () => {
    const union = new Set(barrels.flatMap((barrel) => [...surface.barrels[barrel].keys()]))
    expect([...surface.entry.keys()].sort()).toEqual([...union].sort())
  })

  it('resolves every entry name to the same declaration its barrel exports', () => {
    for (const barrel of barrels) {
      for (const [name, target] of surface.barrels[barrel]) {
        expect(surface.entry.get(name), `${barrel}: ${name}`).toBe(target)
      }
    }
  })

  it('exports the stretch types the overlay names, once, from core/stretch', () => {
    for (const name of OVERLAY_STRETCH_TYPES) {
      const declaration = surface.entry.get(name)?.declarations?.[0]
      expect(declaration?.getSourceFile().fileName, name).toBe(`${srcDir}core/stretch.ts`)
      expect(surface.barrels.overlay.get(name), `overlay: ${name}`).toBe(surface.entry.get(name))
    }
  })

  it('exports every overlay runtime value from the entry', () => {
    for (const [name, value] of Object.entries(overlay)) {
      expect(root[name as keyof typeof root], name).toBe(value)
    }
  })
})
