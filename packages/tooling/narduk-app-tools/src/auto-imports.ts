/**
 * `narduk-app check-auto-imports`: fail when Nuxt's auto-import scan finds two
 * exports of one name.
 *
 * Nitro and Nuxt auto-import every export of `server/utils/**`,
 * `shared/utils/**`, `app/utils/**` and `app/composables/**`. When two files
 * export the same name, unimport keeps one and only WARNS ("Duplicated
 * imports"); `nuxt prepare` still exits 0. A re-export (`export { x } from
 * './sibling'`) is the usual cause, and two different functions sharing a name
 * is the dangerous one: a caller silently binds to whichever file unimport kept.
 *
 * WHY THE LOG, NOT .nuxt/types. `.nuxt/types/imports.d.ts` and
 * `nitro-imports.d.ts` are written AFTER unimport's `dedupeImports`, so the
 * ignored duplicate is already gone from them. Scraping the `nuxt prepare` output
 * for unimport's one warning line is the only source that still names both
 * files. The line is parsed strictly; a "Duplicated imports" line that no longer
 * matches (unimport reworded it) is reported as UNPARSED and fails the check
 * rather than passing silently.
 *
 * Exit codes: 0 no duplicates, 1 duplicates (or an unparseable warning),
 * 2 inconclusive (`nuxt prepare` failed, or the log could not be read).
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'

export const AUTO_IMPORTS_USAGE =
  'Usage: narduk-app check-auto-imports [--cwd <app dir>] [--log <nuxt prepare output>] [--json [path]]'

export const AUTO_IMPORTS_EXIT = { clean: 0, duplicates: 1, inconclusive: 2 } as const

export interface AutoImportsArgs {
  cwd: string
  /** Scan this saved `nuxt prepare` output instead of running it. */
  logPath: string | null
  json: boolean
  jsonPath: string | null
}

export function parseAutoImportsArgs(
  args: readonly string[],
  cwd = process.cwd(),
): AutoImportsArgs {
  let root = cwd
  let logPath: string | null = null
  let json = false
  let jsonPath: string | null = null
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--cwd' || arg === '--log') {
      const value = args[(index += 1)]
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`)
      if (arg === '--cwd') root = value
      else logPath = value
    } else if (arg === '--json') {
      json = true
      const next = args[index + 1]
      if (next && !next.startsWith('--')) {
        jsonPath = next
        index += 1
      }
    } else {
      throw new Error(`Unknown check-auto-imports option: ${arg}\n${AUTO_IMPORTS_USAGE}`)
    }
  }
  const resolvedRoot = resolve(cwd, root)
  return {
    cwd: resolvedRoot,
    json,
    jsonPath: jsonPath ? resolve(cwd, jsonPath) : null,
    logPath: logPath ? resolve(cwd, logPath) : null,
  }
}

export interface AutoImportDuplicate {
  name: string
  /** The file unimport dropped. */
  ignored: string
  /** The file unimport kept; a caller of `name` binds to this one. */
  used: string
}

export interface AutoImportsScan {
  duplicates: AutoImportDuplicate[]
  /** "Duplicated imports" lines this parser could not read; any one fails. */
  unparsed: string[]
}

// eslint-disable-next-line no-control-regex -- stripping ANSI colour escapes
const ANSI = /\u001B\[[0-9;]*m/gu
const DUPLICATE_MARKER = 'Duplicated imports'
const DUPLICATE_LINE =
  /Duplicated imports "([^"]+)", the one from "([^"]+)" has been ignored and "([^"]+)" is used/u

/**
 * Every distinct (name, ignored, used) triple in `output`, in first-seen order.
 * Nuxt and Nitro each scan the same dirs, so one collision is logged twice.
 */
export function scanDuplicatedImports(output: string, root?: string): AutoImportsScan {
  const seen = new Set<string>()
  const duplicates: AutoImportDuplicate[] = []
  const unparsed: string[] = []
  const show = (path: string): string => {
    if (!root || !isAbsolute(path)) return path
    const rel = relative(root, path)
    return rel.startsWith('..') ? path : rel
  }
  for (const rawLine of output.replaceAll(ANSI, '').split(/\r?\n/u)) {
    if (!rawLine.includes(DUPLICATE_MARKER)) continue
    const line = rawLine.trim()
    const match = DUPLICATE_LINE.exec(line)
    if (!match) {
      if (!unparsed.includes(line)) unparsed.push(line)
      continue
    }
    const [, name = '', ignored = '', used = ''] = match
    const key = `${name}\0${ignored}\0${used}`
    if (seen.has(key)) continue
    seen.add(key)
    duplicates.push({ name, ignored: show(ignored), used: show(used) })
  }
  return { duplicates, unparsed }
}

export interface AutoImportsReport extends AutoImportsScan {
  status: 'pass' | 'fail' | 'inconclusive'
  exitCode: number
  /** Why the result is inconclusive; null otherwise. */
  reason: string | null
}

export interface AutoImportsDeps {
  /** Run `nuxt prepare` in `cwd`, returning combined stdout+stderr and the exit code. */
  prepare?: (cwd: string) => { output: string; status: number; error?: string }
  readLog?: (path: string) => string
  writeJson?: (path: string, text: string) => void
  log?: (line: string) => void
  out?: (line: string) => void
}

function nuxtBinary(cwd: string): string {
  const local = join(cwd, 'node_modules', '.bin', 'nuxt')
  return existsSync(local) ? local : 'nuxt'
}

function runNuxtPrepare(cwd: string): { output: string; status: number; error?: string } {
  // NO_COLOR keeps the warning lines free of escapes; the scan strips them anyway.
  const result = spawnSync(nuxtBinary(cwd), ['prepare'], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
  })
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  if (result.error) return { output, status: 1, error: result.error.message }
  return { output, status: result.status ?? 1 }
}

export function formatAutoImportsReport(report: AutoImportsReport): string {
  if (report.status === 'inconclusive') {
    return `[auto-imports] INCONCLUSIVE: ${report.reason ?? 'unknown'}`
  }
  if (report.status === 'pass') return '[auto-imports] PASS: no duplicated auto-imports'
  const lines = [
    `[auto-imports] FAIL: ${report.duplicates.length + report.unparsed.length} duplicated auto-import(s).`,
    'Nitro/Nuxt auto-import every export of server/utils, shared/utils, app/utils and',
    'app/composables. Two files exporting one name collide and unimport silently keeps',
    'one, so a caller can bind to the wrong function. Rename one, or delete the',
    're-export (`export { x } from ...`) and import the original where it is needed.',
    '',
  ]
  for (const entry of report.duplicates) {
    lines.push(`- ${entry.name}`, `    used:    ${entry.used}`, `    ignored: ${entry.ignored}`)
  }
  for (const line of report.unparsed) {
    lines.push(`- unreadable warning (unimport may have reworded it): ${line}`)
  }
  return lines.join('\n')
}

export function runAutoImportsCheck(
  args: AutoImportsArgs,
  deps: AutoImportsDeps = {},
): AutoImportsReport {
  const prepare = deps.prepare ?? runNuxtPrepare
  const readLog = deps.readLog ?? ((path: string) => readFileSync(path, 'utf8'))
  const writeJson = deps.writeJson ?? ((path, text) => writeFileSync(path, text, 'utf8'))
  const log = deps.log ?? ((line: string) => console.error(line))
  const out = deps.out ?? ((line: string) => console.log(line))

  const inconclusive = (reason: string): AutoImportsReport => ({
    duplicates: [],
    exitCode: AUTO_IMPORTS_EXIT.inconclusive,
    reason,
    status: 'inconclusive',
    unparsed: [],
  })

  const report = ((): AutoImportsReport => {
    let output: string
    if (args.logPath) {
      try {
        output = readLog(args.logPath)
      } catch (error) {
        return inconclusive(
          `cannot read ${args.logPath}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    } else {
      const run = prepare(args.cwd)
      if (run.status !== 0) {
        log(run.output)
        return inconclusive(
          run.error
            ? `could not run nuxt prepare in ${args.cwd}: ${run.error}`
            : `nuxt prepare exited ${run.status} in ${args.cwd}`,
        )
      }
      output = run.output
    }
    const scan = scanDuplicatedImports(output, args.cwd)
    const failed = scan.duplicates.length + scan.unparsed.length > 0
    return {
      ...scan,
      exitCode: failed ? AUTO_IMPORTS_EXIT.duplicates : AUTO_IMPORTS_EXIT.clean,
      reason: null,
      status: failed ? 'fail' : 'pass',
    }
  })()

  const json = `${JSON.stringify(report, null, 2)}\n`
  if (args.jsonPath) writeJson(args.jsonPath, json)
  if (args.json) out(json.trimEnd())
  else if (report.status === 'pass') out(formatAutoImportsReport(report))
  else log(formatAutoImportsReport(report))
  return report
}
