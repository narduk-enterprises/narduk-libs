import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { consumerLockDigest, packedInput } from './packed-consumer-inputs.mjs'

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'packed-input-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  let counter = 0
  return {
    file(content) {
      const path = join(directory, `${counter++}.yaml`)
      writeFileSync(path, content)
      return path
    },
    pack(
      manifest,
      {
        source = 'export const value = 1',
        mode = 0o644,
        reverse = false,
        duplicate = false,
        link = 'index.js',
      } = {},
    ) {
      const path = join(directory, `${counter++}.tgz`)
      execFileSync('python3', [
        '-c',
        `
import io, json, sys, tarfile
path, manifest, source, mode, reverse, duplicate, link = sys.argv[1:]
entries = [("package/package.json", manifest), ("package/index.js", source)]
if reverse == "true": entries.reverse()
if duplicate == "true": entries.append(entries[0])
with tarfile.open(path, "w:gz") as archive:
    for name, content in entries:
        item = tarfile.TarInfo(name)
        item.mode = int(mode)
        item.size = len(content.encode())
        archive.addfile(item, io.BytesIO(content.encode()))
    item = tarfile.TarInfo("package/bin")
    item.type = tarfile.SYMTYPE
    item.linkname = link
    archive.addfile(item)
`,
        path,
        manifest,
        source,
        String(mode),
        String(reverse),
        String(duplicate),
        link,
      ])
      return path
    },
  }
}

const manifest = '{"name":"example","version":"1.0.0","dependencies":{"a":"1","b":"2"}}'
const reordered = '{"dependencies":{"b":"2","a":"1"},"version":"1.0.0","name":"example"}'

test('dependency key ordering and archive transport order preserve installed-content identity', (t) => {
  const f = fixture(t)
  const a = packedInput(f.pack(manifest))
  const b = packedInput(f.pack(reordered, { reverse: true }))
  assert.notEqual(a.integrity, b.integrity)
  assert.equal(a.digest, b.digest)
})

test('package versions, scripts, dependency values and array order remain binding', (t) => {
  const f = fixture(t)
  const baseline = packedInput(f.pack(manifest)).digest
  for (const changed of [
    manifest.replace('1.0.0', '1.0.1'),
    manifest.replace('"a":"1"', '"a":"2"'),
    manifest.replace('"dependencies":', '"scripts":{"test":"false"},"dependencies":'),
  ]) {
    assert.notEqual(packedInput(f.pack(changed)).digest, baseline)
  }
  assert.notEqual(
    packedInput(f.pack('{"files":["a","b"]}')).digest,
    packedInput(f.pack('{"files":["b","a"]}')).digest,
  )
})

test('file bytes, permissions and symlink targets remain binding', (t) => {
  const f = fixture(t)
  const baseline = packedInput(f.pack(manifest)).digest
  for (const options of [
    { source: 'export const value = 2' },
    { mode: 0o755 },
    { link: 'other.js' },
  ]) {
    assert.notEqual(packedInput(f.pack(manifest, options)).digest, baseline)
  }
})

test('ambiguous duplicate members and manifest keys cannot provide a proof', (t) => {
  const f = fixture(t)
  assert.throws(() => packedInput(f.pack(manifest, { duplicate: true })))
  assert.throws(() => packedInput(f.pack('{"name":"one","name":"two"}')))
})

test('lock comparison normalizes only current local tarball checksums, preserving registry resolution', (t) => {
  const f = fixture(t)
  const a = packedInput(f.pack(manifest))
  const b = packedInput(f.pack(reordered))
  const lock = (integrity, external = 'sha512-registry') =>
    `local: {integrity: ${integrity}, tarball: file:../tarballs/package.tgz}\nexternal: {integrity: ${external}}\n`
  const digest = consumerLockDigest(f.file(lock(a.integrity)), new Map([['example', a]]))
  assert.equal(consumerLockDigest(f.file(lock(b.integrity)), new Map([['example', b]])), digest)
  assert.notEqual(
    consumerLockDigest(f.file(lock(b.integrity, 'sha512-changed')), new Map([['example', b]])),
    digest,
  )
  assert.notEqual(consumerLockDigest(f.file(lock(b.integrity)), new Map()), digest)
})
