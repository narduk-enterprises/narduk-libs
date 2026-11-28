#!/usr/bin/env node
/**
 * Deletes old `@narduk-enterprises` versions from GitHub Packages once
 * npm.nard.uk holds them. npm.nard.uk is the archive: its sync keeps every
 * version it ever mirrored, even after GitHub deletes it
 * (package-delivery#51), so installs keep resolving.
 *
 * Per package it keeps every dist-tag target and the newest version, and
 * deletes the rest only when the mirror lists the version with the same
 * sha512 integrity as GitHub and serves its tarball. Anything else is
 * skipped and reported, never deleted. Dry run unless `--apply`.
 *
 * Runs in Actions (.github/workflows/prune-github-packages.yml) with the
 * job's github.token (packages: write). GitHub only lets a workflow delete a
 * package version when its repository has the Admin role on that package.
 *
 * Usage: node scripts/prune-github-packages.mjs [--apply] [--package name ...] [--limit n]
 */

const ORG = 'narduk-enterprises'
const SCOPE = `@${ORG}`
const API = 'https://api.github.com'
const GITHUB_REGISTRY = 'https://npm.pkg.github.com'
const MIRROR = 'https://npm.nard.uk'

/**
 * Pure: decides what to keep and delete for one package.
 * `versions` are GitHub package versions ({ id, name, created_at }).
 */
export function planPackage({
  versions,
  distTags,
  upstreamVersions,
  mirrorVersions,
  mirrorTarballOk,
}) {
  const keep = new Set(Object.values(distTags ?? {}))
  const newest = [...versions].sort((a, b) =>
    String(b.created_at).localeCompare(String(a.created_at)),
  )[0]
  if (newest) keep.add(newest.name)

  const actions = []
  for (const version of versions) {
    if (keep.has(version.name)) {
      actions.push({ ...version, action: 'keep', reason: 'dist-tag or newest' })
      continue
    }
    const upstream = upstreamVersions?.[version.name]?.dist?.integrity
    const mirror = mirrorVersions?.[version.name]?.dist?.integrity
    if (!upstream || !mirror) {
      actions.push({
        ...version,
        action: 'skip',
        reason: upstream ? 'not on npm.nard.uk' : 'no GitHub integrity',
      })
    } else if (upstream !== mirror) {
      actions.push({ ...version, action: 'skip', reason: 'integrity differs on npm.nard.uk' })
    } else if (!mirrorTarballOk(version.name)) {
      actions.push({ ...version, action: 'skip', reason: 'npm.nard.uk tarball not served' })
    } else {
      actions.push({ ...version, action: 'delete', reason: 'archived on npm.nard.uk' })
    }
  }
  if (!actions.some((a) => a.action === 'keep') && actions.length > 0) {
    throw new Error('refusing a plan that keeps no version')
  }
  return actions
}

function parseArgs(argv) {
  const args = { apply: false, packages: [], limit: Infinity }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--apply') args.apply = true
    else if (argv[i] === '--package') args.packages.push(argv[(i += 1)])
    else if (argv[i] === '--limit') args.limit = Number(argv[(i += 1)])
    else throw new Error(`unknown argument ${argv[i]}`)
  }
  return args
}

async function main() {
  const token = process.env.GH_TOKEN
  if (!token) throw new Error('GH_TOKEN is not set')
  const args = parseArgs(process.argv.slice(2))
  const gh = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }

  async function json(url, headers = {}) {
    const response = await fetch(url, { headers })
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
    return response.json()
  }
  async function paged(path) {
    const out = []
    for (let page = 1; ; page += 1) {
      const batch = await json(
        `${API}${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`,
        gh,
      )
      out.push(...batch)
      if (batch.length < 100) return out
    }
  }

  const names = args.packages.length
    ? args.packages
    : (await paged(`/orgs/${ORG}/packages?package_type=npm`)).map((p) => p.name).sort()

  const totals = { keep: 0, delete: 0, skip: 0, deleted: 0, failed: 0 }
  let budget = args.limit
  for (const name of names) {
    try {
      budget = await prunePackage(name, budget)
    } catch (error) {
      totals.failed += 1
      console.log(['PRUNE', name, '-', '-', 'error', error.message, ''].join('\t'))
    }
  }
  console.log(
    `summary: ${JSON.stringify({ apply: args.apply, packages: names.length, ...totals })}`,
  )
  if (totals.failed > 0) process.exitCode = 1

  async function prunePackage(name, budget) {
    const versions = await paged(`/orgs/${ORG}/packages/npm/${name}/versions`)
    const upstream = await json(`${GITHUB_REGISTRY}/${SCOPE}/${name}`, {
      Authorization: `Bearer ${token}`,
    })
    const mirror = await json(`${MIRROR}/${SCOPE}/${name}`)
    const served = new Map()
    for (const v of versions) {
      const response = await fetch(`${MIRROR}/${SCOPE}/${name}/-/${name}-${v.name}.tgz`, {
        method: 'HEAD',
      })
      served.set(v.name, response.ok)
    }
    const plan = planPackage({
      versions,
      distTags: upstream['dist-tags'],
      upstreamVersions: upstream.versions,
      mirrorVersions: mirror.versions,
      mirrorTarballOk: (v) => served.get(v) === true,
    })
    for (const step of plan) {
      totals[step.action] += 1
      let result = ''
      if (step.action === 'delete' && args.apply && budget > 0) {
        budget -= 1
        const response = await fetch(
          `${API}/orgs/${ORG}/packages/npm/${name}/versions/${step.id}`,
          {
            method: 'DELETE',
            headers: gh,
          },
        )
        result = response.status === 204 ? 'deleted' : `failed HTTP ${response.status}`
        totals[response.status === 204 ? 'deleted' : 'failed'] += 1
      }
      console.log(['PRUNE', name, step.name, step.id, step.action, step.reason, result].join('\t'))
    }
    return budget
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
