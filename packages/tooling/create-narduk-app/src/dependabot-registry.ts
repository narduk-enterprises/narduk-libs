import { isDisowned, UNMANAGED_MARKER, unmanagedMarkerFor } from './ownership.js'

/**
 * Which registry an existing app actually installs `@narduk-enterprises/*`
 * from. `.npmrc` wins. The lockfile is the fallback when `.npmrc` does not
 * name the scope. `upgrade` must not hand a GitHub Packages app the
 * npm.nard.uk placeholder registry, or the reverse.
 */
export type PackageRegistry = 'github-packages' | 'narduk-mirror' | 'unknown'

export interface DependabotResolution {
  status: 'clean' | 'create' | 'drift' | 'unmanaged' | 'unresolved'
  detail: string
  next?: string
}

interface RegistryEntry {
  url: string
  scope: boolean
}

const PLACEHOLDER_SECRET = 'NPM_NARD_UK_PLACEHOLDER'

export function detectPackageRegistry(
  npmrc: string | null,
  lockfile: string | null,
): PackageRegistry {
  if (npmrc) {
    for (const line of npmrc.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const match = /^@narduk-enterprises:registry\s*=\s*['"]?(\S+?)['"]?\s*$/u.exec(trimmed)
      const url = match?.[1]
      if (!url) continue
      if (url.includes('npm.pkg.github.com')) return 'github-packages'
      if (url.includes('npm.nard.uk')) return 'narduk-mirror'
      return 'unknown'
    }
  }
  const lock = lockfile ?? ''
  const github = lock.includes('npm.pkg.github.com')
  const mirror = lock.includes('npm.nard.uk')
  if (github && !mirror) return 'github-packages'
  if (mirror && !github) return 'narduk-mirror'
  return 'unknown'
}

function uncommented(contents: string): string {
  return contents
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n')
}

/** `default-days: 0`, and `semver-major-days` absent or 0. A missing block is not zero: Dependabot then applies its own default. */
export function hasExplicitZeroCooldown(contents: string): boolean {
  const lines = uncommented(contents).split('\n')
  const start = lines.findIndex((line) => /^[ \t]*cooldown:[ \t]*$/u.test(line))
  if (start === -1) return false
  const indent = /^[ \t]*/u.exec(lines[start] ?? '')?.[0].length ?? 0
  let defaultDays: string | null = null
  let majorDays: string | null = null
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (!line.trim()) continue
    const lineIndent = /^[ \t]*/u.exec(line)?.[0].length ?? 0
    if (lineIndent <= indent) break
    const days = /default-days:\s*(\d+)/u.exec(line)
    if (days?.[1]) defaultDays = days[1]
    const major = /semver-major-days:\s*(\d+)/u.exec(line)
    if (major?.[1]) majorDays = major[1]
  }
  if (defaultDays !== '0') return false
  return majorDays === null || majorDays === '0'
}

/** Registry entries under the top-level `registries:` block. Comments and prose do not count. */
export function registryEntries(contents: string): RegistryEntry[] {
  const entries: RegistryEntry[] = []
  let inRegistries = false
  let current: RegistryEntry | null = null
  for (const line of uncommented(contents).split('\n')) {
    if (!line.trim()) continue
    const indent = /^ */u.exec(line)?.[0].length ?? 0
    if (!inRegistries) {
      if (indent === 0 && line.trim() === 'registries:') inRegistries = true
      continue
    }
    if (indent === 0) break
    if (indent === 2 && /^[ \t]+[\w-]+:[ \t]*$/u.test(line)) {
      if (current) entries.push(current)
      current = { scope: false, url: '' }
      continue
    }
    if (!current) continue
    const url = /url:\s*['"]?(\S+?)['"]?\s*$/u.exec(line)
    if (url?.[1]) current.url = url[1]
    if (/^\s*scope\s*:/u.test(line)) current.scope = true
  }
  if (current) entries.push(current)
  return entries
}

/**
 * A file already pointed at this app's registry, with cooldown held at 0.
 * Rewriting it to the other template is the failure the audits hit: a
 * placeholder `npm.nard.uk` registry on a GitHub Packages app, or a
 * scope-bearing GitHub Packages block on an `npm.nard.uk` app.
 */
export function dependabotMatchesRegistry(contents: string, registry: PackageRegistry): boolean {
  if (registry === 'unknown' || !hasExplicitZeroCooldown(contents)) return false
  const entries = registryEntries(contents)
  if (registry === 'github-packages') {
    return (
      entries.some((entry) => entry.url.includes('npm.pkg.github.com')) &&
      !entries.some((entry) => entry.url.includes('npm.nard.uk')) &&
      !contents.includes(PLACEHOLDER_SECRET)
    )
  }
  return (
    entries.some((entry) => entry.url.includes('npm.nard.uk') && !entry.scope) &&
    !entries.some((entry) => entry.url.includes('npm.pkg.github.com'))
  )
}

/** Two-lane Dependabot file for an app that still installs from GitHub Packages. No placeholder token. */
export function githubPackagesDependabot(): string {
  return [
    'version: 2',
    'registries:',
    '  npm-github:',
    "    type: 'npm-registry'",
    "    url: 'https://npm.pkg.github.com'",
    "    token: '${{secrets.NARDUK_PLATFORM_GH_PACKAGES_READ}}'",
    "    scope: '@narduk-enterprises'",
    'updates:',
    "  - package-ecosystem: 'npm'",
    "    directory: '/'",
    '    registries:',
    "      - 'npm-github'",
    '    schedule:',
    "      interval: 'weekly'",
    "      day: 'monday'",
    "      time: '06:00'",
    "      timezone: 'America/Chicago'",
    '    labels:',
    "      - 'dependencies'",
    '    open-pull-requests-limit: 2',
    '    cooldown:',
    '      default-days: 0',
    '      semver-major-days: 0',
    '    groups:',
    '      safe:',
    '        patterns:',
    "          - '*'",
    "          - '@narduk-enterprises/*'",
    '        update-types:',
    "          - 'minor'",
    "          - 'patch'",
    '      majors:',
    '        patterns:',
    "          - '*'",
    "          - '@narduk-enterprises/*'",
    '        update-types:',
    "          - 'major'",
    "  - package-ecosystem: 'github-actions'",
    "    directory: '/'",
    '    schedule:',
    "      interval: 'weekly'",
    "      day: 'monday'",
    "      time: '06:00'",
    "      timezone: 'America/Chicago'",
    '    labels:',
    "      - 'dependencies'",
    '    open-pull-requests-limit: 1',
    '    groups:',
    '      github-actions:',
    '        patterns:',
    "          - '*'",
    '',
  ].join('\n')
}

export function resolveDependabot(
  current: string | null,
  mirrorTemplate: string,
  registry: PackageRegistry,
): DependabotResolution {
  const desired = registry === 'github-packages' ? githubPackagesDependabot() : mirrorTemplate
  if (desired.includes(PLACEHOLDER_SECRET) && registry === 'github-packages') {
    return {
      detail: 'Refusing to add a placeholder-token registry to a GitHub Packages app.',
      status: 'unresolved',
    }
  }
  if (current === null) {
    return {
      detail:
        'File is missing; upgrade creates it for the ' +
        (registry === 'github-packages' ? 'GitHub Packages' : 'npm.nard.uk') +
        ' registry.',
      next: desired,
      status: 'create',
    }
  }
  if (isDisowned(current)) {
    return {
      detail: 'Disowned by a ' + UNMANAGED_MARKER + ' header comment; left untouched.',
      status: 'unmanaged',
    }
  }
  if (registry !== 'unknown' && dependabotMatchesRegistry(current, registry)) {
    return {
      detail: 'Dependabot already targets the app registry with cooldown 0; left untouched.',
      status: 'clean',
    }
  }
  if (registry === 'unknown') {
    return {
      detail:
        'Could not tell npm.nard.uk from npm.pkg.github.com (.npmrc and lockfile). Left untouched.',
      status: 'clean',
    }
  }
  if (current === desired) {
    return { detail: 'Matches the generator template.', status: 'clean' }
  }
  return {
    detail:
      'Rewrites the file for the ' +
      (registry === 'github-packages' ? 'GitHub Packages' : 'npm.nard.uk') +
      ' registry (' +
      lineDelta(current, desired) +
      '). Add ' +
      unmanagedMarkerFor('.github/dependabot.yml') +
      ' in the first lines to opt out.',
    next: desired,
    status: 'drift',
  }
}

function lineDelta(before: string, after: string): string {
  const count = (value: string): number => value.replace(/\n$/u, '').split('\n').length
  return '+' + count(after) + '/-' + count(before) + ' lines'
}
