/**
 * Provider-grounded Worker deployment allocation.
 *
 * Cloudflare's deployments list has been observed both oldest-first
 * (`wrangler deployments list --json`, 2026-09-17 against `buoys`) and
 * newest-first (REST `GET .../deployments` in development-mode inspect).
 * Identity is the version serving 100% of traffic on the current
 * deployment, decided by `created_on`. List position is not identity.
 */

export interface WorkerDeployment {
  id: string
  source?: string
  strategy?: string
  created_on?: string
  annotations?: Record<string, string>
  versions: { version_id: string; percentage: number }[]
}

/**
 * The live deployment. `created_on` is the tiebreak rather than trusting
 * the provider's list order. Identical to the promote-path helper so
 * `fetchWorkerPlainTextVars` and `versions-promote` cannot disagree.
 */
export function currentDeployment(
  deployments: readonly WorkerDeployment[],
): WorkerDeployment | null {
  if (deployments.length === 0) return null
  return [...deployments].sort((a, b) => (a.created_on ?? '').localeCompare(b.created_on ?? ''))[
    deployments.length - 1
  ]
}

/** The version id serving 100% of traffic, or null when traffic is split. */
export function soleDeployedVersionId(deployment: WorkerDeployment | null): string | null {
  if (!deployment) return null
  const full = deployment.versions.filter((entry) => entry.percentage === 100)
  return full.length === 1 && deployment.versions.length === 1 ? full[0].version_id : null
}

export type ActiveWorkerVersionResolution =
  | { kind: 'resolved'; deployment: WorkerDeployment; versionId: string }
  | { kind: 'empty' }
  | { kind: 'split'; deployment: WorkerDeployment }
  | { kind: 'undated' }
  | { kind: 'ambiguous'; deployments: WorkerDeployment[] }

/**
 * Resolve the active production version from allocation state.
 *
 * Refuses when every row is undated (that would collapse to list position),
 * when the newest `created_on` is shared by deployments that do not agree
 * on a sole 100% version, or when traffic is split.
 */
export function resolveActiveWorkerVersion(
  deployments: readonly WorkerDeployment[],
): ActiveWorkerVersionResolution {
  if (deployments.length === 0) return { kind: 'empty' }
  const dated = deployments.filter(
    (row) => typeof row.created_on === 'string' && row.created_on.length > 0,
  )
  if (dated.length === 0) return { kind: 'undated' }
  const newestOn = [...dated]
    .sort((a, b) => a.created_on!.localeCompare(b.created_on!))
    .at(-1)?.created_on
  if (!newestOn) return { kind: 'undated' }
  const newest = dated.filter((row) => row.created_on === newestOn)
  const versionIds = new Set(newest.map((row) => soleDeployedVersionId(row)))
  if (newest.length === 1 && versionIds.has(null)) return { kind: 'split', deployment: newest[0] }
  if (versionIds.size !== 1 || versionIds.has(null))
    return { kind: 'ambiguous', deployments: newest }
  const deployment = newest[0]
  const versionId = soleDeployedVersionId(deployment)
  if (!versionId) return { kind: 'split', deployment }
  return { kind: 'resolved', deployment, versionId }
}

export function describeActiveWorkerResolution(
  scriptName: string,
  resolution: ActiveWorkerVersionResolution,
): string {
  switch (resolution.kind) {
    case 'resolved':
      return `Worker ${scriptName} serves ${resolution.versionId}`
    case 'empty':
      return `No active Worker deployment found for ${scriptName}`
    case 'split':
      return (
        `Worker ${scriptName} traffic is split across ` +
        `${String(resolution.deployment.versions.length)} version(s); ` +
        'refusing to read configuration from a versions-inventory list position'
      )
    case 'undated':
      return (
        `Worker ${scriptName} deployments carry no created_on; ` + 'refusing list-position identity'
      )
    case 'ambiguous':
      return (
        `Worker ${scriptName} has ${String(resolution.deployments.length)} ` +
        'deployments sharing the newest created_on with disagreeing allocations'
      )
  }
}
