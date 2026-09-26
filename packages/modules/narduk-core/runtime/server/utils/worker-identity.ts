import { useRuntimeConfig } from 'nitropack/runtime'

import { readCloudflareRuntimeEnv } from './worker-env'

import type { H3Event } from 'h3'

/** The Worker version-metadata binding name narduk apps declare by default. */
export const DEFAULT_WORKER_VERSION_BINDING = 'CF_VERSION_METADATA'

const SOURCE_REVISION_PATTERN = /^[0-9a-f]{7,40}$/i

/** The Worker version the request ran on, from a `version_metadata` binding. */
export interface WorkerVersionIdentity {
  id: string
  tag: string | null
  timestamp: string | null
}

/** What `readWorkerIdentity` reports; each half is `null` when it is not known. */
export interface WorkerIdentity {
  /** The deployed commit SHA, lower-cased; `null` when the build stamped no SHA. */
  sourceRevision: string | null
  workerVersion: WorkerVersionIdentity | null
}

export interface ReadWorkerIdentityOptions {
  /** The `version_metadata` binding name. Default `CF_VERSION_METADATA`. */
  binding?: string
  /**
   * The source revision to report. Omitted, it is
   * `runtimeConfig.public.buildVersion`, the value narduk-core stamps into
   * `x-build-version` at build time.
   */
  sourceRevision?: string | null
}

/**
 * A git SHA (7 to 40 hex characters), lower-cased, or `null`.
 *
 * `buildVersion` falls back to the app's semver when the build found no
 * commit, so a value that is not a SHA reads as unknown rather than as a
 * revision.
 */
export function normalizeSourceRevision(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return SOURCE_REVISION_PATTERN.test(trimmed) ? trimmed.toLowerCase() : null
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** A Cloudflare `version_metadata` binding value, or `null` when it is not one. */
export function readWorkerVersionMetadata(value: unknown): WorkerVersionIdentity | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const id = readOptionalString(record.id)
  if (!id) return null
  return {
    id,
    tag: readOptionalString(record.tag),
    timestamp: readOptionalString(record.timestamp),
  }
}

function readConfiguredBuildVersion(event: H3Event): unknown {
  try {
    const config = useRuntimeConfig(event) as { public?: { buildVersion?: unknown } }
    return config.public?.buildVersion
  } catch {
    return undefined
  }
}

/**
 * The deploy identity of the Worker serving `event`: the commit the build
 * stamped and the Worker version from the `version_metadata` binding.
 *
 * The binding is read from `event.context.cloudflare.env`, then
 * `event.context._platform.cloudflare.env`, then the isolate env, the same
 * order every other core binding read uses. Outside a Worker, or without the
 * binding, `workerVersion` is `null`.
 *
 * @example
 * ```ts
 * const { sourceRevision, workerVersion } = readWorkerIdentity(event)
 * ```
 */
export function readWorkerIdentity(
  event: H3Event,
  options: ReadWorkerIdentityOptions = {},
): WorkerIdentity {
  const binding = readOptionalString(options.binding) ?? DEFAULT_WORKER_VERSION_BINDING
  const sourceRevision =
    options.sourceRevision === undefined
      ? readConfiguredBuildVersion(event)
      : options.sourceRevision
  return {
    sourceRevision: normalizeSourceRevision(sourceRevision),
    workerVersion: readWorkerVersionMetadata(readCloudflareRuntimeEnv(event)[binding]),
  }
}
