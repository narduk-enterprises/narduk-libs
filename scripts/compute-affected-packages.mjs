import { spawnSync } from 'node:child_process'
import { appendFileSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { batchPackages, packageGates } from './ci-package-plan.mjs'

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dependencySections = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
]

function toPosix(value) {
  return value.split(sep).join('/')
}

function stripYamlScalar(value) {
  const withoutComment = value.replace(/\s+#.*$/u, '').trim()
  if (
    (withoutComment.startsWith('"') && withoutComment.endsWith('"')) ||
    (withoutComment.startsWith("'") && withoutComment.endsWith("'"))
  ) {
    return withoutComment.slice(1, -1)
  }
  return withoutComment
}

export function readWorkspacePatterns(root) {
  const workspacePath = join(root, 'pnpm-workspace.yaml')
  const lines = readFileSync(workspacePath, 'utf8').split(/\r?\n/u)
  const patterns = []
  let inPackages = false

  for (const line of lines) {
    if (/^packages:\s*(?:#.*)?$/u.test(line)) {
      inPackages = true
      continue
    }
    if (inPackages && /^\S/u.test(line) && line.trim() !== '') break
    if (!inPackages) continue

    const match = line.match(/^\s+-\s+(\S.*)$/u)
    if (!match) continue
    const pattern = stripYamlScalar(match[1])
    if (pattern) patterns.push(pattern)
  }

  if (patterns.length === 0) {
    throw new Error('pnpm-workspace.yaml has no packages entries.')
  }
  return patterns
}

function directoriesForPattern(root, pattern) {
  if (pattern.startsWith('!')) {
    throw new Error(`Unsupported negated workspace pattern: ${pattern}`)
  }

  if (pattern.endsWith('/*')) {
    const parentRelative = pattern.slice(0, -2)
    const parent = resolve(root, parentRelative)
    return readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(parent, entry.name))
  }

  if (pattern.includes('*') || pattern.includes('?') || pattern.includes('[')) {
    throw new Error(`Unsupported workspace glob: ${pattern}`)
  }
  return [resolve(root, pattern)]
}

export function loadWorkspace(root = scriptRoot) {
  const directories = readWorkspacePatterns(root)
    .flatMap((pattern) => directoriesForPattern(root, pattern))
    .filter((directory) => statSync(directory).isDirectory())

  const packages = directories
    .map((directory) => {
      const manifestPath = join(directory, 'package.json')
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      if (!manifest.name) throw new Error(`${manifestPath} has no package name.`)
      return {
        directory,
        relativeDirectory: toPosix(relative(root, directory)),
        manifest,
        name: manifest.name,
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name))

  const byName = new Map(
    packages.map((workspacePackage) => [workspacePackage.name, workspacePackage]),
  )
  if (byName.size !== packages.length) throw new Error('Workspace package names must be unique.')

  const dependents = new Map(packages.map(({ name }) => [name, new Set()]))
  for (const workspacePackage of packages) {
    for (const section of dependencySections) {
      for (const dependencyName of Object.keys(workspacePackage.manifest[section] || {})) {
        if (byName.has(dependencyName)) {
          dependents.get(dependencyName).add(workspacePackage.name)
        }
      }
    }
  }

  return { packages, byName, dependents }
}

function packageForPath(packages, path) {
  return packages
    .filter(
      (workspacePackage) =>
        path === workspacePackage.relativeDirectory ||
        path.startsWith(`${workspacePackage.relativeDirectory}/`),
    )
    .sort((left, right) => right.relativeDirectory.length - left.relativeDirectory.length)[0]
}

function globalTriggerReason(path) {
  if (path === 'package.json') return 'root package.json'
  if (path === 'pnpm-lock.yaml') return 'workspace lockfile'
  if (path === 'pnpm-workspace.yaml') return 'workspace definition'
  if (/^(?:tsconfig(?:\.[^/]+)?\.json|eslint\.config\.[^/]+|turbo\.json)$/u.test(path)) {
    return 'shared TypeScript, ESLint, or build configuration'
  }
  if (/^(?:prettier\.config\.[^/]+|\.prettierrc(?:\.[^/]+)?|\.npmrc|\.node-version)$/u.test(path)) {
    return 'shared repository tooling configuration'
  }
  if (path.startsWith('.github/workflows/')) return 'CI workflow or callable pin'
  if (path.startsWith('.github/actions/')) return 'shared CI action'
  if (path.startsWith('scripts/')) return 'shared repository script'
  if (path.startsWith('tools/')) return 'shared build tooling'
  return undefined
}

function globalTriggerAffectsPackedConsumer(path) {
  return globalTriggerReason(path) !== undefined
}

function isReleaseMetadata(path) {
  return path.startsWith('.changeset/')
}

// Paths that cannot affect any package's build/test/lint/pack output, so a
// diff touching only these (plus release metadata) never needs the package
// matrix. Narrow and explicit on purpose -- do not widen this to cover
// anything a package's own files could plausibly read.
//
// - `docs/**`: nothing under scripts/, .github/workflows/, or any package's
//   package.json reads from the top-level docs/ directory, and workspace
//   packages live under packages/{modules,tooling,design,contracts}/*, never
//   docs/ -- so it is not part of any package's published files and cannot
//   affect `pnpm pack` or any package's own build/test.
// - Root-level `*.md` only (the regex requires no `/`, so it matches
//   README.md/CHANGELOG.md/etc. directly at the repo root, never a package's
//   own packages/<family>/<name>/README.md, which still has a `/` and is
//   still caught by packageForPath first, earlier in the same loop
//   iteration). Root markdown ships in no tarball -- `pnpm pack` packs each
//   workspace package's own directory, never the repo root file tree.
// - `LICENSE` at the repo root, exact match only: not part of any
//   individual package's published contents unless a package explicitly
//   copies it in as part of its own build (none of the four families do
//   this today).
function isInertPath(path) {
  if (path.startsWith('docs/')) return true
  if (/^[^/]+\.md$/u.test(path)) return true
  if (path === 'LICENSE') return true
  return false
}

function isPackageValidationOnly(relativePath) {
  const file = basename(relativePath)
  if (/^(?:README|CHANGELOG)(?:\.[^.]+)?\.md$/iu.test(file)) return true
  if (
    relativePath.split('/').some((segment) => /^(?:tests?|__tests__|fixtures?)$/u.test(segment))
  ) {
    return true
  }
  if (/\.(?:test|spec)\.[^.]+$/u.test(file)) return true
  if (/^(?:vitest|playwright)\.config\.[^.]+$/u.test(file)) return true
  return false
}

function transitiveDependents(changedNames, dependents) {
  const affected = new Set(changedNames)
  const pending = [...changedNames]

  while (pending.length > 0) {
    const dependency = pending.shift()
    for (const dependent of dependents.get(dependency) || []) {
      if (affected.has(dependent)) continue
      affected.add(dependent)
      pending.push(dependent)
    }
  }
  return affected
}

export function computeAffectedSet({ root = scriptRoot, changedFiles, forceAll = false }) {
  const workspace = loadWorkspace(root)
  const normalizedFiles = [...new Set(changedFiles.map((path) => toPosix(path)))].sort()
  const changedNames = new Set()
  const globalReasons = new Set()
  const unclassifiedPaths = []
  let packedConsumer = false

  for (const path of normalizedFiles) {
    const workspacePackage = packageForPath(workspace.packages, path)
    if (workspacePackage) {
      changedNames.add(workspacePackage.name)
      const relativePath = path.slice(workspacePackage.relativeDirectory.length + 1)
      if (!isPackageValidationOnly(relativePath)) packedConsumer = true
      continue
    }

    if (isReleaseMetadata(path)) continue
    if (isInertPath(path)) continue
    const reason = globalTriggerReason(path)
    if (reason) {
      globalReasons.add(`${reason}: ${path}`)
      if (globalTriggerAffectsPackedConsumer(path)) packedConsumer = true
    } else {
      unclassifiedPaths.push(path)
    }
  }

  let fullRun = forceAll || globalReasons.size > 0 || unclassifiedPaths.length > 0
  if (forceAll) {
    globalReasons.add('explicit full run')
    packedConsumer = true
  }
  if (unclassifiedPaths.length > 0) {
    for (const path of unclassifiedPaths) {
      globalReasons.add(`unclassified repository path: ${path}`)
    }
  }

  const affectedNames = fullRun
    ? new Set(workspace.packages.map(({ name }) => name))
    : transitiveDependents(changedNames, workspace.dependents)

  const matrix = workspace.packages
    .filter(({ name }) => affectedNames.has(name))
    .map(({ name }) => ({
      label: name.replace(/^@narduk-enterprises\//u, ''),
      filter: name,
    }))
  if (fullRun && matrix.length === 0) {
    throw new Error('A full run must never produce an empty package matrix.')
  }

  const skippedNames = workspace.packages
    .map(({ name }) => name)
    .filter((name) => !affectedNames.has(name))

  return {
    matrix,
    browserPackages: workspace.packages
      .filter(({ name, manifest }) => affectedNames.has(name) && manifest.scripts?.['test:e2e'])
      .map(({ name }) => name)
      .sort(),
    batches: batchPackages(
      matrix,
      JSON.parse(readFileSync(join(scriptRoot, 'scripts/ci-package-durations.json'), 'utf8'))
        .gateSeconds,
    ),
    packageGates,
    changedNames: [...changedNames].sort(),
    affectedNames: [...affectedNames].sort(),
    skippedNames,
    changedFiles: normalizedFiles,
    fullRun,
    reasons: [...globalReasons].sort(),
    packedConsumer,
  }
}

export function changedFilesBetween(root, base, head) {
  const result = spawnSync('git', ['diff', '--name-only', '-z', `${base}...${head}`], {
    cwd: root,
    encoding: 'utf8',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `git diff ${base}...${head} failed: ${(result.stderr || '').trim() || `exit ${result.status}`}`,
    )
  }
  return result.stdout.split('\0').filter(Boolean)
}

function markdownList(values, emptyLabel = 'None') {
  return values.length > 0 ? values.map((value) => `- \`${value}\``).join('\n') : emptyLabel
}

export function renderSummary(result) {
  const mode = result.fullRun ? 'Full fan-out' : 'Dependency-aware fan-out'
  return [
    '## Affected package plan',
    '',
    `**Mode:** ${mode}`,
    `**Install batches:** ${result.batches.length}; **gates per package:** ${packageGates.join(', ')}`,
    '',
    '### Directly changed packages',
    '',
    markdownList(result.changedNames),
    '',
    '### Selected packages',
    '',
    markdownList(result.affectedNames),
    '',
    '### Packages not scheduled',
    '',
    markdownList(result.skippedNames),
    '',
    '### Full-run reasons',
    '',
    markdownList(result.reasons),
    '',
    `**Packed consumer smoke:** ${result.packedConsumer ? 'required' : 'not applicable'}`,
    '',
  ].join('\n')
}

function parseArguments(argv) {
  const options = {
    root: scriptRoot,
    forceAll: false,
    base: undefined,
    head: undefined,
    githubOutput: undefined,
    summary: undefined,
    jsonOutput: undefined,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--all') {
      options.forceAll = true
      continue
    }
    const next = argv[index + 1]
    if (
      ['--root', '--base', '--head', '--github-output', '--summary', '--json-output'].includes(
        argument,
      )
    ) {
      if (!next) throw new Error(`${argument} requires a value.`)
      const key = {
        '--root': 'root',
        '--base': 'base',
        '--head': 'head',
        '--github-output': 'githubOutput',
        '--summary': 'summary',
        '--json-output': 'jsonOutput',
      }[argument]
      options[key] = argument === '--root' ? resolve(next) : next
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${argument}`)
  }
  return options
}

function main() {
  const options = parseArguments(process.argv.slice(2))
  if (!options.forceAll && (!options.base || !options.head)) {
    throw new Error('Pass --all or both --base and --head.')
  }

  const changedFiles = options.forceAll
    ? []
    : changedFilesBetween(options.root, options.base, options.head)
  const result = computeAffectedSet({
    root: options.root,
    changedFiles,
    forceAll: options.forceAll,
  })

  if (options.githubOutput) {
    appendFileSync(
      options.githubOutput,
      [
        `matrix=${JSON.stringify(result.matrix)}`,
        `batches=${JSON.stringify(result.batches)}`,
        `browser-packages=${JSON.stringify(result.browserPackages)}`,
        `packed-consumer=${result.packedConsumer}`,
        `full-run=${result.fullRun}`,
        `affected-count=${result.affectedNames.length}`,
        '',
      ].join('\n'),
    )
  }
  if (options.summary) writeFileSync(options.summary, renderSummary(result))
  if (options.jsonOutput) writeFileSync(options.jsonOutput, `${JSON.stringify(result, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
