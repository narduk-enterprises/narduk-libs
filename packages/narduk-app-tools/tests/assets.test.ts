import { existsSync, mkdtempSync, readFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { generateFavicons, resolveFaviconOptions } from '../src/assets'

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
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'example-app' }))

    expect(resolveFaviconOptions({}, root).name).toBe('example-app')
    const outputs = await generateFavicons({}, root)
    expect(outputs).toHaveLength(7)
    expect(existsSync(join(publicDir, 'pwa-512x512.png'))).toBe(true)
    expect(JSON.parse(readFileSync(join(publicDir, 'site.webmanifest'), 'utf8'))).toMatchObject({
      name: 'example-app',
      start_url: '/',
    })
  })
})
