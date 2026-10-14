import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

  it('writes favicon.ico as an ICO container of 16, 32 and 48 px PNG images, not bare PNG bytes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'narduk-app-assets-'))
    tempDirs.push(root)
    const publicDir = join(root, 'public')
    mkdirSync(publicDir, { recursive: true })
    writeFileSync(
      join(publicDir, 'favicon.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="red"/></svg>',
    )
    await generateFavicons({}, root)
    const ico = readFileSync(join(publicDir, 'favicon.ico'))
    // ICONDIR: reserved 0, type 1 (icon), image count.
    expect([...ico.subarray(0, 4)]).toEqual([0, 0, 1, 0])
    const count = ico.readUInt16LE(4)
    expect(count).toBe(3)
    const widths: number[] = []
    for (let index = 0; index < count; index += 1) {
      const entry = 6 + index * 16
      widths.push(ico[entry]!)
      const size = ico.readUInt32LE(entry + 8)
      const offset = ico.readUInt32LE(entry + 12)
      expect(offset + size).toBeLessThanOrEqual(ico.length)
      // Each image is an embedded PNG, which every current browser and Windows accept.
      expect([...ico.subarray(offset, offset + 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    }
    expect(widths).toEqual([16, 32, 48])
  })
})
