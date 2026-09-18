/**
 * The `./app/error-page` export carries a working `types` condition
 * (narduk-libs#521).
 *
 * Before it, a consumer's type check failed on the import with TS2307
 * ("Cannot find module … or its corresponding type declarations"), and every
 * app composing the page needed `@ts-expect-error` on it. The fixtures import
 * the export by package name, resolved through this package's own `exports`
 * map, with the compiler settings a Nuxt app uses (`moduleResolution:
 * "Bundler"`, `strict`).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixtureDir = join(packageRoot, 'tests/fixtures/error-page-consumer')

const COMPILER_OPTIONS: ts.CompilerOptions = {
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  noEmit: true,
  skipLibCheck: true,
  strict: true,
  target: ts.ScriptTarget.ES2022,
  types: [],
}

function diagnosticsFor(file: string): string[] {
  const fileName = join(fixtureDir, file)
  const program = ts.createProgram([fileName], COMPILER_OPTIONS)
  return ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.file?.fileName === fileName)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
}

describe('app/error-page types (narduk-libs#521)', () => {
  it('declares a types condition ahead of the SFC import', () => {
    const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf-8')) as {
      exports: Record<string, Record<string, string>>
    }
    const entry = packageJson.exports['./app/error-page']

    expect(entry).toEqual({
      types: './runtime/app/error-page-component.d.ts',
      import: './runtime/app/error.vue',
    })
    expect(Object.keys(entry ?? {})[0]).toBe('types')
  })

  it('type-checks a consumer that imports the page with no @ts-expect-error', () => {
    const source = readFileSync(join(fixtureDir, 'consumer.ts'), 'utf-8')
    expect(source).not.toMatch(/@ts-(?:expect-error|ignore|nocheck)/)

    expect(diagnosticsFor('consumer.ts')).toEqual([])
  }, 60_000)

  it('types the error prop rather than accepting anything', () => {
    const diagnostics = diagnosticsFor('wrong-props.ts')

    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toContain("Type 'number' is not assignable to type 'NuxtError")
  }, 60_000)

  it('declares the same props the SFC defines', () => {
    const sfc = readFileSync(join(packageRoot, 'runtime/app/error.vue'), 'utf-8')
    const declaration = readFileSync(
      join(packageRoot, 'runtime/app/error-page-component.d.ts'),
      'utf-8',
    )

    expect(sfc).toMatch(/defineProps<\{\s*error: NuxtError\s*\}>\(\)/)
    expect(declaration).toMatch(/interface EstateErrorPageProps \{\s*error: NuxtError\s*\}/)
  })
})
