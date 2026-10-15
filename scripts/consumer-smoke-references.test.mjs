import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  assertBuiltBrandAssets,
  requiredBrandAssets,
  retiredReferencePattern,
} from './consumer-smoke-references.mjs'

test('static brand assets are allowed while template and service-worker references remain forbidden', () => {
  for (const value of requiredBrandAssets) assert.equal(retiredReferencePattern.test(value), false)
  for (const value of [
    'narduk-template',
    'narduk-fleet',
    '#layer',
    'service-worker.js',
    'navigator.serviceWorker',
    'CONTROL_PLANE_URL',
  ]) {
    assert.equal(retiredReferencePattern.test(value), true, value)
  }
})

test('built output must include every nonempty brand asset', () => {
  const directory = mkdtempSync(join(tmpdir(), 'consumer-brand-assets-'))
  try {
    for (const asset of requiredBrandAssets) writeFileSync(join(directory, asset), 'checked asset')
    assert.doesNotThrow(() => assertBuiltBrandAssets(directory))
    for (const asset of requiredBrandAssets) {
      const path = join(directory, asset)
      rmSync(path)
      assert.throws(() => assertBuiltBrandAssets(directory), {
        message: `Generated consumer is missing built brand asset ${asset}.`,
      })
      writeFileSync(path, '')
      assert.throws(() => assertBuiltBrandAssets(directory), /missing built brand asset/)
      rmSync(path)
      mkdirSync(path)
      assert.throws(() => assertBuiltBrandAssets(directory), /missing built brand asset/)
      rmSync(path, { recursive: true })
      writeFileSync(path, 'checked asset')
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
