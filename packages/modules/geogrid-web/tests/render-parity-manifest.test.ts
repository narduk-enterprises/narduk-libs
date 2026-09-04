import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Manifest-integrity gate for the vendored `render-parity-v1` pack.
 *
 * `tests/fixtures/render-parity-v1/manifest.json` is the canonical pack's own
 * inventory — SHA-256 and byte length for every file it pins (see
 * `tests/fixtures/render-parity-v1/PROVENANCE.md`). Nothing here re-derives
 * those digests; this walks the manifest and asserts every vendored file still
 * matches it, byte for byte. That is what makes an edited fixture fail CI
 * instead of silently drifting: `color-parity.test.ts` and
 * `render-parity.test.ts` load `ramp-parity-v1.json` and the grid/PNG fixtures
 * straight off disk and trust them, so this file is the one thing standing
 * between a corrupted or hand-edited fixture and a test suite that keeps
 * passing against the wrong bytes.
 */

interface ManifestFileEntry {
  bytes: number
  sha256: string
}

interface RenderParityManifest {
  schema: string
  version: number
  productId: string
  files: Record<string, ManifestFileEntry>
  layers: string[]
  tiles: string[]
  rampPaletteSteps: number
  tileSize: number
  coastlineClip: boolean
  tolerance: { tier0: string; tier1ChannelsOf255: number }
}

const PACK_URL = new URL('./fixtures/render-parity-v1/', import.meta.url)
const manifestPath = fileURLToPath(new URL('manifest.json', PACK_URL))
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as RenderParityManifest

describe('render-parity-v1 manifest', () => {
  it('pins the expected schema and 16 files', () => {
    expect(manifest.schema).toBe('narduk-render-parity-v1')
    // manifest.json and README.md are the only pack files NOT listed inside
    // manifest.json (per the pack's own README): nothing can hash itself, and
    // a documentation edit should not invalidate a data pin.
    expect(Object.keys(manifest.files)).toHaveLength(16)
  })
})

describe('render-parity-v1 vendored files match the pinned manifest', () => {
  for (const [relativePath, expected] of Object.entries(manifest.files)) {
    it(`${relativePath} is byte-exact`, () => {
      const filePath = fileURLToPath(new URL(relativePath, PACK_URL))
      const bytes = readFileSync(filePath)
      expect(bytes.byteLength, `${relativePath} byte length`).toBe(expected.bytes)
      const digest = createHash('sha256').update(bytes).digest('hex')
      expect(digest, `${relativePath} sha256`).toBe(expected.sha256)
    })
  }
})
