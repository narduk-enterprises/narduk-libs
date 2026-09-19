import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const packageRoot = join(fileURLToPath(new URL('..', import.meta.url)))

const PRUNED_DIRECTORY_NAMES = new Set(['node_modules', '.nuxt', 'dist', '.data'])

function listFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && PRUNED_DIRECTORY_NAMES.has(entry.name)) {
      return []
    }
    const path = join(directory, entry.name)
    return entry.isDirectory() ? listFiles(path) : [path]
  })
}

describe('narduk-ai package boundary', () => {
  it('publishes explicit runtime surfaces', () => {
    const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>
    }

    expect(packageJson.exports['./nuxt']).toEqual({ import: './src/module.ts' })
    expect(packageJson.exports['./server/utils/aiPromptResolver']).toEqual({
      import: './server/utils/aiPromptResolver.ts',
    })
    expect(packageJson.exports['./app/components/admin/AdminAiTab']).toEqual({
      import: './app/components/admin/AdminAiTab.vue',
    })
    expect(packageJson.exports['./server/api/admin/ai/model.put']).toEqual({
      import: './server/api/admin/ai/model.put.ts',
    })
  })

  it('has no package-owned migration or layer alias artifacts', { timeout: 30_000 }, () => {
    const files = listFiles(packageRoot).filter(
      (path) => !path.includes('/node_modules/') && !path.includes('/.nuxt/'),
    )
    const sourceFiles = files.filter((path) => /\.(?:md|mjs|ts|vue|json)$/.test(path))
    const layerAlias = `${String.fromCharCode(35)}layer`

    expect(files.some((path) => path.includes('/drizzle/'))).toBe(false)
    expect(sourceFiles.some((path) => readFileSync(path, 'utf8').includes(layerAlias))).toBe(false)
  })
})
