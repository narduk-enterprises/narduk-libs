import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, it } from 'vitest'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

it('loads the published injection keys in a consumer with no Nuxt or Vue runtime', () => {
  const consumer = mkdtempSync(join(tmpdir(), 'mapkit-injection-keys-'))
  try {
    const packDirectory = join(consumer, 'packed')
    mkdirSync(packDirectory)
    execFileSync('pnpm', ['pack', '--pack-destination', packDirectory], {
      cwd: packageRoot,
      stdio: 'pipe',
    })
    const tarball = readdirSync(packDirectory).find((file) => file.endsWith('.tgz'))
    expect(tarball).toBeDefined()
    const installedPackage = join(consumer, 'node_modules/@narduk-enterprises/narduk-mapkit')
    mkdirSync(installedPackage, { recursive: true })
    execFileSync('tar', [
      '-xzf',
      join(packDirectory, tarball!),
      '--strip-components=1',
      '-C',
      installedPackage,
    ])
    writeFileSync(join(consumer, 'package.json'), JSON.stringify({ type: 'module' }))
    writeFileSync(
      join(consumer, 'consumer.mjs'),
      `import assert from 'node:assert/strict'
import { mapKitColorModeInjectionKey, mapKitNonceInjectionKey } from '@narduk-enterprises/narduk-mapkit/injection-keys'
assert.equal(mapKitColorModeInjectionKey, Symbol.for('narduk-mapkit:color-mode'))
assert.equal(mapKitNonceInjectionKey, Symbol.for('narduk-mapkit:nonce'))
console.log('runtime-safe injection keys loaded')
`,
    )
    expect(
      execFileSync(process.execPath, ['consumer.mjs'], { cwd: consumer, encoding: 'utf8' }),
    ).toContain('runtime-safe injection keys loaded')
  } finally {
    rmSync(consumer, { recursive: true, force: true })
  }
}, 30_000)
