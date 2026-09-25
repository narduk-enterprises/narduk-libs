/**
 * `narduk-app manifests validate` (narduk-libs#996): the structured
 * wrangler ↔ `Config/cloudflare-app.json` comparison that every app used to
 * carry as its own `scripts/validate-manifests.mjs`.
 *
 * The per-app copies had diverged in four ways this module fixes once:
 *
 * - **Parsing.** JSONC is read with `jsonc-parser`, never a regex, so a `//`
 *   inside a URL and the `/*` inside a `"*\/15 * * * *"` cron are string
 *   content, not comments (#914).
 * - **Ordering.** Every list is compared as a sorted set on BOTH sides, so the
 *   same crons written in a different order agree.
 * - **`account_id`.** When the manifest declares `deployment.accountId`, every
 *   compared wrangler config must declare the same `account_id`: without it,
 *   `versions-promote` falls back to wrangler's unpaged ten-version listing.
 * - **Access flags.** `worker.workersDev` / `worker.previewUrls`, when the
 *   manifest declares them, must be stated with the same value in wrangler;
 *   an absent flag leaves the answer to wrangler's default.
 *
 * Only what the manifest declares is compared: a manifest with no `bindings`
 * block has nothing to mirror. Read-only and credential-free.
 */

import { writeFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

import { AppRepo, findWranglerConfig, isRecord, parseJson } from './foundation/source.js'

import { CLOUDFLARE_APP_MANIFEST } from './database-ownership.js'

export interface ManifestFinding {
  /** The wrangler config the finding is about (repo-relative), or the manifest. */
  file: string
  /** `bindings.d1`, `account_id`, `workers_dev`, ... */
  field: string
  message: string
}

export interface ManifestValidation {
  manifest: string
  wranglerConfigs: string[]
  findings: ManifestFinding[]
}

/** The facts compared, read the same way from a JSON/JSONC or TOML wrangler config. */
export interface WranglerFacts {
  accountId: string | null
  workersDev: boolean | null
  previewUrls: boolean | null
  cron: string[]
  d1: string[]
  kv: string[]
  r2: string[]
  queues: string[]
  durableObjects: string[]
}

const BINDING_KINDS = ['cron', 'd1', 'kv', 'r2', 'queues', 'durableObjects'] as const
type BindingKind = (typeof BINDING_KINDS)[number]

function strings(values: unknown[]): string[] {
  return values.filter((value): value is string => typeof value === 'string').sort()
}

function bindingsOf(block: unknown, key = 'binding'): string[] {
  const list = Array.isArray(block) ? block : []
  return strings(list.map((entry) => (isRecord(entry) ? entry[key] : entry)))
}

export function wranglerFactsFromJson(config: unknown): WranglerFacts {
  const root = isRecord(config) ? config : {}
  const triggers = isRecord(root.triggers) ? root.triggers : {}
  const queues = isRecord(root.queues) ? root.queues : {}
  const producers = Array.isArray(queues.producers) ? queues.producers : []
  const consumers = Array.isArray(queues.consumers) ? queues.consumers : []
  const durable = isRecord(root.durable_objects) ? root.durable_objects.bindings : undefined
  return {
    accountId: typeof root.account_id === 'string' ? root.account_id.trim() || null : null,
    workersDev: typeof root.workers_dev === 'boolean' ? root.workers_dev : null,
    previewUrls: typeof root.preview_urls === 'boolean' ? root.preview_urls : null,
    cron: strings(Array.isArray(triggers.crons) ? triggers.crons : []),
    d1: bindingsOf(root.d1_databases),
    kv: bindingsOf(root.kv_namespaces),
    r2: bindingsOf(root.r2_buckets),
    queues: strings([
      ...producers.map((entry) =>
        isRecord(entry) && typeof entry.binding === 'string' ? `${entry.binding}:producer` : null,
      ),
      ...consumers.map((entry) =>
        isRecord(entry) && typeof entry.queue === 'string' ? `${entry.queue}:consumer` : null,
      ),
    ]),
    // Durable Object bindings are named by `name`, not `binding`.
    durableObjects: bindingsOf(durable, 'name'),
  }
}

interface TomlScan {
  /** String contents in order, escapes kept as written. */
  strings: string[]
  /** Everything outside strings and comments, each string replaced by `\0`. */
  bare: string
  unterminated: boolean
}

// One left-to-right pass instead of regexes, so a long or unterminated line
// stays linear (CodeQL polynomial-redos on #1067), and a `#` inside a string
// is content rather than the start of a comment.
function scanToml(raw: string): TomlScan {
  const strings: string[] = []
  let bare = ''
  let index = 0
  while (index < raw.length) {
    const char = raw[index]
    if (char === '#') {
      const newline = raw.indexOf('\n', index)
      if (newline === -1) break
      index = newline
      continue
    }
    if (char !== '"' && char !== "'") {
      bare += char
      index += 1
      continue
    }
    let cursor = index + 1
    let closed = false
    while (cursor < raw.length) {
      const inner = raw[cursor]
      if (inner === char) {
        closed = true
        break
      }
      // Basic ("...") strings take backslash escapes; literal ('...') do not.
      cursor += char === '"' && inner === '\\' ? 2 : 1
    }
    if (!closed) return { strings, bare, unterminated: true }
    strings.push(raw.slice(index + 1, cursor))
    bare += '\0'
    index = cursor + 1
  }
  return { strings, bare, unterminated: false }
}

function tomlScalar(raw: string): string | boolean | null {
  const { strings, bare, unterminated } = scanToml(raw)
  if (unterminated) return null
  const value = bare.trim()
  if (strings.length === 0 && value === 'true') return true
  if (strings.length === 0 && value === 'false') return false
  if (strings.length === 1 && value === '\0') return strings[0]
  return null
}

function tomlStringArray(raw: string): string[] {
  return scanToml(raw).strings
}

/**
 * The same facts from a `wrangler.toml`, read line by line. Only the
 * top-level scope is compared (tables under `[env.*]` are skipped), which is
 * also what the JSON reader does. Enough TOML for what wrangler writes: scalar
 * `key = value` lines, `[[array.tables]]`, and a `crons = [...]` array that may
 * span lines.
 */
export function wranglerFactsFromToml(text: string): WranglerFacts {
  const facts: WranglerFacts = {
    accountId: null,
    workersDev: null,
    previewUrls: null,
    cron: [],
    d1: [],
    kv: [],
    r2: [],
    queues: [],
    durableObjects: [],
  }
  const tableKinds: Record<string, (value: string) => void> = {
    d1_databases: (v) => facts.d1.push(v),
    kv_namespaces: (v) => facts.kv.push(v),
    r2_buckets: (v) => facts.r2.push(v),
    'queues.producers': (v) => facts.queues.push(`${v}:producer`),
  }
  let table = ''
  const lines = text.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const trimmed = line.trim()
    const header = /^\[\[?([^\]]+)\]\]?(?:\s*#.*)?$/.exec(trimmed)
    if (header) {
      table = header[1].trim()
      continue
    }
    const kv = /^(\w+)\s*=(.*)$/.exec(trimmed)
    if (!kv) continue
    const [, key, rawValue] = kv
    if (table === '') {
      const value = tomlScalar(rawValue)
      if (key === 'account_id' && typeof value === 'string') facts.accountId = value.trim() || null
      if (key === 'workers_dev' && typeof value === 'boolean') facts.workersDev = value
      if (key === 'preview_urls' && typeof value === 'boolean') facts.previewUrls = value
      continue
    }
    if (table === 'triggers' && key === 'crons') {
      let raw = rawValue
      while (!raw.includes(']') && index + 1 < lines.length) raw += `\n${lines[(index += 1)]}`
      facts.cron.push(...tomlStringArray(raw))
      continue
    }
    const value = tomlScalar(rawValue)
    if (typeof value !== 'string') continue
    if (key === 'binding' && table in tableKinds) tableKinds[table](value)
    // Durable Object bindings are named by `name`, not `binding`.
    if (key === 'name' && table === 'durable_objects.bindings') facts.durableObjects.push(value)
    if (key === 'queue' && table === 'queues.consumers') facts.queues.push(`${value}:consumer`)
  }
  for (const kind of BINDING_KINDS) facts[kind].sort()
  return facts
}

/** The binding lists the manifest declares; an undeclared kind is `null` (not compared). */
export function manifestBindings(manifest: unknown): Record<BindingKind, string[] | null> {
  const bindings = isRecord(manifest) && isRecord(manifest.bindings) ? manifest.bindings : null
  const read = (key: string, map: (entry: unknown) => unknown = (entry) => entry) => {
    if (!bindings || !Array.isArray(bindings[key])) return null
    return strings((bindings[key] as unknown[]).map(map))
  }
  const binding = (entry: unknown) => (isRecord(entry) ? entry.binding : entry)
  return {
    cron: read('cron'),
    d1: read('d1', binding),
    kv: read('kv', binding),
    r2: read('r2', binding),
    queues: read('queues', (entry) => {
      if (!isRecord(entry)) return null
      const name = entry.binding ?? entry.queue
      return typeof name === 'string' && typeof entry.role === 'string'
        ? `${name}:${entry.role}`
        : null
    }),
    durableObjects: read('durableObjects', (entry) =>
      isRecord(entry) ? (entry.binding ?? entry.name) : entry,
    ),
  }
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function describeSetDiff(actual: readonly string[], expected: readonly string[]): string {
  const missing = expected.filter((value) => !actual.includes(value))
  const extra = actual.filter((value) => !expected.includes(value))
  const parts: string[] = []
  if (missing.length > 0) parts.push(`missing from wrangler: ${missing.join(', ')}`)
  if (extra.length > 0) parts.push(`not in the manifest: ${extra.join(', ')}`)
  if (parts.length === 0) parts.push('duplicate entries differ')
  return parts.join('; ')
}

/** Compare one wrangler config's facts with the manifest. Pure. */
export function compareWranglerWithManifest(
  file: string,
  facts: WranglerFacts,
  manifest: unknown,
): ManifestFinding[] {
  const findings: ManifestFinding[] = []
  const expected = manifestBindings(manifest)
  for (const kind of BINDING_KINDS) {
    const want = expected[kind]
    if (want === null) continue
    if (!sameSet(facts[kind], want)) {
      findings.push({
        file,
        field: `bindings.${kind}`,
        message: `${describeSetDiff(facts[kind], want)} (wrangler=${JSON.stringify(facts[kind])}, manifest=${JSON.stringify(want)})`,
      })
    }
  }

  const root = isRecord(manifest) ? manifest : {}
  const deployment = isRecord(root.deployment) ? root.deployment : {}
  const accountId =
    typeof deployment.accountId === 'string' ? deployment.accountId.trim() || null : null
  if (accountId !== null && facts.accountId !== accountId) {
    findings.push({
      file,
      field: 'account_id',
      message:
        facts.accountId === null
          ? `wrangler declares no account_id; the manifest's deployment.accountId is ${accountId}`
          : `wrangler account_id ${facts.accountId} is not the manifest's deployment.accountId ${accountId}`,
    })
  }

  const worker = isRecord(root.worker) ? root.worker : {}
  const flags = [
    ['workersDev', 'workers_dev', facts.workersDev],
    ['previewUrls', 'preview_urls', facts.previewUrls],
  ] as const
  for (const [manifestKey, wranglerKey, actual] of flags) {
    const want = worker[manifestKey]
    if (typeof want !== 'boolean' || actual === want) continue
    findings.push({
      file,
      field: wranglerKey,
      message:
        actual === null
          ? `wrangler does not declare ${wranglerKey}; the manifest's worker.${manifestKey} is ${want}`
          : `wrangler ${wranglerKey} is ${actual}; the manifest's worker.${manifestKey} is ${want}`,
    })
  }
  return findings
}

export function readWranglerFacts(repo: AppRepo, rel: string): WranglerFacts | string {
  const text = repo.read(rel)
  if (text === null) return `${rel} does not exist`
  if (rel.endsWith('.toml')) return wranglerFactsFromToml(text)
  const parsed = parseJson(text)
  if (!isRecord(parsed)) return `${rel} is not valid JSON/JSONC`
  return wranglerFactsFromJson(parsed)
}

/**
 * Validate a checkout. The wrangler configs compared are `wranglerPaths` when
 * given (repo-relative or absolute), else the manifest's `worker.wranglerConfig`,
 * else the first wrangler config at a known path.
 */
export function validateCloudflareManifest(
  checkout: string,
  options: { wranglerPaths?: readonly string[] } = {},
): ManifestValidation {
  const repo = new AppRepo(checkout)
  const result: ManifestValidation = {
    manifest: CLOUDFLARE_APP_MANIFEST,
    wranglerConfigs: [],
    findings: [],
  }
  const manifestText = repo.read(CLOUDFLARE_APP_MANIFEST)
  if (manifestText === null) {
    result.findings.push({
      file: CLOUDFLARE_APP_MANIFEST,
      field: 'manifest',
      message: `${CLOUDFLARE_APP_MANIFEST} does not exist`,
    })
    return result
  }
  const manifest = parseJson(manifestText)
  if (!isRecord(manifest)) {
    result.findings.push({
      file: CLOUDFLARE_APP_MANIFEST,
      field: 'manifest',
      message: `${CLOUDFLARE_APP_MANIFEST} is not valid JSON/JSONC`,
    })
    return result
  }

  const declared =
    isRecord(manifest.worker) && typeof manifest.worker.wranglerConfig === 'string'
      ? manifest.worker.wranglerConfig
      : null
  const configs =
    options.wranglerPaths && options.wranglerPaths.length > 0
      ? options.wranglerPaths.map((path) =>
          isAbsolute(path) ? relative(checkout, path) : relative(checkout, resolve(checkout, path)),
        )
      : [declared ?? findWranglerConfig(repo)].filter((rel): rel is string => rel !== null)
  if (configs.length === 0) {
    result.findings.push({
      file: CLOUDFLARE_APP_MANIFEST,
      field: 'worker.wranglerConfig',
      message: 'no wrangler config is declared in worker.wranglerConfig or found at a known path',
    })
    return result
  }

  for (const rel of configs) {
    result.wranglerConfigs.push(rel)
    const facts = readWranglerFacts(repo, rel)
    if (typeof facts === 'string') {
      result.findings.push({ file: rel, field: 'wrangler', message: facts })
      continue
    }
    result.findings.push(...compareWranglerWithManifest(rel, facts, manifest))
  }
  return result
}

export interface ManifestsValidateFlags {
  checkoutDir: string
  wranglerPaths: string[]
  json: boolean
  jsonPath: string | null
}

export function parseManifestsValidateArgs(
  args: string[],
  cwd = process.cwd(),
): ManifestsValidateFlags {
  const flags: ManifestsValidateFlags = {
    checkoutDir: cwd,
    wranglerPaths: [],
    json: false,
    jsonPath: null,
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--checkout') {
      const value = args[(index += 1)]
      if (!value) throw new Error('manifests validate: --checkout needs a directory')
      flags.checkoutDir = value
    } else if (arg === '--wrangler') {
      const value = args[(index += 1)]
      if (!value) throw new Error('manifests validate: --wrangler needs a path')
      flags.wranglerPaths.push(value)
    } else if (arg === '--json') {
      const next = args[index + 1]
      if (next && !next.startsWith('--')) {
        flags.jsonPath = next
        index += 1
      } else {
        flags.json = true
      }
    } else throw new Error(`Unknown manifests validate option: ${arg}`)
  }
  return { ...flags, checkoutDir: resolve(cwd, flags.checkoutDir) }
}

export function formatManifestValidation(result: ManifestValidation): string {
  const compared = result.wranglerConfigs.join(', ') || 'no wrangler config'
  if (result.findings.length === 0) {
    return `manifests: ${compared} and ${result.manifest} agree`
  }
  return [
    `manifests: ${result.findings.length} disagreement(s) between ${compared} and ${result.manifest}`,
    ...result.findings.map((finding) => `  ${finding.file} ${finding.field}: ${finding.message}`),
  ].join('\n')
}

/** Exit 0 when every compared config agrees with the manifest, 1 otherwise. */
export function runManifestsValidateCommand(flags: ManifestsValidateFlags): {
  result: ManifestValidation
  exitCode: number
} {
  const result = validateCloudflareManifest(flags.checkoutDir, {
    wranglerPaths: flags.wranglerPaths,
  })
  if (flags.jsonPath) {
    writeFileSync(flags.jsonPath, JSON.stringify(result, null, 2) + '\n', 'utf8')
  }
  if (flags.json) console.log(JSON.stringify(result, null, 2))
  else if (result.findings.length === 0) console.log(formatManifestValidation(result))
  else console.error(formatManifestValidation(result))
  return { result, exitCode: result.findings.length === 0 ? 0 : 1 }
}
