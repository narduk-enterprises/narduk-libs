/**
 * Exact Worker identity binding: UUID and SHA tag, never inventory position.
 *
 * A missing runtime metadata tag is acceptable only when provider inventory
 * independently binds the exact version UUID to the exact SHA tag. Every
 * contradictory non-null runtime tag is rejected (narduk-libs#47 / LakeStat).
 */

import { shaMatchesTag, VERSION_TAG_ANNOTATION, type WorkerVersion } from './promote.js'

import type { LiveResponse } from './live-probe.js'

export interface ExpectedIdentity {
  versionId?: string
  sha?: string
}

export interface RuntimeIdentity {
  versionId?: string | null
  sha?: string | null
}

export type IdentityBindingResult =
  | { kind: 'bound'; versionId: string; sha: string }
  | { kind: 'missing-runtime-tag-accepted'; versionId: string; sha: string }
  | { kind: 'unspecified' }
  | { kind: 'wrong-uuid'; expectedId: string; searched: number }
  | {
      kind: 'wrong-sha'
      expectedSha: string
      inventoryTag: string | null
      versionId: string | null
    }
  | { kind: 'ambiguous'; versions: string[] }
  | { kind: 'contradictory-runtime-id'; runtimeId: string; versionId: string }
  | {
      kind: 'contradictory-runtime-tag'
      runtimeSha: string
      expectedSha: string
      versionId: string
    }
  | { kind: 'unbound'; versionId: string | null }

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function normalizeSha(value: string | null | undefined): string | undefined {
  const trimmed = emptyToNull(value)
  return trimmed ? trimmed.toLowerCase() : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(record: Record<string, unknown> | undefined, keys: string[]): string | null {
  if (!record) return null
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function parseJsonBody(body: string | undefined): Record<string, unknown> | undefined {
  if (!body?.trim()) return undefined
  try {
    const parsed: unknown = JSON.parse(body)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function versionTag(version: WorkerVersion): string | null {
  return emptyToNull(version.annotations?.[VERSION_TAG_ANNOTATION])
}

/**
 * Identity from a no-store health/HTML response. Header wins: narduk-core
 * stamps `x-build-version` on every response. Body fields are the escape
 * hatch some apps used for a Worker UUID / nullable runtime tag.
 */
export function readRuntimeIdentity(response: LiveResponse): RuntimeIdentity {
  const headers = response.headers ?? {}
  const body = parseJsonBody(response.body)
  const data = body && isRecord(body.data) ? body.data : body
  const sha =
    emptyToNull(headers['x-build-version']) ??
    readString(data, ['sha', 'buildVersion', 'commit', 'version'])
  const rawId =
    emptyToNull(headers['x-worker-version']) ?? readString(data, ['versionId', 'workerVersionId'])
  return {
    sha,
    versionId: rawId && UUID_PATTERN.test(rawId) ? rawId : null,
  }
}

export function identityMatches(result: IdentityBindingResult): boolean {
  return result.kind === 'bound' || result.kind === 'missing-runtime-tag-accepted'
}

/**
 * Bind expected UUID/SHA to provider inventory and the runtime observation.
 * Inventory is scanned by exact id or tag match; `inventory[0]` is never read
 * as "latest".
 */
export function bindWorkerIdentity(args: {
  expected: ExpectedIdentity
  runtime: RuntimeIdentity
  inventory: readonly WorkerVersion[]
}): IdentityBindingResult {
  const expectedSha = normalizeSha(args.expected.sha)
  const expectedId = emptyToNull(args.expected.versionId) ?? undefined
  if (!expectedSha && !expectedId) return { kind: 'unspecified' }

  const byId = expectedId ? args.inventory.filter((version) => version.id === expectedId) : []
  const bySha = expectedSha
    ? args.inventory.filter((version) =>
        shaMatchesTag(expectedSha, versionTag(version) ?? undefined),
      )
    : []

  if (expectedId && byId.length === 0) {
    return { kind: 'wrong-uuid', expectedId, searched: args.inventory.length }
  }
  if (expectedId && expectedSha) {
    const tagged = byId.filter((version) =>
      shaMatchesTag(expectedSha, versionTag(version) ?? undefined),
    )
    if (tagged.length === 0) {
      return {
        kind: 'wrong-sha',
        expectedSha,
        inventoryTag: versionTag(byId[0]),
        versionId: expectedId,
      }
    }
  }
  if (!expectedId && bySha.length === 0) {
    return { kind: 'wrong-sha', expectedSha: expectedSha!, inventoryTag: null, versionId: null }
  }
  if (!expectedId && bySha.length > 1) {
    return { kind: 'ambiguous', versions: bySha.map((version) => version.id) }
  }

  const versionId = expectedId ?? bySha[0].id
  const inventoryRow = args.inventory.find((version) => version.id === versionId)
  const inventoryTag = inventoryRow ? versionTag(inventoryRow) : null
  const boundSha = expectedSha ?? inventoryTag
  if (!boundSha) return { kind: 'unbound', versionId }

  const runtimeSha = normalizeSha(args.runtime.sha)
  const runtimeId = emptyToNull(args.runtime.versionId)

  if (runtimeId && runtimeId !== versionId) {
    return { kind: 'contradictory-runtime-id', runtimeId, versionId }
  }
  if (runtimeSha) {
    if (!shaMatchesTag(boundSha, runtimeSha)) {
      return { kind: 'contradictory-runtime-tag', runtimeSha, expectedSha: boundSha, versionId }
    }
    return { kind: 'bound', versionId, sha: boundSha }
  }
  if (inventoryTag && shaMatchesTag(boundSha, inventoryTag)) {
    return { kind: 'missing-runtime-tag-accepted', versionId, sha: boundSha }
  }
  return { kind: 'unbound', versionId }
}

export function describeIdentityBinding(result: IdentityBindingResult): string {
  switch (result.kind) {
    case 'bound':
      return `runtime identity matches ${result.versionId} / ${result.sha}`
    case 'missing-runtime-tag-accepted':
      return (
        `runtime metadata tag is absent; provider inventory binds ${result.versionId} ` +
        `to ${result.sha}`
      )
    case 'unspecified':
      return 'expected Worker identity is missing both version UUID and SHA'
    case 'wrong-uuid':
      return (
        `provider inventory does not contain version ${result.expectedId} ` +
        `(${String(result.searched)} version(s) searched)`
      )
    case 'wrong-sha':
      return (
        `provider inventory does not bind ${result.expectedSha}` +
        (result.versionId ? ` on ${result.versionId}` : '') +
        (result.inventoryTag ? ` (tag ${result.inventoryTag})` : '')
      )
    case 'ambiguous':
      return `more than one uploaded version carries the expected SHA tag: ${result.versions.join(', ')}`
    case 'contradictory-runtime-id':
      return `runtime version ${result.runtimeId} contradicts provider version ${result.versionId}`
    case 'contradictory-runtime-tag':
      return `runtime tag ${result.runtimeSha} contradicts expected ${result.expectedSha}`
    case 'unbound':
      return 'runtime tag is absent and provider inventory does not bind the exact UUID to a SHA tag'
  }
}
