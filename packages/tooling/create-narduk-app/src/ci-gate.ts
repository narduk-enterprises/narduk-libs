/**
 * `upgrade`'s repository-gate edit of an existing app's `.github/workflows/ci.yml`
 * (company-hq NAC-GATE-PARITY, §3.11: "`create-narduk-app` and its `upgrade`
 * path emit the complete repository gate").
 *
 * The caller's inputs are the app's policy, so this never re-renders the file.
 * It edits single lines inside each shared-workflow caller's `with:` block and
 * leaves every other input, comment and blank line where the app put it:
 *
 * - `extra-scripts` gains each {@link REPOSITORY_GATE_SCRIPTS} name it lacks,
 *   appended after the app's own names, in the app's quoting style;
 * - `quality-level` becomes `standard` (the shared workflow's gate set that
 *   probes item 10 on the pull request's preview);
 * - `performance-budget-args: --app-dir apps/web` is added when an `apps/web`
 *   app turns `standard` on without it, because `standard` runs the budget from
 *   the repository root and would not find that app's build output. Any other
 *   budget argument is the app's own.
 *
 * A public app calls no shared workflow. Its gate is two steps after the
 * generator's `pnpm run quality:static` step, inserted when missing.
 *
 * It never writes a `quality-opt-out`: turning a gate off is the app's written
 * decision. Where `standard` cannot work as the app is configured today, the
 * edit says so and the unit stays unresolved rather than green.
 */

import {
  CANDIDATE_SECURITY_HEADERS_STEP_NAME,
  publicRepositoryGateSteps,
  REPOSITORY_GATE_STEP_NAME,
  SHARED_WORKFLOW_CALLER_PERMISSIONS,
} from './ci-workflow.js'
import type { AppLayout } from './checkout-facts.js'
import { REPOSITORY_GATE_SCRIPTS } from './ownership.js'

export interface CiGateContext {
  layout: AppLayout
  /** Root scripts the app will have once this upgrade's package.json unit lands. */
  scriptsAfterUpgrade: ReadonlySet<string>
  /** Whether the app's Nuxt config states `enforce: true` anywhere. A heuristic. */
  cspEnforcedHint: boolean
}

export interface CiGateEdit {
  contents: string
  /** What was added, one phrase each, for the report. */
  added: string[]
  /** Why the gate is still incomplete after the edit. Non-empty means unresolved. */
  problems: string[]
  /** Advisory facts that do not block the edit. */
  warnings: string[]
}

const CALLER_USES =
  /^\s*uses:\s*narduk-enterprises\/workflows\/\.github\/workflows\/nuxt-cloudflare\.yml@/u

function indentOf(line: string): number {
  return /^(\s*)/u.exec(line)?.[1]?.length ?? 0
}

function isMeaningful(line: string): boolean {
  const trimmed = line.trim()
  return trimmed !== '' && !trimmed.startsWith('#')
}

interface Scalar {
  value: string
  render: (value: string) => string
}

/**
 * A single-line YAML scalar after `key:`, with the quoting it came in and any
 * trailing comment, or null for a shape this edit will not touch (a block
 * scalar, a flow collection, or an escape it would have to interpret).
 */
function readScalar(rest: string): Scalar | null {
  const text = rest.trimEnd()
  const quote = text[0]
  if (quote === "'" || quote === '"') {
    const close = text.indexOf(quote, 1)
    if (close === -1) return null
    const inner = text.slice(1, close)
    if (quote === "'" && text[close + 1] === "'") return null
    if (quote === '"' && inner.includes('\\')) return null
    const tail = text.slice(close + 1)
    if (tail.trim() !== '' && !/^\s+#/u.test(tail)) return null
    return { render: (value) => quote + value + quote + tail, value: inner }
  }
  if (/^[|>[{&*!]/u.test(text)) return null
  const comment = /\s+#.*$/u.exec(text)
  const value = comment ? text.slice(0, comment.index) : text
  const tail = comment ? comment[0] : ''
  return { render: (next) => next + tail, value }
}

interface WithBlock {
  /** Index of the `with:` line. */
  withLine: number
  /** First line after the block. */
  end: number
  /** Indentation of the inputs, as a string. */
  inputIndent: string
}

function findWithBlock(lines: readonly string[], usesLine: number): WithBlock | null {
  const jobIndent = indentOf(lines[usesLine] as string)
  let jobEnd = lines.length
  for (let index = usesLine + 1; index < lines.length; index += 1) {
    const line = lines[index] as string
    if (isMeaningful(line) && indentOf(line) < jobIndent) {
      jobEnd = index
      break
    }
  }
  // `with:` may sit before or after `uses:`; search the whole job body.
  let jobStart = usesLine
  while (jobStart > 0) {
    const previous = lines[jobStart - 1] as string
    if (isMeaningful(previous) && indentOf(previous) < jobIndent) break
    jobStart -= 1
  }
  for (let index = jobStart; index < jobEnd; index += 1) {
    const line = lines[index] as string
    if (indentOf(line) !== jobIndent || !/^\s*with:\s*(?:#.*)?$/u.test(line)) continue
    let end = jobEnd
    let inputIndent: string | null = null
    for (let inner = index + 1; inner < jobEnd; inner += 1) {
      const candidate = lines[inner] as string
      if (!isMeaningful(candidate)) continue
      if (indentOf(candidate) <= jobIndent) {
        end = inner
        break
      }
      inputIndent ??= ' '.repeat(indentOf(candidate))
    }
    return {
      end,
      inputIndent: inputIndent ?? ' '.repeat(jobIndent + 2),
      withLine: index,
    }
  }
  return null
}

function findInput(
  lines: readonly string[],
  block: WithBlock,
  key: string,
): { index: number; rest: string } | null {
  const pattern = new RegExp('^' + block.inputIndent + key + ':(.*)$', 'u')
  for (let index = block.withLine + 1; index < block.end; index += 1) {
    const match = pattern.exec(lines[index] as string)
    if (match) return { index, rest: (match[1] ?? '').trimStart() }
  }
  return null
}

function scalarValue(lines: readonly string[], block: WithBlock, key: string): string | null {
  const found = findInput(lines, block, key)
  if (!found) return null
  return readScalar(found.rest)?.value.trim() ?? null
}

/** Edits every shared-workflow caller in a private app's ci.yml. */
export function applyCallerGate(source: string, context: CiGateContext): CiGateEdit {
  const lines = source.split('\n')
  const added: string[] = []
  const problems: string[] = []
  const warnings: string[] = []
  const callers = lines.flatMap((line, index) => (CALLER_USES.test(line) ? [index] : []))

  // Walk bottom-up so an insertion never moves a caller not yet edited.
  for (const usesLine of [...callers].reverse()) {
    const block = findWithBlock(lines, usesLine)
    if (!block) {
      problems.push(
        'a shared-workflow caller has no `with:` block this edit can read; add the repository gate inputs by hand',
      )
      continue
    }
    const inserts: string[] = []

    // extra-scripts: the gate names, after the app's own.
    const available = REPOSITORY_GATE_SCRIPTS.filter((name) =>
      context.scriptsAfterUpgrade.has(name),
    )
    const missingScripts = REPOSITORY_GATE_SCRIPTS.filter(
      (name) => !context.scriptsAfterUpgrade.has(name),
    )
    if (missingScripts.length) {
      problems.push(
        'package.json will not have ' +
          missingScripts.join(', ') +
          ', so CI cannot name ' +
          (missingScripts.length === 1 ? 'it' : 'them') +
          ' (run upgrade on package.json too, or add the script)',
      )
    }
    const extra = findInput(lines, block, 'extra-scripts')
    if (extra) {
      const scalar = readScalar(extra.rest)
      if (!scalar) {
        problems.push(
          '`extra-scripts` is not a single-line value; append ' +
            available.join(' ') +
            ' to it by hand',
        )
      } else {
        const names = scalar.value.split(/\s+/u).filter(Boolean)
        const missing = available.filter((name) => !names.includes(name))
        if (missing.length) {
          lines[extra.index] =
            block.inputIndent + 'extra-scripts: ' + scalar.render([...names, ...missing].join(' '))
          added.push('extra-scripts ' + missing.join(' '))
        }
      }
    } else if (available.length) {
      inserts.push(block.inputIndent + "extra-scripts: '" + available.join(' ') + "'")
      added.push('extra-scripts ' + available.join(' '))
    }

    // quality-level: standard, unless standard cannot run as configured.
    const previewChecks = scalarValue(lines, block, 'preview-checks')
    const optOut = scalarValue(lines, block, 'quality-opt-out') ?? ''
    const headersOptedOut = /(?:^|,)\s*security-headers\s*=/u.test(optOut)
    const level = findInput(lines, block, 'quality-level')
    const levelValue = level ? (readScalar(level.rest)?.value.trim() ?? null) : null
    if (levelValue !== 'standard') {
      if (previewChecks === 'none' && !headersOptedOut) {
        problems.push(
          "`quality-level: standard` probes item 10 on the pull request's Cloudflare preview, and this caller sets `preview-checks: none`. Enable a Workers Builds preview and drop that input, or record `quality-opt-out: security-headers=<reason>` yourself; upgrade writes neither, and leaves quality-level unchanged",
        )
      } else if (level && levelValue === null) {
        problems.push('`quality-level` is not a single-line value; set it to standard by hand')
      } else {
        if (level) {
          lines[level.index] = block.inputIndent + 'quality-level: standard'
        } else {
          inserts.push(block.inputIndent + 'quality-level: standard')
        }
        added.push('quality-level standard')
        if (context.layout === 'apps-web' && !findInput(lines, block, 'performance-budget-args')) {
          inserts.push(block.inputIndent + 'performance-budget-args: --app-dir apps/web')
          added.push('performance-budget-args --app-dir apps/web')
        }
        if (!context.cspEnforcedHint) {
          warnings.push(
            "no `enforce: true` in the Nuxt config: item 10 fails on the preview until narduk-core's CSP preset is enforced (`nardukCore.security.headers: { enabled: true, enforce: true }`); the Nuxt config unit reports why upgrade did not add it",
          )
        }
      }
    }

    if (inserts.length) lines.splice(block.withLine + 1, 0, ...inserts)
  }

  return { added, contents: lines.join('\n'), problems, warnings }
}

/**
 * Grants each shared-workflow caller the job-level permissions in
 * {@link SHARED_WORKFLOW_CALLER_PERMISSIONS} it lacks, so a re-pin never moves
 * an app onto a workflow its caller cannot start. Adds entries only: a grant
 * the app already made is never narrowed or removed, and a scalar or flow
 * `permissions:` value is reported, not rewritten.
 */
export function applyCallerPermissions(source: string): Omit<CiGateEdit, 'warnings'> {
  const lines = source.split('\n')
  const added = new Set<string>()
  const problems: string[] = []
  const callers = lines.flatMap((line, index) => (CALLER_USES.test(line) ? [index] : []))

  // Bottom-up, as in applyCallerGate, so an insertion never moves a caller not yet edited.
  for (const usesLine of [...callers].reverse()) {
    const jobIndent = indentOf(lines[usesLine] as string)
    let jobStart = usesLine
    while (jobStart > 0) {
      const previous = lines[jobStart - 1] as string
      if (isMeaningful(previous) && indentOf(previous) < jobIndent) break
      jobStart -= 1
    }
    let jobEnd = lines.length
    for (let index = usesLine + 1; index < lines.length; index += 1) {
      const line = lines[index] as string
      if (isMeaningful(line) && indentOf(line) < jobIndent) {
        jobEnd = index
        break
      }
    }
    const header = lines.findIndex(
      (line, index) =>
        index >= jobStart &&
        index < jobEnd &&
        indentOf(line) === jobIndent &&
        /^\s*permissions:/u.test(line),
    )
    const pad = ' '.repeat(jobIndent + 2)
    if (header === -1) {
      lines.splice(
        usesLine + 1,
        0,
        ' '.repeat(jobIndent) + 'permissions:',
        ...SHARED_WORKFLOW_CALLER_PERMISSIONS.map((entry) => pad + entry),
      )
      for (const entry of SHARED_WORKFLOW_CALLER_PERMISSIONS) added.add(entry)
      continue
    }
    if (!/^\s*permissions:\s*(?:#.*)?$/u.test(lines[header] as string)) {
      problems.push(
        'a shared-workflow caller sets `permissions:` on one line; grant ' +
          SHARED_WORKFLOW_CALLER_PERMISSIONS.join(', ') +
          ' by hand',
      )
      continue
    }
    const granted = new Map<string, number>()
    let end = header + 1
    let entryIndent = pad
    for (let index = header + 1; index < jobEnd; index += 1) {
      const line = lines[index] as string
      if (!isMeaningful(line)) continue
      if (indentOf(line) <= jobIndent) break
      entryIndent = ' '.repeat(indentOf(line))
      const match = /^\s*([a-z-]+):\s*[a-z]+/u.exec(line)
      if (match) granted.set(match[1] as string, index)
      end = index + 1
    }
    const inserts: string[] = []
    for (const entry of SHARED_WORKFLOW_CALLER_PERMISSIONS) {
      const [scope, level] = entry.split(': ') as [string, string]
      const at = granted.get(scope)
      if (at === undefined) {
        inserts.push(entryIndent + entry)
        added.add(entry)
        continue
      }
      const current = /:\s*([a-z]+)/u.exec(lines[at] as string)?.[1]
      if (current === 'none' || (current === 'read' && level === 'write')) {
        problems.push(
          'a shared-workflow caller grants `' +
            scope +
            ': ' +
            current +
            '`; the shared workflow needs `' +
            entry +
            '` to start (upgrade does not widen a grant the app wrote)',
        )
      }
    }
    if (inserts.length) lines.splice(end, 0, ...inserts)
  }

  return { added: [...added], contents: lines.join('\n'), problems }
}

/**
 * Adds the public workflow's repository-gate steps after the generator's
 * `pnpm run quality:static` step. Null when that step is not there exactly
 * once, so the caller can say what it could not find.
 */
export function applyPublicGate(source: string, context: CiGateContext): CiGateEdit | null {
  const lines = source.split('\n')
  const hasGate = lines.some((line) => line.trim() === '- name: ' + REPOSITORY_GATE_STEP_NAME)
  const hasProbe = lines.some(
    (line) => line.trim() === '- name: ' + CANDIDATE_SECURITY_HEADERS_STEP_NAME,
  )
  const problems: string[] = []
  const missingScripts = REPOSITORY_GATE_SCRIPTS.filter(
    (name) => !context.scriptsAfterUpgrade.has(name),
  )
  if (missingScripts.length) {
    problems.push(
      'package.json will not have ' +
        missingScripts.join(', ') +
        ', which the repository gate step runs (run upgrade on package.json too, or add the script)',
    )
  }
  if (hasGate && hasProbe) return { added: [], contents: source, problems, warnings: [] }

  const anchors = lines.flatMap((line, index) =>
    /^\s*- run: pnpm run quality:static\s*$/u.test(line) ? [index] : [],
  )
  if (anchors.length !== 1) return null
  const anchor = anchors[0] as number
  const stepIndent = ' '.repeat(indentOf(lines[anchor] as string))

  // Split the rendered steps back into the two named steps.
  const rendered = publicRepositoryGateSteps()
  const probeStart = rendered.findIndex(
    (line) => line.trim() === '- name: ' + CANDIDATE_SECURITY_HEADERS_STEP_NAME,
  )
  const gateLines = rendered.slice(0, probeStart)
  const probeLines = rendered.slice(probeStart)
  const renderedIndent = indentOf(rendered[0] as string)
  const reindent = (block: readonly string[]): string[] =>
    block.map((line) => stepIndent + line.slice(renderedIndent))

  const inserts: string[] = []
  const added: string[] = []
  if (!hasGate) {
    inserts.push(...reindent(gateLines))
    added.push('step "' + REPOSITORY_GATE_STEP_NAME + '"')
  }
  if (!hasProbe) {
    inserts.push(...reindent(probeLines))
    added.push('step "' + CANDIDATE_SECURITY_HEADERS_STEP_NAME + '"')
  }
  lines.splice(anchor + 1, 0, ...inserts)
  const warnings = context.cspEnforcedHint
    ? []
    : [
        "no `enforce: true` in the Nuxt config: the item-10 step fails until narduk-core's CSP preset is enforced (`nardukCore.security.headers: { enabled: true, enforce: true }`); the Nuxt config unit reports why upgrade did not add it",
      ]
  return { added, contents: lines.join('\n'), problems, warnings }
}
