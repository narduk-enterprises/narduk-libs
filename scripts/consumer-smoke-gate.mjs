/**
 * The repository-gate round trip of the packed-consumer smoke (company-hq
 * NAC-GATE-PARITY, §3.11): the gate the packed generator emits, and the gate
 * its `upgrade` writes into an app generated before that gate existed, are
 * the same gate, and the packed validators return the verdict this module
 * names for it.
 *
 * release-packages.mjs runs the commands; everything here is pure so
 * `node --test` can cover it (release-packages.mjs has top-level side effects
 * and cannot be imported).
 *
 * The verdicts are pinned exactly, not bounded. A new FAIL or UNKNOWN turns
 * the job red, and so does one of the named ones closing: each is a known,
 * written-down gap, and it should leave this file on purpose, in the diff
 * that closes it.
 */

import { createRequire } from 'node:module'
import { join } from 'node:path'

/**
 * The root scripts NAC-GATE-PARITY added to generated apps. An app generated
 * before it has `foundation:shared-ui-pinned` (item 8) but none of these.
 */
export const gateScriptsAddedByParity = [
  'foundation:check:coverage',
  'foundation:check:toolchain',
  'foundation:check:deployment',
]

/** Every root script the emitted gate names: items 8, 9, 11 and 12. */
export const repositoryGateScripts = ['foundation:shared-ui-pinned', ...gateScriptsAddedByParity]

/**
 * `foundation:check` (items 1-7) verdicts of the two smoke apps, as the
 * specification and the scaffold make them today.
 *
 * - private, D1: sub-check 1.5 FAILs on the scaffold's placeholder
 *   `database_id` until `narduk-app db create` runs against Cloudflare, which
 *   a credential-free CI job must not do.
 * - public, no database: sub-check 5.1 is UNKNOWN in any public app's own
 *   checkout by specification (company-hq WEB-FOUNDATION-CHECK.md item 5),
 *   which is why the emitted public workflow does not run items 1-7. Pinned
 *   here so that gap stays visible and cannot widen. A policy change that
 *   lets 5.1 pass app-side updates this entry in the same diff.
 */
export const expectedFoundationVerdicts = {
  private: {
    result: 'FAIL',
    exitCode: 1,
    open: { 1.5: 'fail' },
    // The fixture's one D1 binding, still on the scaffold's placeholder id.
    details: {
      1.5: /^1 D1 binding\(s\) in apps\/web\/wrangler\.jsonc still carry the scaffold placeholder database_id 00000000-0000-0000-0000-000000000000: d1_databases\[0\] \(DB\)\. /u,
    },
  },
  public: {
    result: 'UNKNOWN',
    exitCode: 2,
    open: { 5.1: 'unknown' },
    // Unknown because the matrix is cross-repo, not for any other reason.
    details: {
      5.1: /^no callable found in \.github\/workflows, and company-hq Config\/workflow-adoption-matrix\.json is cross-repo -- an app's own CI cannot read it \(spec §3 item 5\)$/u,
    },
  },
}

/**
 * The foundation scripts whose verdict the round trip reads from their JSON
 * artefact. A generated script that stops writing one fails the job rather
 * than falling back to its exit code.
 */
export const artefactGateScripts = [...gateScriptsAddedByParity, 'foundation:check']

/**
 * The script's `--json` artefact path, required for `artefactGateScripts`.
 * Throws when the script is missing or, for those, writes no artefact.
 */
export function requiredArtefactPath(scripts, script) {
  if (typeof scripts?.[script] !== 'string') {
    throw new Error(`The generated package.json has no ${script} script.`)
  }
  const path = scriptArtefactPath(scripts[script])
  if (!path && artefactGateScripts.includes(script)) {
    throw new Error(`The generated ${script} script writes no --json artefact to judge.`)
  }
  return path
}

/**
 * The emitted item-10 step's output must be a PASS of item 10 read from the
 * candidate Worker on the port the step served, not another origin.
 * Returns the failure message, or ''.
 */
export function probeOutputMismatch(output, port) {
  const problems = []
  const probed = [...output.matchAll(/^ {2}probed {5}(\S+) -> (\d+)$/gmu)]
  if (probed.length === 0) problems.push('no probed route')
  for (const [, url, status] of probed) {
    if (!url.startsWith(`http://127.0.0.1:${port}/`)) {
      problems.push(`probed ${url}, not the candidate on 127.0.0.1:${port}`)
    }
    if (status !== '200') problems.push(`${url} answered ${status}`)
  }
  if (!/^ {2}\[PASS\] item 10 security-headers$/mu.test(output)) {
    problems.push('item 10 is not PASS')
  }
  if (!/^RESULT: PASS$/mu.test(output)) problems.push('RESULT is not PASS')
  return problems.join('; ')
}

/** The step-name marker every emitted public gate step carries. */
const publicGateStepPattern = /\(web foundation items? [\d, and]+\)$/u

export function loadYamlParser(generatorDirectory) {
  return createRequire(join(generatorDirectory, 'package.json'))('yaml').parse
}

function replaceOnce(text, pattern, replacement, what) {
  const matches = text.match(new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`))
  if (matches?.length !== 1) {
    throw new Error(
      `Cannot take the generated ci.yml back to its pre-gate shape: expected one ${what}, found ${matches?.length ?? 0}.`,
    )
  }
  return text.replace(pattern, replacement)
}

/**
 * The private caller as create-narduk-app emitted it before NAC-GATE-PARITY:
 * extra-scripts without the parity scripts, and no quality-level. Fails
 * closed when the emitted shape moves, rather than regressing nothing.
 */
export function toPreGatePrivateCaller(ci) {
  const withoutScripts = replaceOnce(
    ci,
    /^( {6}extra-scripts: ')([^'\n]*)'$/mu,
    (_line, prefix, list) =>
      `${prefix}${list
        .split(' ')
        .filter((name) => !gateScriptsAddedByParity.includes(name))
        .join(' ')}'`,
    "single-quoted 'extra-scripts' input",
  )
  if (withoutScripts === ci) {
    throw new Error('The generated extra-scripts input names none of the parity gate scripts.')
  }
  return replaceOnce(
    withoutScripts,
    /^ {6}quality-level: standard\n/mu,
    '',
    "'quality-level' input",
  )
}

/**
 * The public workflow as create-narduk-app emitted it before NAC-GATE-PARITY:
 * `pnpm run quality:static` was the quality job's last step. Removes the
 * items 1-7 comment and every gate step after it, up to the blank line that
 * ends the job.
 */
export function toPreGatePublicWorkflow(ci) {
  const lines = ci.split('\n')
  const anchor = lines.findIndex((line) => line === '      - run: pnpm run quality:static')
  const start = anchor + 1
  const end = lines.findIndex((line, index) => index > start && line.trim() === '')
  if (
    anchor < 0 ||
    end < 0 ||
    !lines.slice(start, end).some((l) => publicGateStepPattern.test(l))
  ) {
    throw new Error(
      'Cannot take the generated public ci.yml back to its pre-gate shape: no gate steps after `pnpm run quality:static`.',
    )
  }
  return [...lines.slice(0, start), ...lines.slice(end)].join('\n')
}

export function withoutParityGateScripts(packageJson) {
  const manifest = JSON.parse(packageJson)
  for (const name of gateScriptsAddedByParity) {
    if (!manifest.scripts?.[name]) {
      throw new Error(`The generated package.json has no ${name} script to take away.`)
    }
    delete manifest.scripts[name]
  }
  return `${JSON.stringify(manifest, null, 2)}\n`
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    )
  }
  return value
}

/**
 * What the upgrade must have done: rewritten both units, and left an app whose
 * ci.yml means exactly what a fresh scaffold's does and whose scripts are the
 * fresh scaffold's.
 */
export function assertUpgradeRestoredGate({ report, generated, upgraded, parseYaml }) {
  for (const path of ['.github/workflows/ci.yml', 'package.json']) {
    const change = report.changes.find((entry) => entry.path === path)
    if (change?.status !== 'drift' || change.applied !== true) {
      throw new Error(
        `upgrade --write did not rewrite ${path} of the pre-gate app (status ${change?.status ?? 'missing'}, applied ${change?.applied ?? false}).`,
      )
    }
  }
  // Mapping keys are unordered in YAML and in package.json scripts: upgrade
  // inserts `quality-level` at the top of `with:`, where a fresh scaffold has
  // it after `foundation-check`. Sequences (steps, lists) keep their order.
  const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
  if (!same(parseYaml(upgraded.ci), parseYaml(generated.ci))) {
    throw new Error("The upgraded ci.yml does not mean what a fresh scaffold's does.")
  }
  const scripts = (text) => JSON.parse(text).scripts
  if (!same(scripts(upgraded.packageJson), scripts(generated.packageJson))) {
    throw new Error("The upgraded package.json scripts differ from a fresh scaffold's.")
  }
  return { byteIdentical: upgraded.ci === generated.ci }
}

/**
 * The gate a generated ci.yml runs, as commands the smoke can execute.
 *
 * - private: every extra-scripts name (run by the shared workflow as
 *   `pnpm run <name>`), except `scaffoldOnly` style checks, plus
 *   `foundation:check` when `foundation-check: true`.
 * - public: the verbatim `run` text of the quality job's gate steps.
 */
export function readRepositoryGate(ci, visibility, parseYaml, scaffoldOnly = new Set()) {
  const workflow = parseYaml(ci)
  if (visibility === 'private') {
    const inputs = workflow?.jobs?.ci?.with ?? {}
    const extraScripts = String(inputs['extra-scripts'] ?? '')
      .split(/\s+/u)
      .filter(Boolean)
    const missing = repositoryGateScripts.filter((name) => !extraScripts.includes(name))
    if (missing.length > 0)
      throw new Error(`Private ci.yml extra-scripts lacks ${missing.join(', ')}.`)
    if (inputs['foundation-check'] !== true) {
      throw new Error('Private ci.yml does not run foundation:check (foundation-check: true).')
    }
    if (inputs['quality-level'] !== 'standard') {
      throw new Error(
        'Private ci.yml does not run quality-level: standard (item 10 on the preview).',
      )
    }
    return {
      scripts: extraScripts.filter((name) => !scaffoldOnly.has(name)),
      runsFoundationCheck: true,
      steps: [],
    }
  }
  const steps = workflow?.jobs?.quality?.steps ?? []
  const anchor = steps.findIndex((step) => step.run === 'pnpm run quality:static')
  const gateSteps = steps
    .slice(anchor + 1)
    .filter((step) => publicGateStepPattern.test(step.name ?? ''))
  if (anchor < 0 || gateSteps.length !== 2) {
    throw new Error(
      `Public ci.yml should run two gate steps after quality:static; found ${gateSteps.length}.`,
    )
  }
  const [gate, probe] = gateSteps
  const gateScripts = gate.run
    .split('\n')
    .map((line) => /^pnpm run (\S+)$/u.exec(line.trim())?.[1])
    .filter(Boolean)
  if (gateScripts.join(' ') !== repositoryGateScripts.join(' ')) {
    throw new Error(`Public repository gate step runs ${gateScripts.join(', ') || 'nothing'}.`)
  }
  if (!probe.run.includes('narduk-app foundation:check:security-headers')) {
    throw new Error('Public item-10 step does not run foundation:check:security-headers.')
  }
  if (!probe.env || !('CANDIDATE_PORT' in probe.env)) {
    throw new Error('Public item-10 step names no CANDIDATE_PORT for the Worker it serves.')
  }
  return {
    scripts: [],
    runsFoundationCheck: false,
    steps: [
      { name: gate.name, run: gate.run, env: gate.env ?? {} },
      { name: probe.name, run: probe.run, env: probe.env ?? {}, needsBuild: true },
    ],
  }
}

/** Every sub-check of a foundation artefact (items 1-7, or one item 8-12). */
function subChecks(artefact) {
  const items = artefact.items ?? (artefact.item ? [artefact.item] : [])
  return items.flatMap((item) => item.checks ?? [])
}

/**
 * The sub-checks that neither passed nor were not applicable, `{ id: status }`.
 * Throws when a sub-check id repeats, since the map would hide one.
 */
export function openSubChecks(artefact) {
  const open = {}
  for (const check of subChecks(artefact)) {
    if (check.status === 'pass' || check.status === 'not-applicable') continue
    if (check.id in open) throw new Error(`Sub-check ${check.id} appears twice in the artefact.`)
    open[check.id] = check.status
  }
  return open
}

/**
 * Compare a validator's artefact and exit code with the pinned expectation.
 * Returns the failure message, or '' when they match exactly.
 */
export function verdictMismatch({ label, artefact, exitCode, expected }) {
  const open = openSubChecks(artefact)
  const problems = []
  if (artefact.result !== expected.result) {
    problems.push(`result ${artefact.result}, expected ${expected.result}`)
  }
  if (exitCode !== expected.exitCode) {
    problems.push(`exit ${exitCode}, expected ${expected.exitCode}`)
  }
  const ids = [...new Set([...Object.keys(open), ...Object.keys(expected.open)])].sort()
  for (const id of ids) {
    const check = subChecks(artefact).find((entry) => entry.id === id)
    if (open[id] !== expected.open[id]) {
      problems.push(
        `sub-check ${id} is ${open[id] ?? 'pass/not-applicable'}, expected ${expected.open[id] ?? 'pass/not-applicable'}${check ? ` (${check.detail})` : ''}`,
      )
    } else if (expected.details?.[id] && !expected.details[id].test(check?.detail ?? '')) {
      problems.push(`sub-check ${id} is ${open[id]} for another reason: ${check?.detail ?? ''}`)
    }
  }
  return problems.length ? `${label}: ${problems.join('; ')}` : ''
}

/** Items 8, 9, 11 and 12 each gate on PASS with nothing open. */
export const passingVerdict = { result: 'PASS', exitCode: 0, open: {} }

/**
 * `create-narduk-app upgrade --json` output: the report, and everything
 * printed around it. The report quotes the workflow's own text in its diffs
 * -- including the item-10 step's `::error::` annotation -- so the warning
 * check reads only what surrounds it; the report itself is judged
 * structurally.
 */
export function splitJsonReport(output) {
  const start = output.indexOf('{')
  const end = output.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('The upgrade printed no JSON report.')
  return {
    report: JSON.parse(output.slice(start, end + 1)),
    rest: `${output.slice(0, start)}${output.slice(end + 1)}`,
  }
}

/** The `--json <path>` artefact a generated foundation script writes, if any. */
export function scriptArtefactPath(scriptBody) {
  return /--json (\S+)/u.exec(scriptBody ?? '')?.[1] ?? null
}
