import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { unifiedDiff } from './diff.js'
import { buildGeneratedFiles } from './generate.js'
import { findTopLevelValue, parseJsoncObject, scanJsonc } from './jsonc.js'
import type { JsoncToken } from './jsonc.js'
import { packageNamesForCapability } from './manifest.js'
import {
  CI_CALLER_PIN_PATTERN,
  CREATE_ONLY_SCRIPT_KEYS,
  isDisowned,
  MANAGED_SCRIPT_KEYS,
  MANAGED_TARGETS,
  REGION_MARKERS,
  UNMANAGED_MARKER,
  unmanagedMarkerFor,
} from './ownership.js'
import { rewriteWorkflowPins, workflowPinMove } from './workflow-pin.js'
import type { ManagedTarget, OwnershipMode, RegionName } from './ownership.js'
import {
  CreateNardukAppError,
  GENERATED_DATABASE_BACKENDS,
  GENERATOR_NAME,
  GENERATOR_VERSION,
  SUPPORTED_CAPABILITIES,
} from './types.js'
import type { AppVisibility, Capability, GeneratedDatabaseBackend, GeneratedFile } from './types.js'

/**
 * `clean`, `unmanaged` and `absent` are notices; `drift`, `create` and
 * `unresolved` are the statuses that make a dry run exit non-zero.
 */
export type UpgradeStatus = 'absent' | 'clean' | 'create' | 'drift' | 'unmanaged' | 'unresolved'

const DRIFT_STATUSES: readonly UpgradeStatus[] = ['create', 'drift', 'unresolved']

export interface UpgradeChange {
  path: string
  mode: OwnershipMode
  unit: string
  status: UpgradeStatus
  detail: string
  /** Unified diff of the proposed change; empty for a notice. */
  diff: string
  /** True only when `--write` actually rewrote the file. */
  applied: boolean
}

export interface UpgradeProfile {
  appName: string
  capabilities: Capability[]
  databaseBackend: GeneratedDatabaseBackend
  localPort: number
  visibility: AppVisibility
  /** Which profile fields were read from the app rather than passed in. */
  inferred: string[]
  /** Anything the inference had to correct or could not read. */
  notes: string[]
}

export interface UpgradeReport {
  schemaVersion: 1
  generator: { name: typeof GENERATOR_NAME; version: typeof GENERATOR_VERSION }
  targetDir: string
  mode: 'dry-run' | 'write'
  profile: UpgradeProfile
  changes: UpgradeChange[]
  summary: Record<UpgradeStatus, number>
  driftCount: number
}

export interface UpgradeNardukAppOptions {
  targetDir: string
  /** Apply the changes. Dry run (report only) when false or omitted. */
  write?: boolean
  /** Exact managed paths to consider; empty or omitted means all of them. */
  only?: readonly string[]
  capabilities?: readonly string[] | string
  databaseBackend?: GeneratedDatabaseBackend
  localPort?: number
  visibility?: AppVisibility
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function parseJsonOrNull(contents: string | null): Record<string, unknown> | null {
  if (contents === null) return null
  try {
    const parsed: unknown = JSON.parse(contents)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function nardukBlock(manifest: Record<string, unknown> | null): Record<string, unknown> {
  const block = manifest?.narduk
  return block && typeof block === 'object' ? (block as Record<string, unknown>) : {}
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

function capabilitiesFromDependencies(manifest: Record<string, unknown> | null): Capability[] {
  const installed = new Set([
    ...Object.keys((manifest?.dependencies as Record<string, string>) ?? {}),
    ...Object.keys((manifest?.devDependencies as Record<string, string>) ?? {}),
  ])
  // Only our own packages identify a capability. The seo list also pins the
  // third-party nuxt-og-image peer (narduk-libs#825), and an app that installs
  // that package without narduk-seo is not an seo app.
  return SUPPORTED_CAPABILITIES.filter((capability) =>
    packageNamesForCapability(capability).some(
      (name) => name.startsWith('@narduk-enterprises/') && installed.has(name),
    ),
  )
}

/**
 * Reconstructs the generator options from the app itself, so an existing app
 * needs no adoption step and no new descriptor file. Every field is
 * overridable; the resolved profile is reported so a wrong reading is visible
 * before `--write`.
 */
export async function inferUpgradeProfile(
  targetDir: string,
  overrides: Pick<
    UpgradeNardukAppOptions,
    'capabilities' | 'databaseBackend' | 'localPort' | 'visibility'
  > = {},
): Promise<UpgradeProfile> {
  const inferred: string[] = []
  const notes: string[] = []
  const rootManifest = parseJsonOrNull(await readIfExists(resolve(targetDir, 'package.json')))
  const webManifest = parseJsonOrNull(
    await readIfExists(resolve(targetDir, 'apps/web/package.json')),
  )
  const nuxtConfig = (await readIfExists(resolve(targetDir, 'apps/web/nuxt.config.ts'))) ?? ''

  const appName =
    (typeof rootManifest?.name === 'string' && rootManifest.name) ||
    resolve(targetDir).split('/').pop() ||
    'app'
  if (typeof rootManifest?.name !== 'string') {
    notes.push('No root package.json name; used the directory name "' + appName + '".')
  }
  inferred.push('appName')

  let capabilities: Capability[]
  if (overrides.capabilities === undefined) {
    const declared = [
      ...stringList(nardukBlock(rootManifest).capabilities),
      ...stringList(nardukBlock(webManifest).capabilities),
    ]
    capabilities = declared.length
      ? SUPPORTED_CAPABILITIES.filter((capability) => declared.includes(capability))
      : capabilitiesFromDependencies(webManifest)
    inferred.push('capabilities')
  } else {
    const requested =
      typeof overrides.capabilities === 'string'
        ? overrides.capabilities.split(',')
        : [...overrides.capabilities]
    const normalized = requested.map((entry) => entry.trim()).filter(Boolean)
    for (const entry of normalized) {
      if (!(SUPPORTED_CAPABILITIES as readonly string[]).includes(entry)) {
        throw new CreateNardukAppError('Unsupported capability "' + entry + '".')
      }
    }
    capabilities = SUPPORTED_CAPABILITIES.filter((capability) => normalized.includes(capability))
  }

  let databaseBackend: GeneratedDatabaseBackend
  if (overrides.databaseBackend === undefined) {
    databaseBackend = /databaseBackend:\s*'none'/u.test(nuxtConfig) ? 'none' : 'd1'
    inferred.push('databaseBackend')
  } else {
    if (!(GENERATED_DATABASE_BACKENDS as readonly string[]).includes(overrides.databaseBackend)) {
      throw new CreateNardukAppError(
        'databaseBackend must be ' + GENERATED_DATABASE_BACKENDS.join(' or ') + '.',
      )
    }
    databaseBackend = overrides.databaseBackend
  }

  // The generator refuses auth without a database, because auth stores its
  // users and sessions there. An app that reads as both is telling us one of
  // the two readings is wrong -- say so and keep going on the database, which
  // is read from an explicit declaration rather than from a dependency list.
  if (databaseBackend === 'none' && capabilities.includes('auth')) {
    capabilities = capabilities.filter((capability) => capability !== 'auth')
    notes.push(
      "Dropped the auth capability: the app declares databaseBackend 'none', which auth cannot use. No managed unit depends on the capability list; pass --capabilities to override.",
    )
  }

  let localPort: number
  if (overrides.localPort === undefined) {
    const declared = nardukBlock(webManifest).localDevNuxtPort
    localPort = typeof declared === 'number' && Number.isInteger(declared) ? declared : 3000
    inferred.push('localPort')
  } else {
    if (!Number.isInteger(overrides.localPort)) {
      throw new CreateNardukAppError('localPort must be an integer.')
    }
    localPort = overrides.localPort
  }

  let visibility: AppVisibility
  if (overrides.visibility === undefined) {
    const declared = nardukBlock(rootManifest).visibility
    visibility = declared === 'public' ? 'public' : 'private'
    inferred.push('visibility')
  } else {
    visibility = overrides.visibility
  }

  return { appName, capabilities, databaseBackend, inferred, localPort, notes, visibility }
}

function generatedContentsFor(profile: UpgradeProfile, targetDir: string): Map<string, string> {
  const files: GeneratedFile[] = buildGeneratedFiles({
    appName: profile.appName,
    capabilities: profile.capabilities,
    databaseBackend: profile.databaseBackend,
    localPort: profile.localPort,
    targetDir,
    visibility: profile.visibility,
  })
  return new Map(files.map((file) => [file.path, file.contents]))
}

interface Resolution {
  status: UpgradeStatus
  detail: string
  next?: string
}

function regionOf(contents: string, markers: { start: string; end: string }): string | null {
  const start = contents.indexOf(markers.start)
  if (start === -1) return null
  const end = contents.indexOf(markers.end, start + markers.start.length)
  if (end === -1) return null
  return contents.slice(start + markers.start.length, end)
}

function replaceRegion(
  contents: string,
  markers: { start: string; end: string },
  replacement: string,
): string {
  const start = contents.indexOf(markers.start)
  const end = contents.indexOf(markers.end, start + markers.start.length)
  return contents.slice(0, start + markers.start.length) + replacement + contents.slice(end)
}

/**
 * Line counts, so a whole-file rewrite that would delete a lot of app-written
 * content is legible in the one-line summary and not only in the diff body.
 */
function lineDelta(before: string, after: string): string {
  const count = (value: string): number => value.replace(/\n$/u, '').split('\n').length
  return '+' + count(after) + '/-' + count(before) + ' lines'
}

function resolveFile(current: string | null, desired: string, path: string): Resolution {
  if (current === null) {
    return { detail: 'File is missing; upgrade creates it.', next: desired, status: 'create' }
  }
  if (isDisowned(current)) {
    return {
      detail: 'Disowned by a ' + UNMANAGED_MARKER + ' header comment; left untouched.',
      status: 'unmanaged',
    }
  }
  if (current === desired) return { detail: 'Matches the generator template.', status: 'clean' }
  return {
    detail:
      'Rewrites the whole file (' +
      lineDelta(current, desired) +
      '). Add ' +
      unmanagedMarkerFor(path) +
      ' in the first lines to opt out.',
    next: desired,
    status: 'drift',
  }
}

function resolvePin(current: string | null, desired: string): Resolution {
  if (current === null) {
    return {
      detail: 'File is absent. Its inputs are app-owned, so upgrade does not create it.',
      status: 'absent',
    }
  }
  if (isDisowned(current)) {
    return {
      detail: 'Disowned by a ' + UNMANAGED_MARKER + ' header comment; left untouched.',
      status: 'unmanaged',
    }
  }
  const desiredPin = CI_CALLER_PIN_PATTERN.exec(desired)?.[0]
  if (!desiredPin) {
    return {
      detail: 'The generator template no longer contains a shared-workflow caller pin.',
      status: 'unresolved',
    }
  }
  const pattern = new RegExp(CI_CALLER_PIN_PATTERN.source, 'gu')
  const found = current.match(pattern)
  if (!found) {
    return {
      detail:
        'No narduk-enterprises/workflows nuxt-cloudflare caller found; this app does not call the shared workflow.',
      status: 'absent',
    }
  }
  const desiredSha = desiredPin.split('@')[1] ?? ''
  if (found.every((match) => match === desiredPin)) {
    return { detail: 'Pinned at ' + desiredSha + '.', status: 'clean' }
  }
  const currentShas = [...new Set(found.map((match) => match.split('@')[1] ?? ''))]
  const moves = currentShas.map((sha) => workflowPinMove(sha, desiredSha))
  if (moves.includes('refuse')) {
    return {
      detail:
        'App pin ' +
        (currentShas.find((sha) => workflowPinMove(sha, desiredSha) === 'refuse') ?? desiredSha) +
        ' is not an older pin this generator shipped, so upgrade will not move it. A newer workflows SHA stays where the app put it.',
      status: 'clean',
    }
  }
  return {
    detail: 'Re-pins the shared workflow to ' + desiredSha + '.',
    next: rewriteWorkflowPins(current, desiredSha),
    status: 'drift',
  }
}

function resolveRegion(
  current: string | null,
  desired: string,
  region: RegionName | undefined,
  path: string,
  insertWhenMissing = false,
): Resolution {
  if (!region) {
    return { detail: 'Managed target declares no region markers.', status: 'unresolved' }
  }
  const markers = REGION_MARKERS[region]
  if (current === null) {
    return {
      detail: 'File is absent. Its prose is app-owned, so upgrade does not create it.',
      status: 'absent',
    }
  }
  if (isDisowned(current)) {
    return {
      detail: 'Disowned by a ' + UNMANAGED_MARKER + ' header comment; left untouched.',
      status: 'unmanaged',
    }
  }
  const desiredRegion = regionOf(desired, markers)
  if (desiredRegion === null) {
    return {
      detail: 'The generator template no longer contains the ' + markers.start + ' region.',
      status: 'unresolved',
    }
  }
  const currentRegion = regionOf(current, markers)
  if (currentRegion === null && insertWhenMissing) {
    // One marker without its partner is a hand edit this cannot interpret.
    if (current.includes(markers.start) || current.includes(markers.end)) {
      return {
        detail:
          'The ' +
          markers.start +
          ' / ' +
          markers.end +
          ' pair is incomplete or out of order. Fix it by hand; left untouched.',
        status: 'unresolved',
      }
    }
    return {
      detail:
        'No ' +
        markers.start +
        ' block. Appends it at the end of the file; the rest of the file is untouched. Opt out with a ' +
        unmanagedMarkerFor(path) +
        ' header.',
      next:
        current.replace(/\s*$/u, '') + '\n\n' + markers.start + desiredRegion + markers.end + '\n',
      status: 'drift',
    }
  }
  if (currentRegion === null) {
    return {
      detail:
        'No ' +
        markers.start +
        ' / ' +
        markers.end +
        ' markers. Add them around the block they name to opt it in.',
      status: 'unmanaged',
    }
  }
  if (currentRegion === desiredRegion) {
    return { detail: 'Router block matches the generator template.', status: 'clean' }
  }
  return {
    detail: 'Refreshes the router block between the markers; the rest of the file is untouched.',
    next: replaceRegion(current, markers, desiredRegion),
    status: 'drift',
  }
}

function scriptsBlockRange(lines: readonly string[]): { start: number; end: number } | null {
  const start = lines.findIndex((line) => /^\s*"scripts"\s*:\s*\{\s*$/u.test(line))
  if (start === -1) return null
  const indent = /^(\s*)/u.exec(lines[start] as string)?.[1] ?? ''
  // Prettier-formatted JSON closes the object on its own line at the key's own
  // indentation. Matching that, rather than counting braces, keeps a script
  // body such as `${VAR:-}` from being read as nesting.
  const closing = new RegExp('^' + indent + '\\},?\\s*$', 'u')
  for (let index = start + 1; index < lines.length; index += 1) {
    if (closing.test(lines[index] as string)) return { end: index, start }
  }
  return null
}

function deepEqualIgnoringScripts(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  ignored: readonly string[],
): boolean {
  const strip = (manifest: Record<string, unknown>): string => {
    const scripts = { ...((manifest.scripts as Record<string, string>) ?? {}) }
    for (const key of ignored) delete scripts[key]
    return JSON.stringify({ ...manifest, scripts })
  }
  return strip(before) === strip(after)
}

interface ScriptEntry {
  from: number
  to: number
  value: string
  hasComma: boolean
}

/**
 * Locates one `"key": "value"` entry inside a Prettier-formatted JSON object,
 * spanning however many lines Prettier wrapped it across. The span is found by
 * growing the candidate text until it parses as a one-key object, so a wrapped
 * body -- `foundation:check` is wrapped in the generator's own manifest -- is
 * matched exactly rather than guessed at from its shape.
 */
function findScriptEntry(
  lines: readonly string[],
  range: { start: number; end: number },
  key: string,
): ScriptEntry | null {
  const opener = new RegExp('^\\s*"' + key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&') + '"\\s*:', 'u')
  for (let from = range.start + 1; from < range.end; from += 1) {
    if (!opener.test(lines[from] as string)) continue
    let text = ''
    for (let to = from; to < range.end; to += 1) {
      text += lines[to]
      const hasComma = /,\s*$/u.test(text)
      try {
        const parsed: unknown = JSON.parse('{' + text.replace(/,\s*$/u, '') + '}')
        const value = (parsed as Record<string, unknown>)[key]
        if (typeof value === 'string') return { from, hasComma, to, value }
      } catch {
        // Not a complete entry yet; keep absorbing wrapped lines.
      }
    }
    return null
  }
  return null
}

function leadingIndent(line: string): string {
  return /^(\s*)/u.exec(line)?.[1] ?? ''
}

/** Re-indents a rendered entry from the generator's manifest to the app's. */
function reindent(block: readonly string[], fromIndent: string, toIndent: string): string[] | null {
  if (fromIndent === toIndent) return [...block]
  if (fromIndent.length > toIndent.length) {
    const strip = fromIndent.slice(0, fromIndent.length - toIndent.length)
    if (!block.every((line) => line.startsWith(strip))) return null
    return block.map((line) => line.slice(strip.length))
  }
  const pad = toIndent.slice(0, toIndent.length - fromIndent.length)
  return block.map((line) => pad + line)
}

/**
 * Rewrites only the named script entries, in place, by splicing in the exact
 * lines the generator's own Prettier-canonical manifest renders for them. A
 * whole-manifest `JSON.stringify` round trip would reformat and reorder an
 * app's own manifest, which is exactly the app-owned content upgrade must not
 * touch; re-rendering the value by hand would risk a shape the app's own
 * `format:check` then rejects.
 */
function applyScriptKeys(
  source: string,
  desired: string,
  keys: readonly string[],
): { contents: string; unresolved: string[] } {
  const desiredLines = desired.split('\n')
  const desiredRange = scriptsBlockRange(desiredLines)
  const sourceLines = source.split('\n')
  const sourceRange = scriptsBlockRange(sourceLines)
  if (!desiredRange || !sourceRange) return { contents: source, unresolved: [...keys] }

  const blockIndent = leadingIndent(sourceLines[sourceRange.start] as string)
  const entryIndent =
    sourceRange.end > sourceRange.start + 1
      ? leadingIndent(sourceLines[sourceRange.start + 1] as string)
      : blockIndent + '  '

  const unresolved: string[] = []
  const next = [...sourceLines]
  let shift = 0
  for (const key of keys) {
    const desiredEntry = findScriptEntry(desiredLines, desiredRange, key)
    if (!desiredEntry) {
      unresolved.push(key)
      continue
    }
    const rendered = desiredLines.slice(desiredEntry.from, desiredEntry.to + 1)
    const range = { end: sourceRange.end + shift, start: sourceRange.start + shift }
    const existing = findScriptEntry(next, range, key)
    const block = reindent(
      rendered,
      leadingIndent(rendered[0] as string),
      existing ? leadingIndent(next[existing.from] as string) : entryIndent,
    )
    if (!block) {
      unresolved.push(key)
      continue
    }
    const last = block.length - 1
    const wantsComma = existing ? existing.hasComma : true
    block[last] = (block[last] as string).replace(/,\s*$/u, '') + (wantsComma ? ',' : '')

    if (existing) {
      next.splice(existing.from, existing.to - existing.from + 1, ...block)
      shift += block.length - (existing.to - existing.from + 1)
    } else {
      next.splice(range.start + 1, 0, ...block)
      shift += block.length
    }
  }
  return { contents: next.join('\n'), unresolved }
}

function cacheEnabledFlag(config: Record<string, unknown>): boolean | undefined {
  const cache = config.cache
  if (!cache || typeof cache !== 'object' || Array.isArray(cache)) return undefined
  const enabled = (cache as Record<string, unknown>).enabled
  if (enabled === true) return true
  if (enabled === false) return false
  return undefined
}

/**
 * The config with `cache.enabled` removed -- and `cache` itself when nothing
 * else is in it -- so a before/after comparison proves the edit wrote that
 * one key and nothing else, a sibling such as `cache.cross_version_cache`
 * included.
 */
function withoutCacheEnabled(config: Record<string, unknown>): string {
  const copy: Record<string, unknown> = { ...config }
  const cache = copy.cache
  if (cache && typeof cache === 'object' && !Array.isArray(cache)) {
    const rest: Record<string, unknown> = { ...(cache as Record<string, unknown>) }
    delete rest.enabled
    if (Object.keys(rest).length > 0) copy.cache = rest
    else delete copy.cache
  } else {
    delete copy.cache
  }
  return JSON.stringify(copy)
}

const WORKERS_CACHE_VALUE = '{ "enabled": true }'

function lineStartOf(text: string, offset: number): number {
  return text.lastIndexOf('\n', offset - 1) + 1
}

/**
 * Inserts or replaces the top-level `cache` property in place. A stringify
 * round trip would drop comments and reorder bindings, which are app-owned
 * (narduk-libs#672). Offsets come from a string-aware scan, so a `/*` or
 * `//` inside a string value is never mistaken for a comment, and a comma
 * added after the last property lands before any trailing `// comment`.
 */
function applyWorkersCacheKey(source: string): { contents: string; unresolved: boolean } {
  const { tokens } = scanJsonc(source)
  const existing = findTopLevelValue(tokens, 'cache')
  if (existing) {
    return {
      contents: source.slice(0, existing.start) + WORKERS_CACHE_VALUE + source.slice(existing.end),
      unresolved: false,
    }
  }
  const open = tokens[0]
  const close = tokens.at(-1)
  const last = tokens.at(-2)
  if (open?.text !== '{' || close?.text !== '}' || !last) {
    return { contents: source, unresolved: true }
  }
  // The new property goes on its own line just above the closing brace, so
  // that brace must be alone on its line.
  const closeLine = lineStartOf(source, close.start)
  if (closeLine <= open.start || source.slice(closeLine, close.start).trim() !== '') {
    return { contents: source, unresolved: true }
  }
  const first = tokens[1] as JsoncToken
  const firstLine = lineStartOf(source, first.start)
  const indent =
    first !== close && firstLine > open.start
      ? leadingIndent(source.slice(firstLine, first.start))
      : leadingIndent(source.slice(closeLine)) + '  '
  // Match the file's style: a trailing comma on the new property only when
  // the old last property had one.
  const trailingComma = last.text === ','
  const needsSeparator = !trailingComma && last !== open
  const property = indent + '"cache": ' + WORKERS_CACHE_VALUE + (trailingComma ? ',' : '') + '\n'
  const contents =
    source.slice(0, last.end) +
    (needsSeparator ? ',' : '') +
    source.slice(last.end, closeLine) +
    property +
    source.slice(closeLine)
  return { contents, unresolved: false }
}

function resolveJsoncKeys(
  current: string | null,
  desired: string,
  target: ManagedTarget,
): Resolution {
  if (current === null) {
    return {
      detail:
        'File is absent. Upgrade edits named JSONC keys; it does not create a wrangler config.',
      status: 'absent',
    }
  }
  if (isDisowned(current)) {
    return {
      detail: 'Disowned by a ' + UNMANAGED_MARKER + ' header comment; left untouched.',
      status: 'unmanaged',
    }
  }
  const currentConfig = parseJsoncObject(current)
  const desiredConfig = parseJsoncObject(desired)
  if (!currentConfig || !desiredConfig) {
    return { detail: 'Wrangler config is not valid JSONC; left untouched.', status: 'unresolved' }
  }
  if (!(target.jsonKeys ?? []).includes('cache')) {
    return { detail: 'Managed target declares no JSONC keys.', status: 'unresolved' }
  }
  const desiredCache = desiredConfig.cache
  if (
    !desiredCache ||
    typeof desiredCache !== 'object' ||
    Array.isArray(desiredCache) ||
    (desiredCache as Record<string, unknown>).enabled !== true
  ) {
    return {
      detail: 'The generator template no longer enables Workers Cache.',
      status: 'unresolved',
    }
  }
  const flag = cacheEnabledFlag(currentConfig)
  if (flag === true) {
    return { detail: 'Workers Cache is enabled.', status: 'clean' }
  }
  if (flag === false) {
    return { detail: 'App set cache.enabled false; left untouched.', status: 'clean' }
  }
  const applied = applyWorkersCacheKey(current)
  if (applied.unresolved) {
    return {
      detail: 'Could not insert cache.enabled without reformatting wrangler.jsonc; left untouched.',
      status: 'unresolved',
    }
  }
  const verified = parseJsoncObject(applied.contents)
  if (
    !verified ||
    cacheEnabledFlag(verified) !== true ||
    withoutCacheEnabled(verified) !== withoutCacheEnabled(currentConfig)
  ) {
    return {
      detail: 'Refusing to write: the edit would have changed app-owned wrangler content.',
      status: 'unresolved',
    }
  }
  return {
    detail: 'Adds cache.enabled; every other key is untouched.',
    next: applied.contents,
    status: 'drift',
  }
}

function resolveKeys(current: string | null, desired: string): Resolution {
  if (current === null) {
    return {
      detail: 'File is absent. Upgrade edits named scripts; it does not create a manifest.',
      status: 'absent',
    }
  }
  const currentManifest = parseJsonOrNull(current)
  const desiredManifest = parseJsonOrNull(desired)
  if (!currentManifest || !desiredManifest) {
    return { detail: 'Manifest is not valid JSON; left untouched.', status: 'unresolved' }
  }
  const currentScripts = (currentManifest.scripts as Record<string, string>) ?? {}
  const desiredScripts = (desiredManifest.scripts as Record<string, string>) ?? {}
  const updates = new Map<string, string>()
  for (const key of MANAGED_SCRIPT_KEYS) {
    const value = desiredScripts[key]
    // A key the generator does not emit for this profile -- the migrate
    // scripts of a database-less app -- is not managed, and is never removed.
    if (typeof value !== 'string') continue
    const present = currentScripts[key]
    if (CREATE_ONLY_SCRIPT_KEYS.has(key) && typeof present === 'string' && present.trim()) continue
    if (present !== value) updates.set(key, value)
  }
  if (updates.size === 0) {
    return { detail: 'Contract scripts match the generator template.', status: 'clean' }
  }

  const applied = applyScriptKeys(current, desired, [...updates.keys()])
  if (applied.unresolved.length) {
    return {
      detail:
        'Could not rewrite ' +
        applied.unresolved.join(', ') +
        ' without reformatting the manifest; left untouched.',
      status: 'unresolved',
    }
  }
  const verified = parseJsonOrNull(applied.contents)
  const verifiedScripts = (verified?.scripts as Record<string, string>) ?? {}
  const everyUpdateLanded = [...updates].every(([key, value]) => verifiedScripts[key] === value)
  if (
    !verified ||
    !everyUpdateLanded ||
    !deepEqualIgnoringScripts(currentManifest, verified, MANAGED_SCRIPT_KEYS)
  ) {
    return {
      detail: 'Refusing to write: the edit would have changed app-owned manifest content.',
      status: 'unresolved',
    }
  }
  return {
    detail: 'Updates ' + [...updates.keys()].join(', ') + '; every other key is untouched.',
    next: applied.contents,
    status: 'drift',
  }
}

function resolveManagedTarget(
  target: ManagedTarget,
  current: string | null,
  desired: string | undefined,
): Resolution {
  if (desired === undefined) {
    return {
      detail: 'The generator does not emit this path for the resolved profile.',
      status: 'absent',
    }
  }
  switch (target.mode) {
    case 'file':
      return resolveFile(current, desired, target.path)
    case 'pin':
      return resolvePin(current, desired)
    case 'region':
      return resolveRegion(current, desired, target.region, target.path, target.insertWhenMissing)
    case 'keys':
      return resolveKeys(current, desired)
    case 'jsonc-keys':
      return resolveJsoncKeys(current, desired, target)
  }
}

/**
 * Re-applies the generator-owned units of an existing narduk-app.
 *
 * Dry run by default: the report carries a unified diff per changed unit and
 * nothing is written. `write: true` applies exactly the changes the dry run
 * printed, and a second run is a no-op.
 */
export async function upgradeNardukApp(options: UpgradeNardukAppOptions): Promise<UpgradeReport> {
  const targetDir = resolve(options.targetDir)
  const profile = await inferUpgradeProfile(targetDir, options)
  const generated = generatedContentsFor(profile, targetDir)

  const only = (options.only ?? []).map((entry) => entry.replace(/^\.\//u, ''))
  for (const entry of only) {
    if (!MANAGED_TARGETS.some((target) => target.path === entry)) {
      throw new CreateNardukAppError(
        '--only must name a managed path: ' +
          MANAGED_TARGETS.map((target) => target.path).join(', '),
      )
    }
  }
  const targets = only.length
    ? MANAGED_TARGETS.filter((target) => only.includes(target.path))
    : MANAGED_TARGETS

  const changes: UpgradeChange[] = []
  for (const target of targets) {
    const absolute = resolve(targetDir, target.path)
    const current = await readIfExists(absolute)
    const resolution = resolveManagedTarget(target, current, generated.get(target.path))
    const next = resolution.next
    const diff = next === undefined ? '' : unifiedDiff(target.path, current ?? '', next)

    let applied = false
    if (options.write && next !== undefined) {
      await mkdir(dirname(absolute), { recursive: true })
      await writeFile(absolute, next, 'utf8')
      applied = true
    }
    changes.push({
      applied,
      detail: resolution.detail,
      diff,
      mode: target.mode,
      path: target.path,
      status: resolution.status,
      unit: target.unit,
    })
  }

  const summary: Record<UpgradeStatus, number> = {
    absent: 0,
    clean: 0,
    create: 0,
    drift: 0,
    unmanaged: 0,
    unresolved: 0,
  }
  for (const change of changes) summary[change.status] += 1

  return {
    changes,
    driftCount: changes.filter((change) => DRIFT_STATUSES.includes(change.status)).length,
    generator: { name: GENERATOR_NAME, version: GENERATOR_VERSION },
    mode: options.write ? 'write' : 'dry-run',
    profile,
    schemaVersion: 1,
    summary,
    targetDir,
  }
}

/** Human-readable dry-run/apply output: the diffs, then a one-line-per-path summary. */
export function formatUpgradeReport(report: UpgradeReport): string {
  const lines: string[] = []
  for (const change of report.changes) {
    if (change.diff) lines.push(change.diff.trimEnd(), '')
  }
  lines.push(
    (report.mode === 'write' ? 'Upgraded ' : 'Checked ') + report.targetDir,
    'Profile: ' +
      report.profile.appName +
      ' · ' +
      report.profile.visibility +
      ' · database ' +
      report.profile.databaseBackend +
      ' · port ' +
      report.profile.localPort +
      ' · capabilities ' +
      (report.profile.capabilities.join(',') || 'none') +
      ' (inferred: ' +
      (report.profile.inferred.join(', ') || 'none') +
      ')',
  )
  for (const note of report.profile.notes) lines.push('  note: ' + note)
  for (const change of report.changes) {
    const verb = change.applied ? 'applied' : change.status
    lines.push('  ' + verb.padEnd(11) + change.path + ' [' + change.unit + '] — ' + change.detail)
  }
  lines.push(
    report.driftCount === 0
      ? 'No drift in ' + report.changes.length + ' managed unit(s).'
      : (report.mode === 'write' ? 'Applied ' : 'Drift in ') +
          report.driftCount +
          ' of ' +
          report.changes.length +
          ' managed unit(s)' +
          (report.mode === 'write' ? '.' : '; re-run with --write to apply.'),
  )
  return lines.join('\n') + '\n'
}
