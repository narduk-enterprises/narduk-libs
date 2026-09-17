// Node 24 strips the generator's types without requiring an install or build in
// the affected-package planner. Use the same manifest factories as the CLI.
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(import.meta.url)

export const consumerSmokeGenerator = '@narduk-enterprises/create-narduk-app'
const capabilities = ['auth', 'seo', 'analytics', 'uploads', 'ai']
const appName = 'narduk-libs-release-smoke'
const port = 3199

export function consumerSmokeManifests(workspace) {
  const generator = workspace.byName.get(consumerSmokeGenerator)
  if (!generator) throw new Error('The workspace is missing the packed app generator.')
  // Resolve its location through pnpm-workspace.yaml, like all package tooling.
  const { createRootPackageManifest, createWebPackageManifest } = require(
    join(generator.directory, 'src', 'manifest.ts'),
  )
  return [
    JSON.parse(createRootPackageManifest(appName, capabilities, 'private')),
    JSON.parse(createWebPackageManifest(appName, capabilities, port)),
  ]
}

export function consumerSmokeGeneratorArgs(targetDirectory) {
  return [
    'exec',
    'create-narduk-app',
    appName,
    '--display-name=Narduk Libs Release Smoke',
    '--description=Tarball-only generated release consumer',
    '--site-url=https://narduk-libs-release-smoke.invalid',
    `--target-dir=${targetDirectory}`,
    `--capabilities=${capabilities.join(',')}`,
    '--visibility=private',
    `--local-dev-port=${port}`,
    '--json',
    '--no-git',
  ]
}

// Include build inputs as well as runtime/peer/optional dependencies. A private
// build helper can change the tarball even though an app never installs it.
const sections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
export function consumerDependencyNames(workspace, manifests = consumerSmokeManifests(workspace)) {
  const names = new Set([consumerSmokeGenerator])
  for (const manifest of manifests) {
    for (const section of sections) {
      for (const name of Object.keys(manifest[section] || {})) {
        if (name.startsWith('@narduk-enterprises/')) names.add(name)
      }
    }
  }
  for (const name of names) {
    const entry = workspace.byName.get(name)
    if (!entry)
      throw new Error(`Generated consumer dependency is missing from the workspace: ${name}`)
    for (const section of sections) {
      for (const dependency of Object.keys(entry.manifest[section] || {})) {
        if (workspace.byName.has(dependency)) names.add(dependency)
      }
    }
  }
  return [...names].sort()
}

export function assertConsumerDependencyScope(workspace, manifests) {
  const expected = new Set(consumerDependencyNames(workspace))
  const unexpected = consumerDependencyNames(workspace, manifests).filter(
    (name) => !expected.has(name),
  )
  if (unexpected.length) {
    throw new Error(
      `Packed generator dependencies differ from the planned fixture: ${unexpected.join(', ')}`,
    )
  }
}
