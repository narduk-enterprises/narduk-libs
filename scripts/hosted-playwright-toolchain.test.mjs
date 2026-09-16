import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { assertHostedPlaywrightToolchain } from './hosted-playwright-toolchain.mjs'

test('hosted consumer proof binds installed versions, Chromium bytes and native libraries', async (context) => {
  const cwd = mkdtempSync(join(tmpdir(), 'narduk-hosted-browser-'))
  context.after(() => rmSync(cwd, { recursive: true, force: true }))
  const packages = join(cwd, 'node_modules')
  const testPackage = join(packages, '@playwright', 'test')
  const playwright = join(packages, 'playwright')
  const core = join(packages, 'playwright-core')
  const binaryDirectory = join(cwd, 'chromium-123')
  for (const path of [testPackage, playwright, core, binaryDirectory])
    mkdirSync(path, { recursive: true })
  const binary = join(binaryDirectory, 'chrome')
  const osReleasePath = join(cwd, 'os-release')
  const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value))
  writeJson(join(cwd, 'package.json'), { devDependencies: { '@playwright/test': '1.61.1' } })
  for (const path of [testPackage, playwright, core])
    writeJson(join(path, 'package.json'), { name: path.split('/').at(-1), version: '1.61.1' })
  writeJson(join(core, 'browsers.json'), { browsers: [{ name: 'chromium', revision: '123' }] })
  writeFileSync(binary, 'chromium bytes 1')
  writeFileSync(osReleasePath, 'hosted image 1')
  writeFileSync(
    join(testPackage, 'index.js'),
    `exports.chromium = {
      executablePath: () => ${JSON.stringify(binary)},
      launch: async () => ({
        newPage: async () => ({
          setContent: async () => {},
          title: async () => 'hosted-playwright-canary',
        }),
        close: async () => {},
      }),
    }`,
  )
  const options = { cwd, expectedVersion: '1.61.1', osReleasePath }
  const identity = await assertHostedPlaywrightToolchain({
    ...options,
    nativePackages: () => 'libs1',
  })
  assert.equal(identity.kind, 'hosted-download')
  writeFileSync(binary, 'chromium bytes 2')
  const newerBrowser = await assertHostedPlaywrightToolchain({
    ...options,
    nativePackages: () => 'libs1',
  })
  assert.notEqual(newerBrowser.executable, identity.executable)
  const newerLibraries = await assertHostedPlaywrightToolchain({
    ...options,
    nativePackages: () => 'libs2',
  })
  assert.notEqual(newerLibraries.systemPackages, newerBrowser.systemPackages)
  writeJson(join(core, 'package.json'), { version: '1.60.0' })
  await assert.rejects(assertHostedPlaywrightToolchain(options), /versions differ/)
  writeJson(join(core, 'package.json'), { version: '1.61.1' })
  writeJson(join(core, 'browsers.json'), { browsers: [{ name: 'chromium', revision: '124' }] })
  await assert.rejects(assertHostedPlaywrightToolchain(options), /does not match/)
})
