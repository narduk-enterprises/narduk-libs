import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadWorkspace } from './compute-affected-packages.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const day = 86_400_000
const exactVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u

export function compareVersions(left, right) {
  if (!exactVersion.test(left) || !exactVersion.test(right)) {
    throw new Error(`Expected stable exact versions: ${left}, ${right}`)
  }
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

/** Unknown publication dates, prereleases, deprecated releases and majors never advance a pin. */
export function selectVersion(current, metadata, { now, cooldownDays, limit } = {}) {
  compareVersions(current, current)
  if (!metadata || typeof metadata.versions !== 'object' || !metadata.versions || !metadata.time) {
    throw new Error('Registry metadata must include versions and publication times.')
  }
  if (!Number.isFinite(now) || !Number.isInteger(cooldownDays) || cooldownDays < 0) {
    throw new Error('A valid clock and cooldown are required.')
  }
  const major = current.split('.')[0]
  let selected = current
  for (const [version, manifest] of Object.entries(metadata.versions)) {
    if (!exactVersion.test(version) || version.split('.')[0] !== major) continue
    if (!manifest || typeof manifest !== 'object' || manifest.deprecated) continue
    const published = Date.parse(metadata.time[version])
    if (!Number.isFinite(published) || published > now - cooldownDays * day) continue
    if (limit) {
      const comparison = compareVersions(version, limit.version)
      if (comparison > 0 || (comparison === 0 && !limit.inclusive)) continue
    }
    if (compareVersions(version, selected) > 0) selected = version
  }
  return selected
}

export async function fetchMetadata(name) {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`Registry lookup for ${name} failed: HTTP ${response.status}`)
  return response.json()
}

/** An exact peer is a compatibility contract, even for a patch release. */
export function exactPeerPins(workspace, pins) {
  const held = new Map()
  for (const name of Object.keys(pins).filter((name) => name.startsWith('@narduk-enterprises/'))) {
    const owner = workspace.byName.get(name)
    if (!owner) throw new Error(`Missing workspace package: ${name}`)
    for (const [peer, version] of Object.entries(owner.manifest.peerDependencies ?? {})) {
      if (!pins[peer] || !exactVersion.test(version)) continue
      if (pins[peer] !== version)
        throw new Error(
          `${name} requires ${peer}@${version}, but the generator pins ${pins[peer]}.`,
        )
      held.set(peer, version)
    }
  }
  return held
}

export async function refreshPackagePins(
  pins,
  policy,
  { now = Date.now(), lookup = fetchMetadata, held = new Map() } = {},
) {
  const names = Object.keys(pins).filter(
    (name) => !name.startsWith('@narduk-enterprises/') && !held.has(name),
  )
  const updates = new Map()
  // Bound registry traffic, without serializing each independent lookup.
  for (let offset = 0; offset < names.length; offset += 4) {
    await Promise.all(
      names.slice(offset, offset + 4).map(async (name) => {
        const version = selectVersion(pins[name], await lookup(name), {
          now,
          cooldownDays: policy.DEPENDENCY_COOLDOWN_DAYS,
          limit: policy.DEPENDENCY_UPDATE_LIMITS[name],
        })
        if (version !== pins[name]) updates.set(name, version)
      }),
    )
  }
  return new Map([...updates].sort(([a], [b]) => a.localeCompare(b)))
}

export function rewritePackagePins(source, updates) {
  const start = source.indexOf('export const PACKAGE_VERSIONS = {')
  const end = source.indexOf('\n} as const', start)
  if (start < 0 || end < 0) throw new Error('Could not locate PACKAGE_VERSIONS.')
  let block = source.slice(start, end)
  for (const [name, version] of updates) {
    compareVersions(version, version)
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    const pattern = new RegExp(`^(  (?:'${escaped}'|${escaped}): ')[^']+(',)$`, 'mu')
    if (!pattern.test(block)) throw new Error(`Could not locate exact pin for ${name}.`)
    block = block.replace(pattern, (_, before, after) => `${before}${version}${after}`)
  }
  return source.slice(0, start) + block + source.slice(end)
}

function git(checkout, args) {
  return execFileSync('git', ['-C', checkout, ...args], {
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024,
  }).trim()
}

/** Full ancestry preserves offline upgrade direction checks, including merge parents. */
export function workflowRefresh(checkout, source) {
  if (git(checkout, ['rev-parse', '--is-shallow-repository']) !== 'false') {
    throw new Error('Workflow refresh requires full history (fetch-depth: 0).')
  }
  const current = /export const NUXT_CLOUDFLARE_WORKFLOW_SHA = '([a-f0-9]{40})'/u.exec(source)?.[1]
  if (!current) throw new Error('Could not find the current workflow pin.')
  const latest = git(checkout, ['rev-parse', 'HEAD'])
  if (!/^[a-f0-9]{40}$/u.test(latest)) throw new Error('Invalid workflow HEAD.')
  git(checkout, ['merge-base', '--is-ancestor', current, latest])
  if (latest === current) return null
  const parents = Object.fromEntries(
    git(checkout, ['rev-list', '--reverse', '--topo-order', '--parents', latest])
      .split('\n')
      .map((line) => {
        const [sha, ...ancestors] = line.split(' ')
        return [sha, ancestors]
      }),
  )
  const marker = 'export const NUXT_CLOUDFLARE_WORKFLOW_ANCESTORS = ['
  const end = source.indexOf('\n] as const', source.indexOf(marker))
  if (end < 0) throw new Error('Could not find the previous workflow pins.')
  const updated = source.slice(0, end) + `\n  '${current}',` + source.slice(end)
  return {
    current,
    latest,
    source: updated.replace(`WORKFLOW_SHA = '${current}'`, `WORKFLOW_SHA = '${latest}'`),
    history: `/**
 * Parents of every commit reachable from narduk-enterprises/workflows main at ${latest}.
 * Generated by scripts/refresh-generator-pins.mjs; keeps upgrade filesystem-only.
 */
export const WORKFLOWS_MAIN_PARENTS: Readonly<Record<string, readonly string[]>> = ${JSON.stringify(parents, null, 2)}\n`,
  }
}

export async function refreshGenerator({
  repositoryRoot = root,
  workflowsCheckout,
  now = Date.now(),
  lookup = fetchMetadata,
  check = false,
} = {}) {
  if (!workflowsCheckout)
    throw new Error('--workflows-checkout is required (a fetched workflows main checkout).')
  const workspace = loadWorkspace(repositoryRoot)
  const generator = workspace.byName.get('@narduk-enterprises/create-narduk-app')
  const directory = generator.directory
  const { PACKAGE_VERSIONS } = require(join(directory, 'src/manifest.ts'))
  const policy = require(join(directory, 'src/dependency-policy.ts'))
  const manifestPath = join(directory, 'src/manifest.ts')
  const pinPath = join(directory, 'src/workflow-pin.ts')
  // Finish every network/read/validation operation before writing any source.
  const held = exactPeerPins(workspace, PACKAGE_VERSIONS)
  const updates = await refreshPackagePins(PACKAGE_VERSIONS, policy, { now, lookup, held })
  const manifest = rewritePackagePins(await readFile(manifestPath, 'utf8'), updates)
  const workflow = workflowRefresh(workflowsCheckout, await readFile(pinPath, 'utf8'))
  const lines = [...updates].map(
    ([name, version]) => `- ${name}: ${PACKAGE_VERSIONS[name]} → ${version}`,
  )
  if (workflow) lines.push(`- nuxt-cloudflare workflow: ${workflow.current} → ${workflow.latest}`)
  const heldNote = [...held].map(([name, version]) => `${name}@${version}`).join(', ')
  if (lines.length === 0)
    return {
      changed: false,
      summary: `Generator pins are current for the cooldown and version ceilings. Exact shared-package peers held: ${heldNote || 'none'}.`,
    }
  if (!check) {
    await writeFile(manifestPath, manifest)
    if (workflow) {
      await writeFile(pinPath, workflow.source)
      await writeFile(join(directory, 'src/workflow-history.ts'), workflow.history)
    }
    await mkdir(join(repositoryRoot, '.changeset'), { recursive: true })
    await writeFile(
      join(repositoryRoot, '.changeset/generator-pin-refresh.md'),
      `---\n'@narduk-enterprises/create-narduk-app': patch\n---\n\nRefresh stable same-major dependency pins after a ${policy.DEPENDENCY_COOLDOWN_DAYS}-day cooldown and advance the bundled workflow pin and ancestry.\n\n${lines.join('\n')}\n`,
    )
  }
  return {
    changed: true,
    summary: `${lines.join('\n')}\nExact shared-package peers held: ${heldNote || 'none'}.`,
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  let workflowsCheckout
  let check = false
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--workflows-checkout') workflowsCheckout = args[++index]
    else if (args[index] === '--check') check = true
    else throw new Error(`Unknown argument: ${args[index]}`)
  }
  const result = await refreshGenerator({ workflowsCheckout, check })
  process.stdout.write(`${result.summary}\n`)
  if (check && result.changed) process.exitCode = 1
}
