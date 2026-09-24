import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadWorkspace } from './compute-affected-packages.mjs'

export function publishedPackageNames(workspace) {
  const names = workspace.packages
    .filter(
      ({ manifest }) =>
        !manifest.private && manifest.publishConfig?.registry === 'https://npm.pkg.github.com',
    )
    .map(({ name }) => name)
  if (!names.length) throw new Error('No GitHub Packages publication targets found')
  return names
}

// A package with no `<name>@<version>` release tag has never been published, so
// GitHub Packages has nothing to show the job token yet: its metadata route is a
// 404 until the first publish creates it. Only released packages can prove the
// grant. The first publish creates the tag, so from then on the package is
// checked like every other (#817 added stylelint-config, which blocked every
// release until this split existed).
export function splitByRelease(names, tags) {
  const released = new Set(tags.map((tag) => tag.slice(0, tag.lastIndexOf('@'))).filter(Boolean))
  return {
    existing: names.filter((name) => released.has(name)),
    firstPublish: names.filter((name) => !released.has(name)),
  }
}

export function releaseTags() {
  return execFileSync('git', ['tag', '--list', '@narduk-enterprises/*@*'], { encoding: 'utf8' })
    .split('\n')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

export async function verifyPackageActionsAccess({ names, token, repository, request = fetch }) {
  if (!token || repository !== 'narduk-enterprises/narduk-libs')
    throw new Error('Package access proof requires the release repository job token')
  for (const name of names) {
    if (!/^@narduk-enterprises\/[a-z0-9-]+$/u.test(name))
      throw new Error(`Unexpected package publication target: ${name}`)
    // GitHub's org route already identifies the npm scope. Its package path
    // and returned metadata use the unscoped package name (e.g. narduk-auth).
    const packageName = name.slice('@narduk-enterprises/'.length)
    const response = await request(
      `https://api.github.com/orgs/narduk-enterprises/packages/npm/${encodeURIComponent(packageName)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    )
    if (!response.ok) throw new Error(`Package job token cannot read ${name} (${response.status})`)
    const metadata = await response.json()
    if (metadata.name !== packageName || metadata.package_type !== 'npm')
      throw new Error(`Unexpected GitHub Packages metadata for ${name}`)
  }
  return names.length
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const tags = releaseTags()
  if (!tags.length)
    throw new Error('No release tags found; fetch tags before verifying package access')
  const { existing, firstPublish } = splitByRelease(publishedPackageNames(loadWorkspace()), tags)
  const count = await verifyPackageActionsAccess({
    names: existing,
    token: process.env.GH_TOKEN,
    repository: process.env.GITHUB_REPOSITORY,
  })
  console.log(`Job token read metadata for all ${count} existing publication targets.`)
  for (const name of firstPublish)
    console.log(`${name} has no release tag yet; its first publish creates the package.`)
}
