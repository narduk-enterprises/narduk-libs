/**
 * Runs item 11 `toolchain-single-source` as its own small artefact, and owns
 * the `--fix` half.
 *
 * The evaluator (`./items/item-11-toolchain-single-source.ts`) matches items
 * 1-7 exactly. It is not emitted inside `foundation-check.json`: that artefact
 * is the exact 7-item contract company-hq `check-web-foundation.py`
 * `validate_artefact()` consumes, and an `id` outside `1..7` is a rollup-red F3
 * ARTEFACT finding -- the same reasoning items 8, 9 and 10 already carry. This
 * runner reuses the status vocabulary and roll-up rules (`check()`, `rollUp()`)
 * and writes a one-item artefact (`tool: '.../toolchain-single-source'`) so
 * nothing mistakes it for the ratified shape.
 *
 * Every verdict comes from the app's own files, so no credential is needed and
 * the command can be wired into generated CI after the install step has dropped
 * the GitHub Packages token.
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  evaluateItem11,
  scanToolchain,
  siteStatus,
  NODE_SOURCE_FILE,
  PNPM_SOURCE_KEY,
  TOOLCHAIN_ITEM_ID,
  TOOLCHAIN_ITEM_NAME,
  type ToolchainScan,
  type ToolchainSite,
} from './items/item-11-toolchain-single-source.js'
import { rollUp } from './schema.js'
import { resolveAppInfo } from './evaluate.js'
import { AppRepo } from './source.js'
import type { FoundationAppInfo, FoundationItemResult, FoundationResult } from './types.js'

export const TOOLCHAIN_TOOL_NAME = '@narduk-enterprises/narduk-app-tools/toolchain-single-source'
export const TOOLCHAIN_CONTRACT_SOURCE =
  'Logan, askme 2026-09-17: "Single-source toolchain versions (Recommended)" (company-hq#745)'

/** One row of the declaration-site table the command prints and emits. */
export interface ToolchainSiteReport {
  file: string
  locator: string
  toolchain: 'node' | 'pnpm'
  value: string | null
  line: number | null
  role: 'source' | 'derives' | 'mirror'
  status: string
}

/** A one-item artefact, deliberately NOT shaped like `FoundationCheckArtefact`
 * (no `items` array, no claim of the ratified 7-item contract). */
export interface ToolchainArtefact {
  schemaVersion: 1
  tool: typeof TOOLCHAIN_TOOL_NAME
  toolVersion: string
  generated: string
  app: FoundationAppInfo
  contract: { source: string; items: 1 }
  sources: {
    node: { file: string; value: string | null }
    pnpm: { file: string; key: string; value: string | null }
  }
  /** Every declaration site found, source first. The estate roster reads this
   * as data rather than parsing sub-check prose. */
  sites: ToolchainSiteReport[]
  /** Populated only by `--fix`: what was rewritten. */
  fixes: ToolchainFix[]
  item: FoundationItemResult
  result: FoundationResult
  exitCode: 0 | 1 | 2
}

export interface ToolchainFix {
  file: string
  line: number
  locator: string
  before: string
  after: string
}

function reportSite(site: ToolchainSite, scan: ToolchainScan): ToolchainSiteReport {
  return {
    file: site.file,
    locator: site.locator,
    toolchain: site.toolchain,
    value: site.value,
    line: site.line,
    role: site.isSource ? 'source' : site.derives ? 'derives' : 'mirror',
    status: siteStatus(site, scan),
  }
}

function allSites(scan: ToolchainScan): ToolchainSite[] {
  const sources = [scan.sources.node.site, scan.sources.pnpm.site].filter(
    (site): site is ToolchainSite => site !== null,
  )
  return [...sources, ...scan.mirrors]
}

/* -------------------------------------------------------------------------- */
/* --fix                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Rewrites a mirror's literal on its own line, leaving every other byte of the
 * file alone. Deliberately narrow: `--fix` swaps a VALUE, never a file's shape.
 * A workflow that pins `node-version:` instead of pointing at
 * `node-version-file:`, or a `pnpm/action-setup` carrying a `version:` input, is
 * a structural change to a file the app owns, so those are reported with the
 * exact edit and left for a human.
 */
function rewriteLine(line: string, from: string, to: string): string | null {
  const index = line.indexOf(from)
  if (index === -1) return null
  const tail = line.slice(index + from.length)
  // Guard against rewriting a longer version that merely contains this one
  // (`24.21.0` inside `24.21.0-rc.1`).
  if (/^[\w.-]/u.test(tail)) return null
  const plain = line.slice(0, index) + to + tail

  // Markdown tables are column-aligned; absorb the width change from the
  // padding run before the next cell boundary so the app's own format:check
  // still passes. When there is no boundary, or the padding cannot absorb the
  // change, leave the width alone and let the formatter re-pad.
  const delta = to.length - from.length
  if (delta === 0) return plain
  const bar = tail.indexOf('|')
  if (bar === -1) return plain
  let pad = 0
  while (pad < bar && tail[bar - 1 - pad] === ' ') pad += 1
  if (pad === 0 || (delta > 0 && pad <= delta)) return plain
  return (
    line.slice(0, index) + to + tail.slice(0, bar - pad) + ' '.repeat(pad - delta) + tail.slice(bar)
  )
}

export function planToolchainFixes(scan: ToolchainScan): ToolchainFix[] {
  const fixes: ToolchainFix[] = []
  for (const site of scan.mirrors) {
    if (!site.fixable || site.line === null || site.value === null) continue
    const expected = site.toolchain === 'node' ? scan.sources.node.value : scan.sources.pnpm.value
    if (expected === null || site.value === expected) continue
    fixes.push({
      file: site.file,
      line: site.line,
      locator: site.locator,
      before: site.value,
      after: expected,
    })
  }
  // File then line, so `--fix` output reads in the order a human would open the
  // files -- the collection order is per-manifest-key and jumps around.
  return fixes.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)))
}

/** Applies the planned fixes to disk. Returns only the ones actually written. */
export function applyToolchainFixes(root: string, fixes: readonly ToolchainFix[]): ToolchainFix[] {
  const repo = new AppRepo(root)
  const applied: ToolchainFix[] = []
  const byFile = new Map<string, ToolchainFix[]>()
  for (const fix of fixes) {
    byFile.set(fix.file, [...(byFile.get(fix.file) ?? []), fix])
  }
  for (const [file, fileFixes] of byFile) {
    const text = repo.read(file)
    if (text === null) continue
    const lines = text.split('\n')
    let changed = false
    for (const fix of fileFixes) {
      const index = fix.line - 1
      if (index < 0 || index >= lines.length) continue
      const rewritten = rewriteLine(lines[index], fix.before, fix.after)
      if (rewritten === null) continue
      lines[index] = rewritten
      changed = true
      applied.push(fix)
    }
    if (changed) writeFileSync(join(root, file), lines.join('\n'), 'utf8')
  }
  return applied
}

/* -------------------------------------------------------------------------- */
/* runner                                                                      */
/* -------------------------------------------------------------------------- */

export interface RunToolchainCheckOptions {
  root: string
  toolVersion: string
  /** Rewrite mismatching mirror values to the source, then re-evaluate. */
  fix?: boolean
  appOverrides?: Partial<FoundationAppInfo>
  generated?: string
}

export function runToolchainCheck(options: RunToolchainCheckOptions): ToolchainArtefact {
  const repo = new AppRepo(options.root)
  let scan = scanToolchain(repo)
  let fixes: ToolchainFix[] = []
  if (options.fix) {
    fixes = applyToolchainFixes(options.root, planToolchainFixes(scan))
    // Re-read from disk so the reported verdict is the post-fix truth, not a
    // prediction of it.
    if (fixes.length > 0) scan = scanToolchain(new AppRepo(options.root))
  }

  const checks = evaluateItem11(repo, scan)
  const item: FoundationItemResult = {
    id: TOOLCHAIN_ITEM_ID,
    name: TOOLCHAIN_ITEM_NAME,
    status: rollUp(checks),
    checks,
  }
  const result: FoundationResult =
    item.status === 'fail' ? 'FAIL' : item.status === 'unknown' ? 'UNKNOWN' : 'PASS'
  const exitCode: 0 | 1 | 2 = result === 'FAIL' ? 1 : result === 'UNKNOWN' ? 2 : 0

  return {
    schemaVersion: 1,
    tool: TOOLCHAIN_TOOL_NAME,
    toolVersion: options.toolVersion,
    generated: options.generated ?? new Date().toISOString(),
    app: resolveAppInfo(options.root, options.appOverrides),
    contract: { source: TOOLCHAIN_CONTRACT_SOURCE, items: 1 },
    sources: {
      node: { file: NODE_SOURCE_FILE, value: scan.sources.node.value },
      pnpm: { file: 'package.json', key: PNPM_SOURCE_KEY, value: scan.sources.pnpm.value },
    },
    sites: allSites(scan).map((site) => reportSite(site, scan)),
    fixes,
    item,
    result,
    exitCode,
  }
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length)
}

/** The declaration-site table, which is the whole point of the command: every
 * place a version is written down, its value, and whether it agrees. */
export function formatToolchainSummary(artefact: ToolchainArtefact): string {
  const lines: string[] = []
  lines.push(`foundation:check:toolchain -- ${artefact.app.repo}`)
  lines.push(`  contract   ${artefact.contract.source}`)
  lines.push(
    `  sources    node ${artefact.sources.node.value ?? '(missing)'} <- ${artefact.sources.node.file}` +
      `; pnpm ${artefact.sources.pnpm.value ?? '(missing)'} <- ${artefact.sources.pnpm.file} "${artefact.sources.pnpm.key}"`,
  )
  lines.push('')

  const rows = artefact.sites.map((site) => ({
    where: site.line === null ? site.file : `${site.file}:${site.line}`,
    locator: site.locator,
    tool: site.toolchain,
    value: site.value ?? '(absent)',
    role: site.role,
    status: site.status,
  }))
  const widths = {
    where: Math.max(5, ...rows.map((row) => row.where.length)),
    locator: Math.max(7, ...rows.map((row) => row.locator.length)),
    value: Math.max(5, ...rows.map((row) => row.value.length)),
    role: Math.max(4, ...rows.map((row) => row.role.length)),
  }
  lines.push(
    `  ${pad('WHERE', widths.where)}  ${pad('DECLARES', widths.locator)}  ${pad('TOOL', 4)}  ${pad('VALUE', widths.value)}  ${pad('ROLE', widths.role)}  STATUS`,
  )
  for (const row of rows) {
    lines.push(
      `  ${pad(row.where, widths.where)}  ${pad(row.locator, widths.locator)}  ${pad(row.tool, 4)}  ${pad(row.value, widths.value)}  ${pad(row.role, widths.role)}  ${row.status}`,
    )
  }
  lines.push('')

  if (artefact.fixes.length > 0) {
    lines.push(`  fixed ${artefact.fixes.length} mirror(s):`)
    for (const fix of artefact.fixes) {
      lines.push(`    ${fix.file}:${fix.line} ${fix.locator}  ${fix.before} -> ${fix.after}`)
    }
    lines.push('')
  }

  const mark =
    artefact.item.status === 'pass'
      ? 'PASS'
      : artefact.item.status === 'fail'
        ? 'FAIL'
        : artefact.item.status === 'unknown'
          ? 'UNKN'
          : 'N/A '
  lines.push(`  [${mark}] item ${artefact.item.id} ${artefact.item.name}`)
  for (const sub of artefact.item.checks) {
    if (sub.status === 'pass') continue
    const subMark = sub.status === 'fail' ? 'FAIL' : sub.status === 'unknown' ? 'UNKN' : 'N/A '
    lines.push(`         [${subMark}] ${sub.id} ${sub.name}: ${sub.detail}`)
  }
  lines.push('')
  lines.push(`RESULT: ${artefact.result}`)
  return lines.join('\n')
}
