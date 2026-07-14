import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import sharp from 'sharp'

export interface UiQualityScreenshotSummary {
  avgChannelStdev: number
  fileSizeBytes: number
  height: number
  isFullPage: boolean
  mean: number
  path: string
  width: number
}

export interface UiQualityAnalysisSummary {
  app: string
  failures: string[]
  fullPageCount: number
  generatedAt: string
  rootDir: string
  score: number
  screenshotCount: number
  screenshots: UiQualityScreenshotSummary[]
  warnings: string[]
}

interface UiQualityManifestData {
  app?: unknown
  minimumFullPageCount?: unknown
  minimumScreenshotCount?: unknown
}

function walkFiles(directory: string, predicate: (name: string) => boolean): string[] {
  const entries = readdirSync(directory, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkFiles(absolutePath, predicate))
      continue
    }
    if (entry.isFile() && predicate(entry.name)) {
      files.push(absolutePath)
    }
  }

  return files.sort()
}

function average(values: number[]) {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function readManifestFiles(rootDir: string) {
  return walkFiles(rootDir, (name) => name === 'manifest.json').map((manifestPath) => {
    try {
      return {
        path: manifestPath,
        data: JSON.parse(readFileSync(manifestPath, 'utf8')) as UiQualityManifestData,
      }
    } catch {
      throw new Error(`Failed to parse visual QA manifest at ${manifestPath}.`)
    }
  })
}

function maxNumericManifestValue(
  manifests: Array<{ data: UiQualityManifestData; path: string }>,
  key: 'minimumFullPageCount' | 'minimumScreenshotCount',
) {
  return Math.max(
    0,
    ...manifests.map((manifest) => {
      const value = manifest.data[key]
      return typeof value === 'number' && Number.isFinite(value) ? value : 0
    }),
  )
}

function resolveManifestApp(manifests: Array<{ data: UiQualityManifestData; path: string }>) {
  const manifest = manifests.find((entry) => typeof entry.data.app === 'string')
  return typeof manifest?.data.app === 'string' && manifest.data.app.trim()
    ? manifest.data.app.trim()
    : 'unknown'
}

function buildMarkdown(summary: UiQualityAnalysisSummary) {
  const markdownLines = [
    '# Visual QA Summary',
    '',
    `- App: ${summary.app}`,
    `- Artifact score: ${summary.score}`,
    `- Screenshots: ${summary.screenshotCount}`,
    `- Full-page screenshots: ${summary.fullPageCount}`,
    `- Failures: ${summary.failures.length}`,
    `- Warnings: ${summary.warnings.length}`,
    '',
  ]

  if (summary.failures.length > 0) {
    markdownLines.push('## Failures', '')
    for (const failure of summary.failures) {
      markdownLines.push(`- ${failure}`)
    }
    markdownLines.push('')
  }

  if (summary.warnings.length > 0) {
    markdownLines.push('## Warnings', '')
    for (const warning of summary.warnings) {
      markdownLines.push(`- ${warning}`)
    }
    markdownLines.push('')
  }

  return `${markdownLines.join('\n')}\n`
}

export async function analyzeUiQualityRoot(rootDirInput = 'output/playwright/visual-audit') {
  const rootDir = path.resolve(rootDirInput)
  const summaryPath = path.join(rootDir, 'summary.json')
  const markdownPath = path.join(rootDir, 'summary.md')

  if (!existsSync(rootDir)) {
    throw new Error(`Visual QA root does not exist: ${rootDir}`)
  }

  const manifests = readManifestFiles(rootDir)
  const screenshots = walkFiles(rootDir, (name) => name.toLowerCase().endsWith('.png'))
  const failures: string[] = []
  const warnings: string[] = []
  const screenshotSummaries: UiQualityScreenshotSummary[] = []
  let fullPageCount = 0

  if (screenshots.length === 0) {
    failures.push('No PNG screenshots were found.')
  }

  for (const file of screenshots) {
    const relativePath = path.relative(rootDir, file)
    const image = sharp(file)
    const [metadata, stats] = await Promise.all([image.metadata(), image.stats()])
    const width = metadata.width || 0
    const height = metadata.height || 0
    const fileSizeBytes = statSync(file).size
    const mean = average(stats.channels.map((channel) => channel.mean))
    const stdev = average(stats.channels.map((channel) => channel.stdev))
    const isFullPage =
      relativePath.includes('page-full') ||
      relativePath.includes('full-page') ||
      relativePath.includes('full.png')

    if (isFullPage) {
      fullPageCount += 1
    }

    if (width < 160 || height < 100) {
      failures.push(`${relativePath} is unexpectedly small (${width}x${height})`)
    }

    if (isFullPage && stdev < 6) {
      failures.push(`${relativePath} looks visually flat (avg channel stdev ${stdev.toFixed(2)})`)
    } else if (!isFullPage && stdev < 3) {
      warnings.push(
        `${relativePath} has low visual variance (avg channel stdev ${stdev.toFixed(2)})`,
      )
    }

    if (isFullPage && fileSizeBytes < 40_000) {
      failures.push(`${relativePath} is unusually small on disk (${fileSizeBytes} bytes)`)
    }

    screenshotSummaries.push({
      path: relativePath,
      width,
      height,
      fileSizeBytes,
      mean: Number(mean.toFixed(2)),
      avgChannelStdev: Number(stdev.toFixed(2)),
      isFullPage,
    })
  }

  const minimumScreenshotCount = maxNumericManifestValue(manifests, 'minimumScreenshotCount')
  if (minimumScreenshotCount > 0 && screenshots.length < minimumScreenshotCount) {
    failures.push(
      `Expected at least ${minimumScreenshotCount} screenshots but found ${screenshots.length}`,
    )
  }

  const minimumFullPageCount = maxNumericManifestValue(manifests, 'minimumFullPageCount')
  if (minimumFullPageCount > 0 && fullPageCount < minimumFullPageCount) {
    failures.push(
      `Expected at least ${minimumFullPageCount} full-page screenshots but found ${fullPageCount}`,
    )
  }

  const score = Math.max(0, 100 - failures.length * 20 - warnings.length * 5)
  const summary: UiQualityAnalysisSummary = {
    generatedAt: new Date().toISOString(),
    rootDir,
    app: resolveManifestApp(manifests),
    score,
    screenshotCount: screenshots.length,
    fullPageCount,
    failures,
    warnings,
    screenshots: screenshotSummaries,
  }

  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  writeFileSync(markdownPath, buildMarkdown(summary), 'utf8')

  return summary
}
