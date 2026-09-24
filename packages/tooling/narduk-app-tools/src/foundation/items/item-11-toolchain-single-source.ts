/**
 * Item 11 -- `toolchain-single-source` (Logan, askme 2026-09-17: _"Single-source
 * toolchain versions (Recommended)"_ -- one declared Node/pnpm source per app;
 * every other place either reads it or is checked against it, so a bump is one
 * edit).
 *
 * The two sources, and why they and not the alternatives:
 *
 * - **Node -> `.node-version`.** It is the only Node declaration a GitHub
 *   workflow can *point at* rather than restate (`actions/setup-node`'s
 *   `node-version-file`), and the shared `nuxt-cloudflare.yml` accepts a
 *   `node-version-file` caller input for exactly that reason (workflows#97).
 *   fnm, mise and nodenv read it natively too. Volta cannot: it only ever reads
 *   a `package.json`, which is why `volta.node` stays a checked mirror rather
 *   than becoming the source.
 * - **pnpm -> root `package.json` `packageManager`.** corepack, pnpm itself and
 *   `pnpm/action-setup` (given no `version:` input) all read it natively; the
 *   shared workflow's own pnpm step carries no `version:` and proves the path in
 *   production. There is no dotfile equivalent to prefer over it.
 *
 * Everything else that carries a Node or pnpm literal -- `engines`, `volta`,
 * `.nvmrc`, `.tool-versions`, the two workflow files, and the Workers Builds
 * connection table -- is a MIRROR. A mirror either derives its value from the
 * source (the workflows, via `node-version-file` and an unpinned
 * `pnpm/action-setup`) or is compared against it here.
 *
 * Values are read by parsing; line numbers are a best-effort annotation used by
 * `--fix` and by the printed table. A site whose line cannot be located is still
 * reported and still fails on a mismatch -- it just cannot be auto-fixed.
 */

import { check } from '../schema.js'
import { isRecord, parseJson, PACKAGE_JSON_CANDIDATES, type AppRepo } from '../source.js'
import { STATUS_FAIL, STATUS_NA, STATUS_PASS, STATUS_UNKNOWN } from '../types.js'
import type { FoundationSubCheck, FoundationStatus } from '../types.js'

export const TOOLCHAIN_ITEM_ID = 11
export const TOOLCHAIN_ITEM_NAME = 'toolchain-single-source'

/** The repo-relative path that declares the Node version for the whole app. */
export const NODE_SOURCE_FILE = '.node-version'

/** The manifest key that declares the pnpm version for the whole app. */
export const PNPM_SOURCE_KEY = 'packageManager'

/** The app's own `docs/workers-builds.md`, which records the Cloudflare
 * dashboard's `NODE_VERSION` / `PNPM_VERSION` build environment. The dashboard
 * itself is not readable from a checkout; this table is the repo's record of it,
 * and the generator emits it, so it rots exactly like any other mirror. */
export const WORKERS_BUILDS_DOC = 'docs/workers-builds.md'

/** An exact `x.y.z` (optionally with a prerelease tag). A range is not a
 * declaration -- `^24` pins nothing a second tool could agree with. */
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u

/** `pnpm@10.33.4`, optionally with the corepack integrity hash suffix. */
const PACKAGE_MANAGER_SPEC = /^pnpm@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\+\S+)?$/u

export type Toolchain = 'node' | 'pnpm'

/** One place a Node or pnpm version is written down. */
export interface ToolchainSite {
  /** Repo-relative file. */
  file: string
  /** Human-readable locator, e.g. `engines.node` or `ci.yml caller node-version`. */
  locator: string
  toolchain: Toolchain
  /** The literal found there, or null when the site declares nothing. */
  value: string | null
  /** 1-indexed line, when it could be located. */
  line: number | null
  /** True for the declared source itself rather than a mirror. */
  isSource: boolean
  /** True when the site derives its value from the source instead of restating
   * it -- a `node-version-file:` input, or an unpinned `pnpm/action-setup`. */
  derives: boolean
  /** Set when `--fix` can rewrite this line's literal to the source value. */
  fixable: boolean
  /** False when nothing at this site can read the source: a shared callable
   * whose only Node input is `node-version` (#544). Its literal is still a
   * mirror that must agree, but "use node-version-file" is not an edit the
   * caller can make. Absent means true. */
  derivable?: boolean
}

/* -------------------------------------------------------------------------- */
/* locating                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The 1-indexed line of `"<key>": "<value>"` inside the top-level `"<block>"`
 * object of a Prettier-formatted manifest. Returns null rather than guessing
 * when the block cannot be delimited -- `engines.node` and `volta.node` are the
 * same text, so a whole-file search would report the wrong one.
 */
function lineOfManifestKey(text: string, block: string, key: string): number | null {
  const lines = text.split('\n')
  const opener = new RegExp('^(\\s*)"' + block + '"\\s*:\\s*\\{\\s*$', 'u')
  for (let index = 0; index < lines.length; index += 1) {
    const match = opener.exec(lines[index])
    if (!match) continue
    const closing = new RegExp('^' + match[1] + '\\}', 'u')
    const entry = new RegExp('^\\s*"' + key + '"\\s*:', 'u')
    for (let inner = index + 1; inner < lines.length; inner += 1) {
      if (closing.test(lines[inner])) break
      if (entry.test(lines[inner])) return inner + 1
    }
    return null
  }
  return null
}

/** The 1-indexed line of a top-level `"<key>":` entry. */
function lineOfTopLevelKey(text: string, key: string): number | null {
  const lines = text.split('\n')
  const entry = new RegExp('^\\s{0,2}"' + key + '"\\s*:', 'u')
  for (let index = 0; index < lines.length; index += 1) {
    if (entry.test(lines[index])) return index + 1
  }
  return null
}

/** The 1-indexed line whose text matches, or null. */
function lineMatching(text: string, pattern: RegExp): number | null {
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    if (pattern.test(lines[index])) return index + 1
  }
  return null
}

/* -------------------------------------------------------------------------- */
/* collecting                                                                  */
/* -------------------------------------------------------------------------- */

function manifestVersionSite(
  repo: AppRepo,
  rel: string,
  block: 'engines' | 'volta',
  key: 'node' | 'pnpm',
  toolchain: Toolchain,
): ToolchainSite | null {
  const text = repo.read(rel)
  if (text === null) return null
  const parsed = parseJson(text)
  if (!isRecord(parsed)) return null
  const blockValue = parsed[block]
  if (!isRecord(blockValue)) return null
  const value = blockValue[key]
  if (typeof value !== 'string') return null
  const line = lineOfManifestKey(text, block, key)
  return {
    file: rel,
    locator: `${block}.${key}`,
    toolchain,
    value,
    line,
    isSource: false,
    derives: false,
    fixable: line !== null,
  }
}

/** `.tool-versions` declares `nodejs 24.21.0` (asdf) or `node 24.21.0` (mise). */
function toolVersionsSite(repo: AppRepo): ToolchainSite | null {
  const text = repo.read('.tool-versions')
  if (text === null) return null
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^\s*(?:nodejs|node)\s+(\S+)/u.exec(lines[index])
    if (!match) continue
    return {
      file: '.tool-versions',
      locator: 'node entry',
      toolchain: 'node',
      value: match[1],
      line: index + 1,
      isSource: false,
      derives: false,
      fixable: true,
    }
  }
  return null
}

/** The `| \`NODE_VERSION\` | \`24.21.0\` |` row of the Workers Builds table. */
function workersBuildsSite(
  repo: AppRepo,
  variable: string,
  toolchain: Toolchain,
): ToolchainSite | null {
  const text = repo.read(WORKERS_BUILDS_DOC)
  if (text === null) return null
  const lines = text.split('\n')
  const row = new RegExp('^\\s*\\|\\s*`' + variable + '`\\s*\\|\\s*`([^`]+)`', 'u')
  for (let index = 0; index < lines.length; index += 1) {
    const match = row.exec(lines[index])
    if (!match) continue
    return {
      file: WORKERS_BUILDS_DOC,
      locator: `${variable} row`,
      toolchain,
      value: match[1].trim(),
      line: index + 1,
      isSource: false,
      derives: false,
      fixable: true,
    }
  }
  return null
}

const CALLER_NODE_VERSION_FILE = /^\s*node-version-file:\s*['"]?([^'"\s#]+)/mu
const CALLER_NODE_VERSION = /^\s*node-version:\s*['"]?([^'"\s#]+)/mu
const USES_SHARED_CALLABLE =
  /uses:\s*['"]?narduk-enterprises\/workflows\/\.github\/workflows\/([\w.-]+)\.yml@/u
const USES_SETUP_NODE = /uses:\s*actions\/setup-node@/u
const USES_PNPM_ACTION_SETUP = /uses:\s*pnpm\/action-setup@/u

/**
 * What each `narduk-enterprises/workflows` callable accepts for Node, read
 * from `on.workflow_call.inputs` at workflows `main` 67968e30 (#544):
 *
 * - `node-version-file` as well as `node-version`: the caller can and must read
 *   the source.
 * - `node-version` only: a caller can restate a literal, which must then agree
 *   with the source, but has no way to derive it. Parity is
 *   narduk-enterprises/workflows#135; move a callable to the first set when it
 *   gains the input.
 * - no Node input at all (`cursor-review`, `code-review`, `closing-syntax-check`,
 *   `apple`, `python-data`): the job is not a Node site.
 *
 * A callable in none of these sets is judged by what the caller writes: a
 * `node-version-file` derives, a `node-version` literal restates, and nothing
 * at all is nothing -- an unknown callable is never told to take an input it
 * may not declare, which GitHub rejects.
 */
const CALLABLES_WITH_NODE_VERSION_FILE = new Set(['nuxt-cloudflare'])
const CALLABLES_WITH_NODE_VERSION_ONLY = new Set([
  'docs-governance',
  'node-library',
  'reusable-browser-tests',
  'reusable-node-ci',
])

interface WorkflowJob {
  /** The job's lines, verbatim. */
  lines: string[]
  /** 0-indexed line of the job's first line within the file. */
  offset: number
}

/**
 * The file's jobs, one block each. Evaluating per job rather than per file
 * matters: a `node-version-file` in one job used to satisfy every other Node
 * site in the same file (#544). A file with no recognizable `jobs:` map is one
 * block, which is what the whole-file reading did.
 */
function workflowJobs(text: string): WorkflowJob[] {
  const lines = text.split('\n')
  const jobsLine = lines.findIndex((line) => /^jobs:\s*(?:#.*)?$/u.test(line))
  if (jobsLine === -1) return [{ lines, offset: 0 }]
  const jobs: WorkflowJob[] = []
  let indent: string | null = null
  let current: WorkflowJob | null = null
  for (let index = jobsLine + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^\s*(?:#.*)?$/u.test(line)) {
      current?.lines.push(line)
      continue
    }
    const leading = /^(\s*)/u.exec(line)?.[1] ?? ''
    if (leading.length === 0) break
    indent ??= leading
    if (leading === indent && /^\s*['"]?[\w-]+['"]?:/u.test(line)) {
      current = { lines: [line], offset: index }
      jobs.push(current)
      continue
    }
    current?.lines.push(line)
  }
  return jobs.length > 0 ? jobs : [{ lines, offset: 0 }]
}

function lineInJob(job: WorkflowJob, pattern: RegExp): number | null {
  const line = lineMatching(job.lines.join('\n'), pattern)
  return line === null ? null : line + job.offset
}

function workflowNodeSites(repo: AppRepo): ToolchainSite[] {
  const sites: ToolchainSite[] = []
  for (const name of repo.listWorkflows()) {
    const rel = `.github/workflows/${name}`
    const text = repo.read(rel)
    if (!text) continue
    for (const job of workflowJobs(text)) {
      const body = job.lines.join('\n')
      const callable = USES_SHARED_CALLABLE.exec(body)?.[1]
      if (!callable && !USES_SETUP_NODE.test(body)) continue
      const file = CALLER_NODE_VERSION_FILE.exec(body)
      const literal = CALLER_NODE_VERSION.exec(body)
      const locator = callable ? `${callable}.yml caller` : 'actions/setup-node step'
      const versionOnly = callable !== undefined && CALLABLES_WITH_NODE_VERSION_ONLY.has(callable)
      // Only a `node-version-file` callable can be faulted for passing nothing;
      // any other caller that passes nothing declares nothing.
      if (callable && !CALLABLES_WITH_NODE_VERSION_FILE.has(callable) && !file && !literal) continue
      if (file) {
        sites.push({
          file: rel,
          locator: `${locator} node-version-file`,
          toolchain: 'node',
          value: file[1],
          line: lineInJob(job, CALLER_NODE_VERSION_FILE),
          isSource: false,
          derives: true,
          fixable: false,
        })
        continue
      }
      sites.push({
        file: rel,
        locator: `${locator} node-version`,
        toolchain: 'node',
        value: literal ? literal[1] : null,
        line: literal ? lineInJob(job, CALLER_NODE_VERSION) : null,
        isSource: false,
        derives: false,
        // A structural edit (`node-version:` -> `node-version-file:`), not a value
        // swap: `--fix` deliberately stays out of an app's workflow shape.
        fixable: false,
        ...(versionOnly ? { derivable: false } : {}),
      })
    }
  }
  return sites
}

function workflowPnpmSites(repo: AppRepo): ToolchainSite[] {
  const sites: ToolchainSite[] = []
  for (const name of repo.listWorkflows()) {
    const rel = `.github/workflows/${name}`
    const text = repo.read(rel)
    if (!text || !USES_PNPM_ACTION_SETUP.test(text)) continue
    const lines = text.split('\n')
    // The `version:` belonging to this action, if any: the first `version:` key
    // inside the `with:` block that follows the `uses:` line, before the next
    // step (`- ` at the step's own indentation).
    let found: { value: string; line: number } | null = null
    for (let index = 0; index < lines.length && !found; index += 1) {
      if (!USES_PNPM_ACTION_SETUP.test(lines[index])) continue
      const indent = /^(\s*)-\s/u.exec(lines[index])?.[1] ?? ''
      const nextStep = new RegExp('^' + indent + '-\\s', 'u')
      for (let inner = index + 1; inner < lines.length; inner += 1) {
        if (nextStep.test(lines[inner])) break
        const match = /^\s*version:\s*['"]?([^'"\s#]+)/u.exec(lines[inner])
        if (match) {
          found = { value: match[1], line: inner + 1 }
          break
        }
      }
    }
    sites.push({
      file: rel,
      locator: 'pnpm/action-setup version',
      toolchain: 'pnpm',
      value: found ? found.value : null,
      line: found ? found.line : null,
      isSource: false,
      // No `version:` means the action resolves `packageManager` itself.
      derives: found === null,
      fixable: false,
    })
  }
  return sites
}

export interface ToolchainSources {
  node: { site: ToolchainSite | null; value: string | null }
  pnpm: { site: ToolchainSite | null; value: string | null }
  /** Every manifest at a known monorepo-candidate path that was readable. */
  manifests: string[]
}

export function collectSources(repo: AppRepo): ToolchainSources {
  const manifests = PACKAGE_JSON_CANDIDATES.filter((rel) => isRecord(parseJson(repo.read(rel))))

  const nodeText = repo.read(NODE_SOURCE_FILE)
  const nodeValue = nodeText === null ? null : nodeText.trim()
  const nodeSite: ToolchainSite | null =
    nodeText === null
      ? null
      : {
          file: NODE_SOURCE_FILE,
          locator: 'declared Node source',
          toolchain: 'node',
          value: nodeValue,
          line: 1,
          isSource: true,
          derives: false,
          fixable: false,
        }

  let pnpmSite: ToolchainSite | null = null
  let pnpmValue: string | null = null
  const rootText = repo.read('package.json')
  if (rootText !== null) {
    const parsed = parseJson(rootText)
    const spec = isRecord(parsed) ? parsed[PNPM_SOURCE_KEY] : undefined
    if (typeof spec === 'string') {
      pnpmValue = PACKAGE_MANAGER_SPEC.exec(spec)?.[1] ?? null
      pnpmSite = {
        file: 'package.json',
        locator: `declared pnpm source (${PNPM_SOURCE_KEY})`,
        toolchain: 'pnpm',
        value: spec,
        line: lineOfTopLevelKey(rootText, PNPM_SOURCE_KEY),
        isSource: true,
        derives: false,
        fixable: false,
      }
    }
  }

  return {
    node: { site: nodeSite, value: nodeValue },
    pnpm: { site: pnpmSite, value: pnpmValue },
    manifests,
  }
}

/** Every mirror -- every place carrying a Node or pnpm literal that is not the
 * source itself. Exported so `--fix` and the report share one list. */
export function collectMirrors(repo: AppRepo): ToolchainSite[] {
  const sites: ToolchainSite[] = []
  for (const rel of PACKAGE_JSON_CANDIDATES) {
    for (const [block, key, toolchain] of [
      ['engines', 'node', 'node'],
      ['volta', 'node', 'node'],
      ['engines', 'pnpm', 'pnpm'],
      ['volta', 'pnpm', 'pnpm'],
    ] as const) {
      const site = manifestVersionSite(repo, rel, block, key, toolchain)
      if (site) sites.push(site)
    }
  }
  const nvmrc = repo.read('.nvmrc')
  if (nvmrc !== null) {
    sites.push({
      file: '.nvmrc',
      locator: 'nvm mirror',
      toolchain: 'node',
      value: nvmrc.trim(),
      line: 1,
      isSource: false,
      derives: false,
      fixable: true,
    })
  }
  const toolVersions = toolVersionsSite(repo)
  if (toolVersions) sites.push(toolVersions)
  sites.push(...workflowNodeSites(repo))
  sites.push(...workflowPnpmSites(repo))
  const nodeDoc = workersBuildsSite(repo, 'NODE_VERSION', 'node')
  if (nodeDoc) sites.push(nodeDoc)
  const pnpmDoc = workersBuildsSite(repo, 'PNPM_VERSION', 'pnpm')
  if (pnpmDoc) sites.push(pnpmDoc)
  return sites
}

export interface ToolchainScan {
  sources: ToolchainSources
  mirrors: ToolchainSite[]
}

export function scanToolchain(repo: AppRepo): ToolchainScan {
  return { sources: collectSources(repo), mirrors: collectMirrors(repo) }
}

/* -------------------------------------------------------------------------- */
/* evaluating                                                                  */
/* -------------------------------------------------------------------------- */

function describe(site: ToolchainSite): string {
  const where = site.line === null ? site.file : `${site.file}:${site.line}`
  return `${where} (${site.locator})`
}

function mismatchDetail(sites: ToolchainSite[], expected: string): string {
  return (
    sites.map((site) => `${describe(site)} = ${site.value ?? '(absent)'}`).join('; ') +
    ` -- expected ${expected}`
  )
}

/** 11.0 -- both sources are present and declare an exact version. */
function evaluate110(scan: ToolchainScan): FoundationSubCheck {
  const { node, pnpm } = scan.sources
  const problems: string[] = []
  if (node.site === null) {
    problems.push(`no ${NODE_SOURCE_FILE} -- the declared Node source is missing`)
  } else if (!node.value || !EXACT_VERSION.test(node.value)) {
    problems.push(
      `${NODE_SOURCE_FILE} declares ${JSON.stringify(node.value ?? '')}, which is not an exact x.y.z version`,
    )
  }
  if (pnpm.site === null) {
    problems.push(
      `root package.json has no "${PNPM_SOURCE_KEY}" -- the declared pnpm source is missing`,
    )
  } else if (pnpm.value === null) {
    problems.push(
      `root package.json "${PNPM_SOURCE_KEY}": ${JSON.stringify(pnpm.site.value)} is not an exact pnpm@x.y.z spec`,
    )
  }
  if (problems.length > 0) {
    return check(
      '11.0',
      'one declared source per toolchain',
      STATUS_FAIL,
      problems.join('; '),
      `${NODE_SOURCE_FILE}, package.json`,
    )
  }
  return check(
    '11.0',
    'one declared source per toolchain',
    STATUS_PASS,
    `Node ${node.value} from ${NODE_SOURCE_FILE}; pnpm ${pnpm.value} from package.json "${PNPM_SOURCE_KEY}"`,
    `${NODE_SOURCE_FILE}, package.json`,
  )
}

/** A mirror check over one toolchain's value-restating sites. */
function evaluateMirrors(
  id: string,
  name: string,
  scan: ToolchainScan,
  toolchain: Toolchain,
  expected: string | null,
): FoundationSubCheck {
  const sites = scan.mirrors.filter(
    (site) => site.toolchain === toolchain && !site.derives && site.value !== null,
  )
  if (expected === null) {
    return check(
      id,
      name,
      STATUS_UNKNOWN,
      `no ${toolchain} source to compare ${sites.length} mirror(s) against`,
    )
  }
  if (sites.length === 0) {
    return check(
      id,
      name,
      STATUS_PASS,
      `no ${toolchain} mirror restates a version; the source stands alone`,
    )
  }
  const wrong = sites.filter((site) => site.value !== expected)
  if (wrong.length > 0) {
    return check(
      id,
      name,
      STATUS_FAIL,
      mismatchDetail(wrong, expected),
      wrong.map(describe).join(', '),
    )
  }
  return check(
    id,
    name,
    STATUS_PASS,
    `${sites.length} mirror(s) agree at ${expected}: ${sites.map(describe).join(', ')}`,
  )
}

/** 11.3 -- every workflow resolves Node from the source rather than a literal. */
function evaluate113(scan: ToolchainScan): FoundationSubCheck {
  const sites = scan.mirrors.filter(
    (site) => site.toolchain === 'node' && site.file.startsWith('.github/workflows/'),
  )
  const name = 'CI reads the Node source instead of restating it'
  if (sites.length === 0) {
    return check('11.3', name, STATUS_NA, 'no workflow sets up Node')
  }
  // A `node-version`-only callable cannot read the source; 11.1 still holds its
  // literal to the source value, and workflows#135 is the fix (#544).
  const underivable = sites.filter((site) => site.derivable === false)
  const underivableNote =
    underivable.length > 0
      ? `; not derivable until narduk-enterprises/workflows#135 (checked by 11.1 instead): ${underivable.map(describe).join(', ')}`
      : ''
  const derivable = sites.filter((site) => site.derivable !== false)
  if (derivable.length === 0) {
    return check(
      '11.3',
      name,
      STATUS_NA,
      `no workflow Node site can read ${NODE_SOURCE_FILE}${underivableNote}`,
      underivable.map((site) => site.file).join(', '),
    )
  }
  const restating = derivable.filter((site) => !site.derives)
  if (restating.length > 0) {
    return check(
      '11.3',
      name,
      STATUS_FAIL,
      restating
        .map(
          (site) =>
            `${describe(site)} pins ${site.value ?? '(nothing)'} -- replace with ` +
            `node-version-file: ${NODE_SOURCE_FILE}`,
        )
        .join('; '),
      restating.map((site) => site.file).join(', '),
    )
  }
  const pointingElsewhere = derivable.filter((site) => site.value !== NODE_SOURCE_FILE)
  if (pointingElsewhere.length > 0) {
    return check(
      '11.3',
      name,
      STATUS_FAIL,
      pointingElsewhere
        .map((site) => `${describe(site)} points at ${site.value}, not ${NODE_SOURCE_FILE}`)
        .join('; '),
      pointingElsewhere.map((site) => site.file).join(', '),
    )
  }
  return check(
    '11.3',
    name,
    STATUS_PASS,
    `${derivable.length} workflow step(s) resolve Node via node-version-file: ${NODE_SOURCE_FILE}${underivableNote}`,
    derivable.map((site) => site.file).join(', '),
  )
}

/** 11.4 -- every `pnpm/action-setup` resolves pnpm from `packageManager`. */
function evaluate114(scan: ToolchainScan): FoundationSubCheck {
  const sites = scan.mirrors.filter(
    (site) => site.toolchain === 'pnpm' && site.locator === 'pnpm/action-setup version',
  )
  const name = 'CI reads the pnpm source instead of restating it'
  if (sites.length === 0) {
    return check('11.4', name, STATUS_NA, 'no workflow installs pnpm with pnpm/action-setup')
  }
  const pinned = sites.filter((site) => !site.derives)
  if (pinned.length > 0) {
    return check(
      '11.4',
      name,
      STATUS_FAIL,
      pinned
        .map(
          (site) =>
            `${describe(site)} pins ${site.value} -- drop the \`version:\` input so the action ` +
            `resolves "${PNPM_SOURCE_KEY}" itself`,
        )
        .join('; '),
      pinned.map((site) => site.file).join(', '),
    )
  }
  return check(
    '11.4',
    name,
    STATUS_PASS,
    `${sites.length} pnpm/action-setup step(s) resolve the version from "${PNPM_SOURCE_KEY}"`,
    sites.map((site) => site.file).join(', '),
  )
}

/** 11.5 -- the Workers Builds connection table records the same versions. */
function evaluate115(scan: ToolchainScan): FoundationSubCheck {
  const sites = scan.mirrors.filter((site) => site.file === WORKERS_BUILDS_DOC)
  const name = 'the Workers Builds build environment matches the sources'
  if (sites.length === 0) {
    return check(
      '11.5',
      name,
      STATUS_NA,
      `no ${WORKERS_BUILDS_DOC} NODE_VERSION / PNPM_VERSION row to compare`,
    )
  }
  const wrong = sites.filter((site) => {
    const expected = site.toolchain === 'node' ? scan.sources.node.value : scan.sources.pnpm.value
    return expected !== null && site.value !== expected
  })
  if (wrong.length > 0) {
    return check(
      '11.5',
      name,
      STATUS_FAIL,
      wrong
        .map((site) => {
          const expected =
            site.toolchain === 'node' ? scan.sources.node.value : scan.sources.pnpm.value
          return `${describe(site)} = ${site.value} -- expected ${expected}`
        })
        .join('; ') +
        '. These rows record the Cloudflare dashboard build environment, which no checkout can read;' +
        ' update the dashboard alongside them.',
      WORKERS_BUILDS_DOC,
    )
  }
  return check(
    '11.5',
    name,
    STATUS_PASS,
    `${sites.map(describe).join(', ')} match the declared sources`,
    WORKERS_BUILDS_DOC,
  )
}

export function evaluateItem11(repo: AppRepo, scan = scanToolchain(repo)): FoundationSubCheck[] {
  if (scan.sources.manifests.length === 0) {
    return [
      check(
        '11.0',
        'one declared source per toolchain',
        STATUS_UNKNOWN,
        'no package.json readable at a known monorepo-candidate path, so nothing here is an app checkout to check',
      ),
    ]
  }
  return [
    evaluate110(scan),
    evaluateMirrors(
      '11.1',
      'every Node mirror matches the source',
      scan,
      'node',
      scan.sources.node.value,
    ),
    evaluateMirrors(
      '11.2',
      'every pnpm mirror matches the source',
      scan,
      'pnpm',
      scan.sources.pnpm.value,
    ),
    evaluate113(scan),
    evaluate114(scan),
    evaluate115(scan),
  ]
}

/** The status a whole-item roll-up would give these checks. Exported for the
 * table formatter, which prints a per-site verdict beside each row. */
export function siteStatus(site: ToolchainSite, scan: ToolchainScan): FoundationStatus {
  if (site.isSource) return site.value ? STATUS_PASS : STATUS_FAIL
  if (site.derives) {
    if (site.toolchain === 'pnpm') return STATUS_PASS
    return site.value === NODE_SOURCE_FILE ? STATUS_PASS : STATUS_FAIL
  }
  if (site.value === null) return STATUS_NA
  const expected = site.toolchain === 'node' ? scan.sources.node.value : scan.sources.pnpm.value
  if (expected === null) return STATUS_UNKNOWN
  if (site.file.startsWith('.github/workflows/') && site.derivable !== false) return STATUS_FAIL
  return site.value === expected ? STATUS_PASS : STATUS_FAIL
}
