/**
 * The app-config half of foundation item 10, for apps scaffolded before the
 * generator emitted it (narduk-libs#1228).
 *
 * A new app's `nuxt.config.ts` turns narduk-core's strict nonce CSP on with
 * `nardukCore.security.headers: { enabled: true, enforce: true }`, and its web
 * manifest installs `nuxt-security`, the preset's optional peer. An older app
 * has neither, so it keeps serving the legacy `'unsafe-inline' 'unsafe-eval'`
 * policy with no HSTS, and item 10 fails on every Promote (cloudflarestat-us#7).
 * `upgrade` used to warn and change nothing; these edits close the gap.
 *
 * Both edits are additive. An app that already states `security` or
 * `security.headers` has made its own decision -- a report-only soak, an
 * explicit opt-out -- and is reported, never rewritten.
 */

import {
  isIdentStart,
  readIdentifier,
  skipBlockComment,
  skipLineComment,
  skipQuoted,
  skipWhitespaceAndComments,
} from './checkout-facts.js'

export const CSP_PRESET_HEADERS = 'headers: { enabled: true, enforce: true }'

/**
 * The last narduk-core release whose CSP baseline lacks the estate's PostHog
 * proxy, `https://p.nard.uk`. Enforcing the strict policy on an analytics app
 * running this core or older blocks PostHog without an error anyone sees.
 */
export const LAST_CORE_WITHOUT_PROXY_ORIGIN = '2.19.0'

const CORE_PACKAGE = '@narduk-enterprises/narduk-core'
const ANALYTICS_PACKAGE = '@narduk-enterprises/narduk-analytics'

export interface CspPresetEdit {
  status: 'clean' | 'drift' | 'unresolved'
  detail: string
  contents?: string
}

function closingBrace(source: string, open: number): number | null {
  let depth = 0
  let index = open
  while (index < source.length) {
    const character = source[index] ?? ''
    if (character === '/' && source[index + 1] === '/') {
      index = skipLineComment(source, index)
      continue
    }
    if (character === '/' && source[index + 1] === '*') {
      index = skipBlockComment(source, index)
      continue
    }
    if (character === "'" || character === '"' || character === '`') {
      index = skipQuoted(source, index, character)
      continue
    }
    if (character === '{' || character === '[' || character === '(') depth += 1
    if (character === '}' || character === ']' || character === ')') {
      depth -= 1
      if (depth === 0) return index
    }
    index += 1
  }
  return null
}

/** A direct property of the object literal whose `{` is at `open`. */
function directProperty(
  source: string,
  open: number,
  key: string,
): { keyAt: number; valueAt: number } | null {
  let depth = 0
  let index = open + 1
  while (index < source.length) {
    const character = source[index] ?? ''
    if (character === '/' && source[index + 1] === '/') {
      index = skipLineComment(source, index)
      continue
    }
    if (character === '/' && source[index + 1] === '*') {
      index = skipBlockComment(source, index)
      continue
    }
    if (character === "'" || character === '"' || character === '`') {
      index = skipQuoted(source, index, character)
      continue
    }
    if (character === '{' || character === '[' || character === '(') {
      depth += 1
      index += 1
      continue
    }
    if (character === '}' || character === ']' || character === ')') {
      if (depth === 0) return null
      depth -= 1
      index += 1
      continue
    }
    if (depth === 0 && isIdentStart(character)) {
      const identifier = readIdentifier(source, index)
      const after = skipWhitespaceAndComments(source, index + identifier.length)
      if (identifier === key && source[after] === ':') {
        return { keyAt: index, valueAt: skipWhitespaceAndComments(source, after + 1) }
      }
      index += identifier.length
      continue
    }
    index += 1
  }
  return null
}

/** The `{` of `defineNuxtConfig({ ... })`, outside comments and strings. */
function configObjectOf(source: string): number | null {
  let index = 0
  while (index < source.length) {
    const character = source[index] ?? ''
    if (character === '/' && source[index + 1] === '/') {
      index = skipLineComment(source, index)
      continue
    }
    if (character === '/' && source[index + 1] === '*') {
      index = skipBlockComment(source, index)
      continue
    }
    if (character === "'" || character === '"' || character === '`') {
      index = skipQuoted(source, index, character)
      continue
    }
    if (isIdentStart(character)) {
      const identifier = readIdentifier(source, index)
      if (identifier === 'defineNuxtConfig') {
        const paren = skipWhitespaceAndComments(source, index + identifier.length)
        if (source[paren] === '(') {
          const open = skipWhitespaceAndComments(source, paren + 1)
          return source[open] === '{' ? open : null
        }
      }
      index += identifier.length
      continue
    }
    index += 1
  }
  return null
}

function lineStart(source: string, index: number): number {
  return source.lastIndexOf('\n', index - 1) + 1
}

function indentAt(source: string, index: number): string {
  return /^[ \t]*/u.exec(source.slice(lineStart(source, index)))?.[0] ?? ''
}

/**
 * Adds `lines` as the first properties of the object literal at `open`. A
 * one-line literal (`nardukCore: { databaseBackend: 'none' }`) is expanded to
 * one property per line, the shape Prettier keeps once an object breaks, so
 * the edit passes the app's format check without a reformat.
 */
function insertFirst(source: string, open: number, lines: string[]): string | null {
  const close = closingBrace(source, open)
  if (close === null) return null
  const body = source.slice(open + 1, close)
  if (!body.includes('\n')) {
    const base = indentAt(source, open)
    const inner = base + '  '
    const rest = body.trim().replace(/,$/u, '')
    const block =
      lines.map((line) => inner + line).join('\n') + (rest ? '\n' + inner + rest + ',' : '')
    return source.slice(0, open + 1) + '\n' + block + '\n' + base + source.slice(close)
  }
  const insertAt = source.indexOf('\n', open) + 1
  const lineEnd = source.indexOf('\n', insertAt)
  const nextLine = source.slice(insertAt, lineEnd === -1 ? source.length : lineEnd)
  const indent =
    nextLine.trim() === '' || nextLine.trim().startsWith('}')
      ? indentAt(source, open) + '  '
      : (/^[ \t]*/u.exec(nextLine)?.[0] ?? '  ')
  const block = lines.map((line) => indent + line + '\n').join('')
  return source.slice(0, insertAt) + block + source.slice(insertAt)
}

function literalBoolean(source: string, at: number): boolean | null {
  const match = /^(true|false)\b/u.exec(source.slice(at))
  return match ? match[1] === 'true' : null
}

/** Turn narduk-core's enforced CSP preset on in a Nuxt config that does not state it. */
export function applyCspPreset(source: string): CspPresetEdit {
  const root = configObjectOf(source)
  if (root === null) {
    return {
      detail: 'No `defineNuxtConfig({ ... })` object literal to edit; set ' + manual(),
      status: 'unresolved',
    }
  }
  const core = directProperty(source, root, 'nardukCore')
  if (!core) {
    const next = insertFirst(source, root, [
      'nardukCore: {',
      '  security: {',
      '    ' + CSP_PRESET_HEADERS + ',',
      '  },',
      '},',
    ])
    return added(next, 'Adds `nardukCore.security.headers` (enforced)')
  }
  if (source[core.valueAt] !== '{') {
    return {
      detail: '`nardukCore` is not an object literal; set ' + manual(),
      status: 'unresolved',
    }
  }
  const security = directProperty(source, core.valueAt, 'security')
  if (!security) {
    const next = insertFirst(source, core.valueAt, [
      'security: {',
      '  ' + CSP_PRESET_HEADERS + ',',
      '},',
    ])
    return added(next, 'Adds `nardukCore.security.headers` (enforced)')
  }
  if (source[security.valueAt] !== '{') {
    return {
      detail: '`nardukCore.security` is not an object literal; left to the app. Set ' + manual(),
      status: 'unresolved',
    }
  }
  const headers = directProperty(source, security.valueAt, 'headers')
  if (!headers) {
    const next = insertFirst(source, security.valueAt, [CSP_PRESET_HEADERS + ','])
    return added(next, 'Adds `nardukCore.security.headers` (enforced)')
  }
  if (source[headers.valueAt] === '{') {
    const enabled = directProperty(source, headers.valueAt, 'enabled')
    const enforce = directProperty(source, headers.valueAt, 'enforce')
    if (
      enabled &&
      enforce &&
      literalBoolean(source, enabled.valueAt) === true &&
      literalBoolean(source, enforce.valueAt) === true
    ) {
      return { detail: "narduk-core's CSP preset is enabled and enforced.", status: 'clean' }
    }
  }
  return {
    detail:
      'The app states `nardukCore.security.headers` without `enabled: true, enforce: true` ' +
      '(a report-only soak or an opt-out); left to the app. Item 10 fails until it is enforced.',
    status: 'unresolved',
  }
}

function manual(): string {
  return '`nardukCore.security.headers: { enabled: true, enforce: true }` by hand.'
}

function added(next: string | null, detail: string): CspPresetEdit {
  if (next === null) {
    return {
      detail: 'Could not find the end of the object to edit; set ' + manual(),
      status: 'unresolved',
    }
  }
  return {
    contents: next,
    detail:
      detail +
      '. Enforcing from the next deploy: add any third-party origin the app loads to ' +
      '`security.headers.allow`, then prove it with `narduk-app foundation:check:security-headers`.',
    status: 'drift',
  }
}

function dependencySpec(
  manifests: ReadonlyArray<Record<string, unknown> | null>,
  name: string,
): string | null {
  for (const manifest of manifests) {
    for (const field of ['dependencies', 'devDependencies']) {
      const block = manifest?.[field]
      if (block && typeof block === 'object' && name in block) {
        const value = (block as Record<string, unknown>)[name]
        return typeof value === 'string' ? value : ''
      }
    }
  }
  return null
}

function versionTuple(spec: string): [number, number, number] | null {
  const match = /^[\^~]?(\d+)\.(\d+)\.(\d+)$/u.exec(spec.trim())
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

function atMost(left: [number, number, number], right: [number, number, number]): boolean {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return (left[index] ?? 0) < (right[index] ?? 0)
  }
  return true
}

/**
 * Why enforcing now would break the app's analytics, or null. Only an app that
 * installs narduk-analytics sends to the estate PostHog proxy.
 */
export function proxyOriginProblem(
  manifests: ReadonlyArray<Record<string, unknown> | null>,
): string | null {
  if (dependencySpec(manifests, ANALYTICS_PACKAGE) === null) return null
  const spec = dependencySpec(manifests, CORE_PACKAGE)
  const version = spec === null ? null : versionTuple(spec)
  const floor = versionTuple(LAST_CORE_WITHOUT_PROXY_ORIGIN)
  if (!version || !floor) {
    return (
      'narduk-analytics is installed and narduk-core is not an exact version (' +
      (spec ?? 'absent') +
      '); confirm it is newer than ' +
      LAST_CORE_WITHOUT_PROXY_ORIGIN +
      ' before enforcing, or PostHog through https://p.nard.uk is blocked'
    )
  }
  if (atMost(version, floor)) {
    return (
      'narduk-core ' +
      spec +
      "'s CSP baseline lacks https://p.nard.uk, so enforcing would block PostHog; " +
      'bump narduk-core past ' +
      LAST_CORE_WITHOUT_PROXY_ORIGIN +
      ' first, then re-run upgrade'
    )
  }
  return null
}

/**
 * Adds `name` to a package.json's devDependencies in sorted position, without
 * reformatting the manifest. Present anywhere in dependencies or
 * devDependencies, at any version, is clean: Dependabot owns the version.
 */
export function applyDevDependency(source: string, name: string, version: string): CspPresetEdit {
  let manifest: Record<string, unknown>
  try {
    manifest = JSON.parse(source) as Record<string, unknown>
  } catch {
    return { detail: 'Manifest is not valid JSON; left untouched.', status: 'unresolved' }
  }
  if (dependencySpec([manifest], name) !== null) {
    return { detail: name + ' is installed.', status: 'clean' }
  }
  const byHand = 'add "' + name + '": "' + version + '" to devDependencies by hand.'
  const lines = source.split('\n')
  const header = lines.findIndex((line) => /^\s*"devDependencies":\s*\{\s*$/u.test(line))
  if (header === -1) {
    return { detail: 'No multi-line devDependencies block; ' + byHand, status: 'unresolved' }
  }
  let end = header + 1
  while (end < lines.length && !/^\s*\}/u.test(lines[end] ?? '')) end += 1
  const entries = lines.slice(header + 1, end)
  const indent =
    /^(\s*)"/u.exec(entries[0] ?? '')?.[1] ?? (/^\s*/u.exec(lines[header] ?? '')?.[0] ?? '') + '  '
  const entry = indent + JSON.stringify(name) + ': ' + JSON.stringify(version)
  const before = entries.findIndex((line) => {
    const key = /^\s*"([^"]+)"\s*:/u.exec(line)?.[1]
    return key !== undefined && key > name
  })
  if (before !== -1) {
    lines.splice(header + 1 + before, 0, entry + ',')
  } else if (entries.length) {
    const last = end - 1
    if (!(lines[last] ?? '').trimEnd().endsWith(',')) lines[last] = (lines[last] ?? '') + ','
    lines.splice(end, 0, entry)
  } else {
    lines.splice(end, 0, entry)
  }
  const contents = lines.join('\n')
  let verified: Record<string, unknown> | null = null
  try {
    verified = JSON.parse(contents) as Record<string, unknown>
  } catch {
    verified = null
  }
  const devDependencies = verified?.devDependencies as Record<string, unknown> | undefined
  if (devDependencies?.[name] !== version) {
    return {
      detail: 'Could not add it without reformatting the manifest; ' + byHand,
      status: 'unresolved',
    }
  }
  return {
    contents,
    detail:
      'Adds ' +
      name +
      ' ' +
      version +
      " (narduk-core's CSP preset needs it). Run `pnpm install` so the lockfile matches.",
    status: 'drift',
  }
}
