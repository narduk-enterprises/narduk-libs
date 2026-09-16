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

export async function verifyPackageActionsAccess({ names, token, repository, request = fetch }) {
  if (!token || repository !== 'narduk-enterprises/narduk-libs')
    throw new Error('Package access proof requires the release repository job token')
  for (const name of names) {
    if (!/^@narduk-enterprises\/[a-z0-9-]+$/u.test(name))
      throw new Error(`Unexpected package publication target: ${name}`)
    const response = await request(
      `https://api.github.com/orgs/narduk-enterprises/packages/npm/${encodeURIComponent(name)}`,
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
    if (metadata.name !== name || metadata.package_type !== 'npm')
      throw new Error(`Unexpected GitHub Packages metadata for ${name}`)
  }
  return names.length
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const count = await verifyPackageActionsAccess({
    names: publishedPackageNames(loadWorkspace()),
    token: process.env.GH_TOKEN,
    repository: process.env.GITHUB_REPOSITORY,
  })
  console.log(`Job token read metadata for all ${count} existing publication targets.`)
}
