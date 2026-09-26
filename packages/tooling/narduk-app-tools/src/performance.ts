import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

export type AssetKind = 'css' | 'font' | 'image'

export interface PerformanceBudgetOptions {
  appDir?: string
  criticalImageBudgetKb?: number
  cssBudgetKb?: number
  fontBudgetKb?: number
  fontTotalBudgetKb?: number
  imageBudgetKb?: number
  /** Print the JSON verdict on stdout. Set only when `--json` has no path. */
  json?: boolean
  /** Write the JSON verdict here. Same contract as `foundation:check --json <path>`. */
  jsonPath?: string
  reportOnly?: boolean
}

export interface CssRuleOffender {
  selector: string
  sizeBytes: number
}

export interface PerformanceBudgetViolation {
  budgetBytes: number
  kind: AssetKind
  message: string
  metric: 'gzip' | 'missing' | 'raw' | 'total'
  offenders?: CssRuleOffender[]
  path: string
  sizeBytes: number
}

export interface PerformanceBudgetReport {
  appDir: string
  budgets: {
    criticalImageBytes: number
    cssBytes: number
    fontBytes: number
    fontTotalBytes: number
    imageBytes: number
  }
  checked: { cssFiles: number; fontFiles: number; imageFiles: number }
  violations: PerformanceBudgetViolation[]
  warnings: string[]
}

const FONT_EXTENSIONS = new Set(['.otf', '.ttf', '.woff', '.woff2'])
const IMAGE_EXTENSIONS = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.png', '.webp'])
const CRITICAL_IMAGE_PATTERN = /hero|cover|banner|landing|home|card|logo/iu

function toBytes(kb: number): number {
  return Math.round(kb * 1024)
}

function label(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`
}

function walkFiles(root: string): string[] {
  if (!existsSync(root)) return []
  const files: string[] = []
  for (const name of readdirSync(root)) {
    const path = join(root, name)
    if (statSync(path).isDirectory()) files.push(...walkFiles(path))
    else files.push(path)
  }
  return files
}

function extension(path: string): string {
  const index = path.lastIndexOf('.')
  return index === -1 ? '' : path.slice(index).toLowerCase()
}

function relativeAssetPath(appDir: string, path: string): string {
  return relative(appDir, path).replaceAll('\\', '/')
}

function cssOffenders(source: string): CssRuleOffender[] {
  return source
    .split('}')
    .map((block) => {
      const [selector = '', body = ''] = block.split('{')
      return {
        selector: selector.trim().replaceAll(/\s+/gu, ' ').slice(0, 160),
        sizeBytes: Buffer.byteLength(`${selector}{${body}}`),
      }
    })
    .filter((entry) => entry.selector && entry.sizeBytes > 0)
    .sort((left, right) => right.sizeBytes - left.sizeBytes)
    .slice(0, 5)
}

function normalizeOptions(options: PerformanceBudgetOptions): Required<PerformanceBudgetOptions> {
  return {
    appDir: resolve(options.appDir ?? (existsSync('apps/web') ? 'apps/web' : '.')),
    criticalImageBudgetKb: options.criticalImageBudgetKb ?? 350,
    cssBudgetKb: options.cssBudgetKb ?? 35,
    fontBudgetKb: options.fontBudgetKb ?? 55,
    fontTotalBudgetKb: options.fontTotalBudgetKb ?? 100,
    imageBudgetKb: options.imageBudgetKb ?? 800,
    json: options.json ?? false,
    jsonPath: options.jsonPath ?? '',
    reportOnly: options.reportOnly ?? false,
  }
}

export function runPerformanceBudgetCheck(
  options: PerformanceBudgetOptions = {},
): PerformanceBudgetReport {
  const normalized = normalizeOptions(options)
  const output = join(normalized.appDir, '.output', 'public')
  const publicDir = join(normalized.appDir, 'public')
  const budgets = {
    criticalImageBytes: toBytes(normalized.criticalImageBudgetKb),
    cssBytes: toBytes(normalized.cssBudgetKb),
    fontBytes: toBytes(normalized.fontBudgetKb),
    fontTotalBytes: toBytes(normalized.fontTotalBudgetKb),
    imageBytes: toBytes(normalized.imageBudgetKb),
  }
  const outputFiles = walkFiles(output)
  const cssFiles = outputFiles.filter((path) => extension(path) === '.css')
  const fontFiles = outputFiles.filter(
    (path) =>
      FONT_EXTENSIONS.has(extension(path)) &&
      relativeAssetPath(normalized.appDir, path).startsWith('.output/public/_fonts/'),
  )
  const imageFiles = [
    ...walkFiles(publicDir).filter((path) => IMAGE_EXTENSIONS.has(extension(path))),
    ...outputFiles.filter(
      (path) =>
        IMAGE_EXTENSIONS.has(extension(path)) &&
        relativeAssetPath(normalized.appDir, path).startsWith('.output/public/_nuxt/'),
    ),
  ]
  const warnings: string[] = []
  const violations: PerformanceBudgetViolation[] = []
  if (cssFiles.length === 0) {
    violations.push({
      budgetBytes: 0,
      kind: 'css',
      message: 'No built CSS files found; run the app build first.',
      metric: 'missing',
      path: relative(process.cwd(), output),
      sizeBytes: 0,
    })
  }
  if (fontFiles.length === 0)
    warnings.push(`No built font files found under ${relative(process.cwd(), output)}`)
  for (const path of cssFiles) {
    const sizeBytes = gzipSync(readFileSync(path, 'utf8')).byteLength
    if (sizeBytes > budgets.cssBytes) {
      violations.push({
        budgetBytes: budgets.cssBytes,
        kind: 'css',
        message: `CSS bundle is ${label(sizeBytes)} gzip, budget is ${label(budgets.cssBytes)}.`,
        metric: 'gzip',
        offenders: cssOffenders(readFileSync(path, 'utf8')),
        path: relativeAssetPath(normalized.appDir, path),
        sizeBytes,
      })
    }
  }
  let totalFontBytes = 0
  for (const path of fontFiles) {
    const sizeBytes = statSync(path).size
    totalFontBytes += sizeBytes
    if (sizeBytes > budgets.fontBytes) {
      violations.push({
        budgetBytes: budgets.fontBytes,
        kind: 'font',
        message: `Font file is ${label(sizeBytes)}, budget is ${label(budgets.fontBytes)}.`,
        metric: 'raw',
        path: relativeAssetPath(normalized.appDir, path),
        sizeBytes,
      })
    }
  }
  if (totalFontBytes > budgets.fontTotalBytes) {
    violations.push({
      budgetBytes: budgets.fontTotalBytes,
      kind: 'font',
      message: `Total built font payload is ${label(totalFontBytes)}, budget is ${label(budgets.fontTotalBytes)}.`,
      metric: 'total',
      path: '.output/public',
      sizeBytes: totalFontBytes,
    })
  }
  for (const path of imageFiles) {
    const sizeBytes = statSync(path).size
    const critical = CRITICAL_IMAGE_PATTERN.test(basename(path))
    const budgetBytes = critical ? budgets.criticalImageBytes : budgets.imageBytes
    if (sizeBytes > budgetBytes) {
      violations.push({
        budgetBytes,
        kind: 'image',
        message: `${critical ? 'Critical' : 'Public'} image is ${label(sizeBytes)}, budget is ${label(budgetBytes)}.`,
        metric: 'raw',
        path: relativeAssetPath(normalized.appDir, path),
        sizeBytes,
      })
    }
  }
  return {
    appDir: normalized.appDir,
    budgets,
    checked: {
      cssFiles: cssFiles.length,
      fontFiles: fontFiles.length,
      imageFiles: imageFiles.length,
    },
    violations,
    warnings,
  }
}

export function parsePerformanceBudgetArgs(args: string[]): PerformanceBudgetOptions {
  const options: PerformanceBudgetOptions = {}
  const normalizedArgs: string[] = []
  let separatorSeen = false
  for (const arg of args) {
    if (arg !== '--') {
      normalizedArgs.push(arg)
      continue
    }
    if (separatorSeen) throw new Error('Unknown performance-budget option: --')
    separatorSeen = true
  }
  const numeric = new Map([
    ['--critical-image-budget-kb', 'criticalImageBudgetKb'],
    ['--css-budget-kb', 'cssBudgetKb'],
    ['--font-budget-kb', 'fontBudgetKb'],
    ['--font-total-budget-kb', 'fontTotalBudgetKb'],
    ['--image-budget-kb', 'imageBudgetKb'],
  ])
  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index]
    if (arg === '--app-dir') options.appDir = normalizedArgs[++index]
    else if (arg === '--json') {
      const next = normalizedArgs[index + 1]
      if (next && !next.startsWith('--')) {
        options.jsonPath = next
        index += 1
      } else options.json = true
    } else if (arg === '--report-only') options.reportOnly = true
    else if (numeric.has(arg)) {
      const value = Number(normalizedArgs[++index])
      if (!Number.isFinite(value) || value <= 0) throw new Error(`${arg} must be a positive number`)
      const key = numeric.get(arg) as keyof PerformanceBudgetOptions
      ;(options as Record<string, unknown>)[key] = value
    } else throw new Error(`Unknown performance-budget option: ${arg}`)
  }
  return options
}

export function formatPerformanceBudgetReport(report: PerformanceBudgetReport): string {
  const lines = [
    `Performance budget report for ${relative(process.cwd(), report.appDir) || '.'}`,
    `Checked ${report.checked.cssFiles} CSS, ${report.checked.fontFiles} font, ${report.checked.imageFiles} public image files.`,
    ...report.warnings.map((warning) => `WARN ${warning}`),
  ]
  if (report.violations.length === 0)
    return [...lines, 'No performance budget violations found.'].join('\n')
  lines.push(`${report.violations.length} performance budget violation(s):`)
  for (const violation of report.violations) {
    lines.push(`- ${violation.path}: ${violation.message}`)
    for (const offender of violation.offenders ?? [])
      lines.push(`  offender ${label(offender.sizeBytes)} raw: ${offender.selector}`)
  }
  return lines.join('\n')
}

/** `--json <path>` writes the verdict. `--json` alone prints it. */
export function emitPerformanceBudgetReport(
  options: PerformanceBudgetOptions,
  report: PerformanceBudgetReport,
): void {
  if (options.jsonPath) {
    writeFileSync(options.jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  }
  console.log(
    options.json ? JSON.stringify(report, null, 2) : formatPerformanceBudgetReport(report),
  )
}

export function runPerformanceBudgetCli(args: string[]): number {
  try {
    const options = parsePerformanceBudgetArgs(args)
    const report = runPerformanceBudgetCheck(options)
    emitPerformanceBudgetReport(options, report)
    return report.violations.length > 0 && !options.reportOnly ? 1 : 0
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}
