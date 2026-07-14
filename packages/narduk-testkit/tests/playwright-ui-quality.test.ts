import { randomFillSync } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'

import {
  default as uiQuality,
  prepareUiQualityRoot,
  slugify,
  writeUiQualityManifest,
} from '../src/playwright/ui-quality'
import { analyzeUiQualityRoot } from '../src/playwright/ui-quality-analyzer'

const tempDirs: string[] = []

function createVisualAuditRoot(prefix: string) {
  const visualAuditRoot = join(process.cwd(), 'output', 'playwright', 'visual-audit')
  mkdirSync(visualAuditRoot, { recursive: true })
  const targetDir = mkdtempSync(join(visualAuditRoot, prefix))
  tempDirs.push(targetDir)
  return targetDir
}

function createTempDir(prefix: string) {
  const targetDir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(targetDir)
  return targetDir
}

function createNoisyPng(width: number, height: number) {
  const channels = 3
  const bytes = Buffer.alloc(width * height * channels)
  randomFillSync(bytes)

  return sharp(bytes, { raw: { width, height, channels } }).png()
}

afterEach(() => {
  for (const targetDir of tempDirs.splice(0)) {
    rmSync(targetDir, { recursive: true, force: true })
  }
})

describe('visual QA toolkit helpers', () => {
  it('normalizes capture names for file paths', () => {
    expect(slugify('Fiscal year overlay')).toBe('fiscal-year-overlay')
    expect(slugify(' / ')).toBe('capture')
    expect(uiQuality.slugify('Legacy default import')).toBe('legacy-default-import')
  })

  it('resets the artifact root and writes the manifest', () => {
    const rootDir = createVisualAuditRoot('visual-qa-root-')
    mkdirSync(rootDir, { recursive: true })
    writeFileSync(join(rootDir, 'stale.txt'), 'stale')

    const outputRoot = prepareUiQualityRoot(rootDir)
    writeUiQualityManifest(rootDir, {
      app: 'demo',
      minimumFullPageCount: 1,
      minimumScreenshotCount: 2,
    })

    expect(readFileSync(join(outputRoot, 'manifest.json'), 'utf8')).toContain('"app": "demo"')
  })

  it('isolates visual QA roots per scope', () => {
    const rootDir = createVisualAuditRoot('visual-qa-root-scope-')

    const runRootA = prepareUiQualityRoot(rootDir, { scope: 'spec-a' })
    writeFileSync(join(runRootA, 'stale.txt'), 'from-a')

    const runRootB = prepareUiQualityRoot(rootDir, { scope: 'spec-b' })
    expect(readFileSync(join(runRootA, 'stale.txt'), 'utf8')).toBe('from-a')

    const runRootAReset = prepareUiQualityRoot(rootDir, { scope: 'spec-a' })
    expect(existsSync(join(runRootAReset, 'stale.txt'))).toBe(false)
    expect(runRootAReset).toBe(runRootA)
    writeUiQualityManifest(runRootAReset, {
      app: 'demo',
      minimumFullPageCount: 1,
      minimumScreenshotCount: 2,
    })
    expect(readFileSync(join(runRootAReset, 'manifest.json'), 'utf8')).toContain('"app": "demo"')
    expect(runRootB).not.toBe(runRootA)
  })

  it('refuses to delete outside the visual audit artifact root', () => {
    expect(() => prepareUiQualityRoot(join(process.cwd(), 'output', 'playwright'))).toThrow(
      /within/,
    )
    expect(() => prepareUiQualityRoot(join(process.cwd(), 'output', 'playwright', 'repo'))).toThrow(
      /within/,
    )
  })
})

describe('analyzeUiQualityRoot', () => {
  it('writes summaries for healthy visual QA artifacts', async () => {
    const rootDir = createTempDir('visual-qa-analysis-')
    const routeDir = join(rootDir, 'home')
    mkdirSync(routeDir, { recursive: true })
    await createNoisyPng(640, 480).toFile(join(routeDir, 'page-full.png'))
    await createNoisyPng(240, 160).toFile(join(routeDir, 'hero.png'))
    writeUiQualityManifest(rootDir, {
      app: 'demo',
      minimumFullPageCount: 1,
      minimumScreenshotCount: 2,
    })

    const summary = await analyzeUiQualityRoot(rootDir)

    expect(summary.failures).toEqual([])
    expect(summary.screenshotCount).toBe(2)
    expect(summary.fullPageCount).toBe(1)
    expect(readFileSync(join(rootDir, 'summary.md'), 'utf8')).toContain('# Visual QA Summary')
  })

  it('fails blank or missing captures without judging design quality', async () => {
    const rootDir = createTempDir('visual-qa-blank-')
    mkdirSync(join(rootDir, 'home'), { recursive: true })
    await sharp({
      create: {
        width: 640,
        height: 480,
        channels: 3,
        background: '#ffffff',
      },
    })
      .png()
      .toFile(join(rootDir, 'home', 'page-full.png'))
    writeUiQualityManifest(rootDir, {
      app: 'demo',
      minimumFullPageCount: 1,
      minimumScreenshotCount: 2,
    })

    const summary = await analyzeUiQualityRoot(rootDir)

    expect(summary.failures).toEqual(
      expect.arrayContaining([
        expect.stringContaining('looks visually flat'),
        'Expected at least 2 screenshots but found 1',
      ]),
    )
  })

  it('throws when visual QA manifests are malformed', async () => {
    const rootDir = createVisualAuditRoot('visual-qa-analysis-bad-manifest-')
    mkdirSync(rootDir, { recursive: true })
    writeFileSync(join(rootDir, 'manifest.json'), '{bad json')

    await expect(analyzeUiQualityRoot(rootDir)).rejects.toThrow(
      `Failed to parse visual QA manifest at ${join(rootDir, 'manifest.json')}.`,
    )
  })
})
