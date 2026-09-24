/**
 * The generated app's toolchain contract (Logan, askme 2026-09-17: "Single-source
 * toolchain versions (Recommended)"), and the shared workflow's `caller-lint`
 * gate that the pin bump enabling it brings along.
 *
 * Two things are proven here:
 *
 * 1. A scaffold declares Node once (`.node-version`) and pnpm once
 *    (`packageManager`), mirrors them only where a tool can read nothing else,
 *    and never restates either in a workflow.
 * 2. Every workflow the generator writes passes the hygiene rules
 *    `caller-lint` audits, re-implemented here from the job's own inline script
 *    in narduk-enterprises/workflows `nuxt-cloudflare.yml@6f56678`. That gate is
 *    always-run and required, so a template that fails it breaks CI for every
 *    private app the generator has ever produced.
 */

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { buildGeneratedFiles } from '../src/index.js'
import { NODE_VERSION, PACKAGE_MANAGER, PNPM_VERSION } from '../src/manifest.js'
import { MANAGED_TARGETS, NODE_SOURCE_FILE } from '../src/ownership.js'
import type { AppVisibility } from '../src/types.js'

const VISIBILITIES: readonly AppVisibility[] = ['private', 'public']

function generated(visibility: AppVisibility): Map<string, string> {
  return new Map(
    buildGeneratedFiles({ appName: 'toolchain-fixture', visibility }).map((file) => [
      file.path,
      file.contents,
    ]),
  )
}

function workflowPaths(files: Map<string, string>): string[] {
  return [...files.keys()].filter((path) => /^\.github\/workflows\/.+\.ya?ml$/u.test(path))
}

describe.each(VISIBILITIES)('%s app: one declared source per toolchain', (visibility) => {
  it('declares the Node version in .node-version and nowhere else but the manifest mirrors', () => {
    const files = generated(visibility)
    expect(files.get(NODE_SOURCE_FILE)).toBe(`${NODE_VERSION}\n`)
    // No second dotfile: every consumer here that reads `.nvmrc` also reads
    // `.node-version`, so a second copy would be a drift site with no consumer.
    expect(files.has('.nvmrc')).toBe(false)
    expect(files.has('.tool-versions')).toBe(false)

    const manifest = JSON.parse(files.get('package.json')!) as {
      engines: { node: string }
      volta: { node: string }
      packageManager: string
    }
    expect(manifest.engines.node).toBe(NODE_VERSION)
    expect(manifest.volta.node).toBe(NODE_VERSION)

    // Every OTHER generated file: no bare Node literal anywhere.
    for (const [path, contents] of files) {
      if (path === NODE_SOURCE_FILE || path === 'package.json') continue
      if (path === 'docs/workers-builds.md') continue
      expect(contents, `${path} restates the Node version`).not.toContain(NODE_VERSION)
    }
  })

  it('declares the pnpm version in packageManager and nowhere else', () => {
    const files = generated(visibility)
    const manifest = JSON.parse(files.get('package.json')!) as {
      packageManager: string
      engines: Record<string, string>
      volta: Record<string, string>
    }
    expect(manifest.packageManager).toBe(PACKAGE_MANAGER)
    expect(PACKAGE_MANAGER).toBe(`pnpm@${PNPM_VERSION}`)
    // corepack, pnpm and pnpm/action-setup all read `packageManager` natively,
    // so unlike Node there is nothing that needs an engines/volta mirror.
    expect(manifest.engines.pnpm).toBeUndefined()
    expect(manifest.volta.pnpm).toBeUndefined()

    for (const path of workflowPaths(files)) {
      expect(files.get(path), `${path} restates the pnpm version`).not.toContain(PNPM_VERSION)
    }
  })

  it('makes every workflow READ the Node source rather than restate it', () => {
    const files = generated(visibility)
    const seen: string[] = []
    for (const path of workflowPaths(files)) {
      const doc = parse(files.get(path)!) as {
        jobs: Record<
          string,
          {
            with?: Record<string, unknown>
            steps?: Array<{ uses?: string; with?: Record<string, unknown> }>
          }
        >
      }
      for (const job of Object.values(doc.jobs)) {
        for (const block of [job.with, ...(job.steps ?? []).map((step) => step.with)]) {
          if (!block) continue
          expect(block['node-version'], `${path} pins a Node literal`).toBeUndefined()
          if (block['node-version-file'] !== undefined) {
            expect(block['node-version-file']).toBe(NODE_SOURCE_FILE)
            seen.push(path)
          }
        }
      }
    }
    expect(seen.length).toBeGreaterThan(0)
  })

  it('leaves pnpm/action-setup unpinned so it resolves packageManager itself', () => {
    const files = generated(visibility)
    let found = 0
    for (const path of workflowPaths(files)) {
      const doc = parse(files.get(path)!) as {
        jobs: Record<string, { steps?: Array<{ uses?: string; with?: Record<string, unknown> }> }>
      }
      for (const job of Object.values(doc.jobs)) {
        for (const step of job.steps ?? []) {
          if (!step.uses?.startsWith('pnpm/action-setup@')) continue
          found += 1
          expect(step.with?.version, `${path} pins a pnpm version`).toBeUndefined()
        }
      }
    }
    expect(found).toBeGreaterThan(0)
  })

  it('records the Workers Builds build environment from the same two sources', () => {
    const doc = generated(visibility).get('docs/workers-builds.md')!
    expect(doc).toContain(`| \`NODE_VERSION\`                | \`${NODE_VERSION}\``)
    expect(doc).toContain(`| \`PNPM_VERSION\`                | \`${PNPM_VERSION}\``)
  })
})

describe('the upgrade codemod does not own the Node source', () => {
  it('leaves .node-version unmanaged, because a version is not the generator’s to re-impose', () => {
    expect(MANAGED_TARGETS.some((target) => target.path === NODE_SOURCE_FILE)).toBe(false)
  })

  it('manages copilot-setup-steps.yml, which now carries no version literal at all', () => {
    const target = MANAGED_TARGETS.find(
      (entry) => entry.path === '.github/workflows/copilot-setup-steps.yml',
    )
    expect(target?.mode).toBe('file')
    // Whole-file management is only safe here because the file stopped
    // restating versions: re-applying it can no longer move an app's Node or
    // pnpm version behind its back.
    const contents = generated('private').get('.github/workflows/copilot-setup-steps.yml')!
    expect(contents).not.toContain(NODE_VERSION)
    expect(contents).not.toContain(PNPM_VERSION)
  })
})

/* -------------------------------------------------------------------------- */
/* caller-lint parity                                                          */
/* -------------------------------------------------------------------------- */

const SHA_PIN = /^[0-9a-f]{40}$/u
const USES_LINE = /^\s*(?:-\s*)?uses:\s*(\S+)/u

/**
 * The hygiene rules of the shared workflow's `caller-lint` job, re-implemented
 * from its inline Python so a template change that would fail the live gate
 * fails here first. Kept deliberately literal: concurrency unless the file is
 * `workflow_call`-only, a top-level `permissions:`, a per-job `permissions:`, a
 * per-job `timeout-minutes` unless the job is a reusable-workflow call, and a
 * 40-character SHA on every non-local `uses:`.
 */
function callerLintFindings(path: string, text: string): string[] {
  const findings: string[] = []
  const doc = parse(text) as Record<string, unknown>

  const on = doc.on ?? doc[true as unknown as string]
  const onKeys =
    typeof on === 'string'
      ? [on]
      : Array.isArray(on)
        ? on
        : on && typeof on === 'object'
          ? Object.keys(on)
          : []
  const isCallableOnly = onKeys.length > 0 && onKeys.every((key) => key === 'workflow_call')

  if (!isCallableOnly && doc.concurrency == null) {
    findings.push(`${path}: no workflow-level concurrency: block`)
  }
  if (doc.permissions == null) findings.push(`${path}: no top-level permissions: block`)

  const jobs = (doc.jobs ?? {}) as Record<string, Record<string, unknown>>
  for (const [jobId, job] of Object.entries(jobs)) {
    if (!job || typeof job !== 'object') continue
    if (!('uses' in job) && job['timeout-minutes'] == null) {
      findings.push(`${path}: job '${jobId}' has no timeout-minutes`)
    }
    if (job.permissions == null) findings.push(`${path}: job '${jobId}' has no permissions: block`)
  }

  for (const [index, line] of text.split('\n').entries()) {
    const match = USES_LINE.exec(line)
    if (!match) continue
    const ref = match[1]
    if (ref.startsWith('./') || ref.startsWith('docker://')) continue
    if (!ref.includes('@')) {
      findings.push(`${path}:${index + 1}: \`uses: ${ref}\` has no ref at all`)
      continue
    }
    if (!SHA_PIN.test(ref.split('@').pop()!)) {
      findings.push(`${path}:${index + 1}: \`uses: ${ref}\` is not pinned to a 40-character SHA`)
    }
  }

  return findings
}

describe.each(VISIBILITIES)('%s app: passes the shared workflow caller-lint gate', (visibility) => {
  it('every generated workflow satisfies the audited hygiene rules', () => {
    const files = generated(visibility)
    const paths = workflowPaths(files)
    expect(paths.length).toBeGreaterThan(0)
    const findings = paths.flatMap((path) => callerLintFindings(path, files.get(path)!))
    expect(findings).toEqual([])
  })
})

/* -------------------------------------------------------------------------- */
/* caller-lint's actionlint runner-label rule                                  */
/* -------------------------------------------------------------------------- */

const ACTIONLINT_CONFIG = '.github/actionlint.yaml'

/** Self-hosted labels actionlint knows unconfigured (compared lower-cased). */
const ACTIONLINT_SELF_HOSTED = new Set([
  'self-hosted',
  'linux',
  'macos',
  'windows',
  'x64',
  'arm',
  'arm64',
])
/** GitHub-hosted images; actionlint checks the exact list, this only needs the shape. */
const ACTIONLINT_HOSTED = /^(?:ubuntu|windows|macos)-/iu

/**
 * The workflows actionlint would read: everything in `.github/workflows`, plus
 * the `docs/deployment` templates an app is told to copy there.
 */
function lintedWorkflowPaths(files: Map<string, string>): string[] {
  return [...files.keys()].filter(
    (path) =>
      /^\.github\/workflows\/.+\.ya?ml$/u.test(path) ||
      (/^docs\/deployment\/.+\.ya?ml$/u.test(path) &&
        (parse(files.get(path)!) as Record<string, unknown> | null)?.jobs != null),
  )
}

function runsOnLabels(runsOn: unknown): string[] {
  if (typeof runsOn === 'string') return [runsOn]
  if (Array.isArray(runsOn)) return runsOn.map(String)
  if (runsOn && typeof runsOn === 'object') {
    const labels = (runsOn as { labels?: unknown }).labels
    return labels == null ? [] : runsOnLabels(labels)
  }
  return []
}

function declaredLabels(files: Map<string, string>): Set<string> {
  const config = files.get(ACTIONLINT_CONFIG)
  if (config === undefined) return new Set()
  const doc = parse(config) as { 'self-hosted-runner'?: { labels?: string[] } }
  return new Set((doc['self-hosted-runner']?.labels ?? []).map((label) => label.toLowerCase()))
}

/**
 * actionlint's `runner-label` rule, which `caller-lint` runs over the caller's
 * own workflows: a label that is neither built in nor declared in
 * `.github/actionlint.yaml` is an error (narduk-libs#778, loadtest-dev#4).
 */
function unknownRunnerLabels(path: string, text: string, declared: Set<string>): string[] {
  const jobs = ((parse(text) as { jobs?: unknown } | null)?.jobs ?? {}) as Record<
    string,
    { 'runs-on'?: unknown } | null
  >
  return Object.entries(jobs).flatMap(([jobId, job]) =>
    runsOnLabels(job?.['runs-on'])
      .filter(
        (label) =>
          !label.includes('${{') &&
          !ACTIONLINT_HOSTED.test(label) &&
          !ACTIONLINT_SELF_HOSTED.has(label.toLowerCase()) &&
          !declared.has(label.toLowerCase()),
      )
      .map((label) => `${path}: job '${jobId}': label "${label}" is unknown`),
  )
}

function generatedFor(
  visibility: AppVisibility,
  databaseBackend: 'd1' | 'none',
): Map<string, string> {
  return new Map(
    buildGeneratedFiles({ appName: 'toolchain-fixture', databaseBackend, visibility }).map(
      (file) => [file.path, file.contents],
    ),
  )
}

describe.each(
  VISIBILITIES.flatMap((visibility) =>
    (['d1', 'none'] as const).map((databaseBackend) => ({ databaseBackend, visibility })),
  ),
)('$visibility app, $databaseBackend backend: actionlint knows every runner label', (profile) => {
  it('declares every custom label a workflow names, and no other', () => {
    const files = generatedFor(profile.visibility, profile.databaseBackend)
    const declared = declaredLabels(files)
    const paths = lintedWorkflowPaths(files)

    const findings = paths.flatMap((path) => unknownRunnerLabels(path, files.get(path)!, declared))
    expect(findings).toEqual([])

    // Exactly: nothing declared that no workflow names.
    const named = new Set(
      paths.flatMap((path) =>
        Object.values(
          ((parse(files.get(path)!) as { jobs?: Record<string, { 'runs-on'?: unknown }> }).jobs ??
            {}) as Record<string, { 'runs-on'?: unknown }>,
        ).flatMap((job) => runsOnLabels(job['runs-on']).map((label) => label.toLowerCase())),
      ),
    )
    expect([...declared].filter((label) => !named.has(label))).toEqual([])

    // A public app names no self-hosted label, so it gets no config at all.
    expect(files.has(ACTIONLINT_CONFIG)).toBe(profile.visibility === 'private')
  })
})

describe('the runner-label check itself', () => {
  it('reproduces loadtest-dev#4 without the config', () => {
    const files = generatedFor('private', 'd1')
    const path = '.github/workflows/dependabot-merge.yml'
    expect(unknownRunnerLabels(path, files.get(path)!, new Set())).toEqual([
      `${path}: job 'merge': label "proxmox" is unknown`,
      `${path}: job 'merge': label "linux-ci" is unknown`,
    ])
  })

  it('fails on a label the config does not declare', () => {
    const files = generatedFor('private', 'd1')
    const path = '.github/workflows/dependabot-merge.yml'
    const withGpu = files.get(path)!.replace('linux-ci]', 'linux-ci, gpu-runner]')
    expect(withGpu).not.toBe(files.get(path))
    expect(unknownRunnerLabels(path, withGpu, declaredLabels(files))).toEqual([
      `${path}: job 'merge': label "gpu-runner" is unknown`,
    ])
  })
})
