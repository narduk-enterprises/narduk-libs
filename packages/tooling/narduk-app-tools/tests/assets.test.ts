import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { generateFavicons, resolveFaviconOptions } from '../src/assets.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { force: true, recursive: true })
})

describe('assets favicons', () => {
  it('generates the app-local icon set without metadata files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'narduk-app-assets-'))
    tempDirs.push(root)
    const publicDir = join(root, 'public')
    mkdirSync(publicDir, { recursive: true })
    writeFileSync(
      join(publicDir, 'favicon.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="red"/></svg>',
    )
    expect(resolveFaviconOptions({}, root).target).toBe(publicDir)
    const outputs = await generateFavicons({}, root)
    expect(outputs).toHaveLength(4)
    expect(existsSync(join(publicDir, 'apple-touch-icon.png'))).toBe(true)
    expect(existsSync(join(publicDir, 'favicon-32x32.png'))).toBe(true)
    expect(existsSync(join(publicDir, 'favicon-16x16.png'))).toBe(true)
    expect(existsSync(join(publicDir, 'favicon.ico'))).toBe(true)
    expect(existsSync(join(publicDir, 'pwa-512x512.png'))).toBe(false)
    expect(existsSync(join(publicDir, 'site.webmanifest'))).toBe(false)
  })
})
