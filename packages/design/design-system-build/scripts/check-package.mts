import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderBundle } from './build.mts'

const root = fileURLToPath(new URL('../dist/design-system/', import.meta.url))
const manifest = JSON.parse(await readFile(join(root, 'build-manifest.json'), 'utf8'))
assert.equal(manifest.kind, 'narduk-coded-design-system')
assert.equal(manifest.schemaVersion, 1)
const actual = (await readdir(root, { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) => join(entry.parentPath, entry.name).slice(root.length))
  .sort()
const expected = [
  ...manifest.files.map((file: { path: string }) => file.path),
  'build-manifest.json',
]
assert.deepEqual(actual, expected.sort(), 'Bundle contains missing or unrecorded files')
for (const file of manifest.files) {
  assert.match(file.path, /^(?:cards\/)?[a-z0-9_-]+\.(?:html|css|json)$/)
  const bytes = await readFile(join(root, file.path))
  assert.equal(bytes.length, file.bytes, `Byte count mismatch: ${file.path}`)
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    file.sha256,
    `Hash mismatch: ${file.path}`,
  )
}
const html = await readFile(join(root, 'index.html'), 'utf8')
assert.doesNotMatch(html, /<script\b/i)
const { files, cards } = renderBundle(html, await readFile(join(root, 'tokens.css'), 'utf8'))
assert.equal(cards.length, manifest.coverage.cards)
for (const [path, contents] of Object.entries(files)) {
  assert.equal(
    await readFile(join(root, path), 'utf8'),
    contents,
    `Invalid static preview: ${path}`,
  )
}
console.log(`Validated ${actual.length} artifact files and ${cards.length} static Vue cards`)
