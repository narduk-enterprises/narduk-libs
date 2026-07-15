import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(__dirname, '..')

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return listSourceFiles(path)
    if (!entry.isFile() || !['.ts', '.vue'].includes(extname(entry.name))) return []
    return [path]
  })
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

describe('narduk-auth package exports', () => {
  it('exports the module and auth runtime surface', () => {
    const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf-8')) as {
      exports: Record<string, unknown>
    }

    expect(packageJson.exports['./nuxt']).toEqual({
      import: './src/module.ts',
    })
    expect(packageJson.exports['./server/*']).toEqual({
      import: './server/*.ts',
    })
  })

  it('does not let type-only sibling imports suppress required runtime imports', () => {
    const failures: string[] = []

    for (const sourcePath of listSourceFiles(join(packageRoot, 'app'))) {
      const source = readFileSync(sourcePath, 'utf8')
      const typeOnlyImports = source.matchAll(
        /import\s+type\s*\{[\s\S]*?\}\s*from\s*['"]([^'"]+)['"]/gu,
      )

      for (const [, specifier] of typeOnlyImports) {
        if (!specifier?.startsWith('.')) continue
        const unresolved = resolve(dirname(sourcePath), specifier)
        const targetPath = [unresolved, `${unresolved}.ts`, join(unresolved, 'index.ts')].find(
          existsSync,
        )
        if (!targetPath) continue

        const target = readFileSync(targetPath, 'utf8')
        const runtimeExports = target.matchAll(
          /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gu,
        )
        for (const [, exportedName] of runtimeExports) {
          if (!exportedName) continue
          if (new RegExp(`\\b${escapeRegExp(exportedName)}\\s*\\(`, 'u').test(source)) {
            failures.push(`${sourcePath}: ${exportedName} is called from a type-only import source`)
          }
        }
      }
    }

    expect(failures).toEqual([])
  })
})
