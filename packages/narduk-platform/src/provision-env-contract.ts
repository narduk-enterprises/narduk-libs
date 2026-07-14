/**
 * App-owned environment contract composition. Callers pass the capabilities an
 * independent app has selected; this module only describes provider requirements.
 * It does not infer capabilities from a template or mutate any provider.
 */
import type {
  AppEnvContractDefinition,
  AppEnvContractExpectedValueSource,
  AppEnvContractManagedBy,
  AppEnvContractRequirement,
  CanonicalProvider,
  CloudflarePlane,
  EnvKeyPhase,
  EnvKeySensitivity,
} from './provider-console'
import {
  getCatalogEntry,
  listKeysForModules,
  type CatalogDestination,
  type CatalogEntry,
  type AppCapabilityId,
} from './env-catalog'

export const APP_ENV_CONTRACT_VERSION = 1 as const
/** @deprecated Use APP_ENV_CONTRACT_VERSION. */
export const PROVISION_ENV_CONTRACT_VERSION = APP_ENV_CONTRACT_VERSION

export type AppEnvContractStatus = 'available' | 'missing' | 'invalid'
/** @deprecated Use AppEnvContractStatus. */
export type ProvisionEnvContractStatus = AppEnvContractStatus

export interface AppEnvContractResult {
  status: AppEnvContractStatus
  value: AppEnvContractDefinition | null
}
/** @deprecated Use AppEnvContractResult. */
export type ProvisionEnvContractResult = AppEnvContractResult

type SupportedCanonicalProvider = Exclude<CanonicalProvider, 'doppler' | 'unknown'>
type SupportedGithubScope = Exclude<
  NonNullable<AppEnvContractRequirement['githubScope']>,
  'environment'
>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function uniqueSorted(values: readonly string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

function normalizeManagedBy(value: unknown): AppEnvContractManagedBy | null {
  return value === 'app' ? value : null
}

function normalizePhase(value: unknown): EnvKeyPhase | null {
  return value === 'workflow' ||
    value === 'build' ||
    value === 'runtime' ||
    value === 'build + runtime'
    ? value
    : null
}

function normalizeSensitivity(value: unknown): EnvKeySensitivity | null {
  return value === 'plain' || value === 'secret' ? value : null
}

function normalizeCanonicalProvider(value: unknown): SupportedCanonicalProvider | null {
  return value === 'cloudflare' || value === 'github' ? value : null
}

function normalizeGithubScope(value: unknown): SupportedGithubScope | null {
  return value === 'repo' || value === 'org' ? value : null
}

function normalizeCloudflarePlanes(value: unknown): CloudflarePlane[] | null {
  if (!Array.isArray(value)) return null

  const planes = value.filter(
    (plane): plane is CloudflarePlane =>
      plane === 'runtime-var' ||
      plane === 'runtime-secret' ||
      plane === 'build-var' ||
      plane === 'build-secret',
  )

  if (planes.length !== value.length || planes.length === 0) {
    return null
  }

  return uniqueSorted(planes) as CloudflarePlane[]
}

function normalizeExpectedValueSource(value: unknown): AppEnvContractExpectedValueSource | null {
  return value === 'app.url' ? value : null
}

interface CatalogKeyClassification {
  phase: EnvKeyPhase
  sensitivity: EnvKeySensitivity
  canonicalProvider: CanonicalProvider
  githubScope?: 'repo' | 'org' | null
  cloudflarePlanes?: CloudflarePlane[]
  migrationNotes: string
}

function classifyFromDestinations(to: readonly CatalogDestination[]): {
  phase: EnvKeyPhase
  canonicalProvider: CanonicalProvider
  githubScope?: 'repo' | 'org'
  cloudflarePlanes?: CloudflarePlane[]
} {
  const cf = to.filter((d) => d.startsWith('cf:'))
  const gh = to.filter((d) => d.startsWith('gh:'))

  const planes: CloudflarePlane[] = []
  if (to.includes('cf:runtime-var')) planes.push('runtime-var')
  if (to.includes('cf:runtime-secret')) planes.push('runtime-secret')
  if (to.includes('cf:build-var')) planes.push('build-var')
  if (to.includes('cf:build-secret')) planes.push('build-secret')

  const hasBuild = cf.some((d) => d.includes('build'))
  const hasRuntime = cf.some((d) => d.includes('runtime'))

  let phase: EnvKeyPhase
  if (gh.length > 0 && cf.length === 0) phase = 'workflow'
  else if (hasBuild && hasRuntime) phase = 'build + runtime'
  else if (hasBuild) phase = 'build'
  else if (hasRuntime) phase = 'runtime'
  else phase = gh.length > 0 ? 'workflow' : 'runtime'

  const canonicalProvider: CanonicalProvider =
    cf.length > 0 ? 'cloudflare' : gh.length > 0 ? 'github' : 'unknown'
  const githubScope: 'repo' | 'org' | undefined = gh.some((d) => d.startsWith('gh:repo'))
    ? 'repo'
    : gh.some((d) => d.startsWith('gh:org'))
      ? 'org'
      : undefined

  return {
    phase,
    canonicalProvider,
    ...(githubScope ? { githubScope } : {}),
    ...(planes.length > 0 ? { cloudflarePlanes: planes } : {}),
  }
}

function classifyCatalogKey(key: string): CatalogKeyClassification {
  const entry = getCatalogEntry(key)
  if (entry) {
    const classified = classifyFromDestinations(entry.to)
    return {
      phase: classified.phase,
      sensitivity: entry.secret ? 'secret' : 'plain',
      canonicalProvider: classified.canonicalProvider,
      githubScope: classified.githubScope ?? null,
      cloudflarePlanes: classified.cloudflarePlanes,
      migrationNotes: entry.note?.trim() ? entry.note : 'Derived from the platform env catalog.',
    }
  }

  return {
    phase: 'runtime',
    sensitivity: /(?:_KEY|_TOKEN|_SECRET|PASSWORD|PRIVATE_KEY|SERVICE_ACCOUNT_JSON)$/i.test(key)
      ? 'secret'
      : 'plain',
    canonicalProvider: 'unknown',
    migrationNotes: 'Unclassified key. Add it to the env-catalog before migrating.',
  }
}

function normalizeRequirement(
  value: unknown,
  fallbackManagedBy: AppEnvContractManagedBy = 'app',
): AppEnvContractRequirement | null {
  if (!isRecord(value)) return null

  const key = normalizeText(value.key)
  if (!key) return null

  const classified = classifyCatalogKey(key)
  const hasManagedBy = Object.prototype.hasOwnProperty.call(value, 'managedBy')
  const normalizedManagedBy = normalizeManagedBy(value.managedBy)
  if (hasManagedBy && !normalizedManagedBy) return null
  const managedBy = normalizedManagedBy ?? fallbackManagedBy
  const phase = normalizePhase(value.phase) ?? classified.phase
  const sensitivity = normalizeSensitivity(value.sensitivity) ?? classified.sensitivity
  const canonicalProvider =
    normalizeCanonicalProvider(value.canonicalProvider) ??
    normalizeCanonicalProvider(classified.canonicalProvider)

  if (!managedBy || !phase || !sensitivity || !canonicalProvider) {
    return null
  }

  const cloudflarePlanes =
    normalizeCloudflarePlanes(value.cloudflarePlanes) ??
    (canonicalProvider === 'cloudflare' ? classified.cloudflarePlanes : undefined)

  const githubScope =
    normalizeGithubScope(value.githubScope) ??
    (canonicalProvider === 'github' ? normalizeGithubScope(classified.githubScope) : undefined)

  if (canonicalProvider === 'cloudflare' && (!cloudflarePlanes || cloudflarePlanes.length === 0)) {
    return null
  }

  if (
    canonicalProvider === 'cloudflare' &&
    cloudflarePlanes?.some((plane) =>
      sensitivity === 'secret' ? plane.endsWith('var') : plane.endsWith('secret'),
    )
  ) {
    return null
  }

  if (canonicalProvider === 'github' && !githubScope) {
    return null
  }

  const expectedValue = normalizeText(value.expectedValue) ?? undefined
  const hasExpectedValueFrom = Object.prototype.hasOwnProperty.call(value, 'expectedValueFrom')
  const normalizedExpectedValueFrom = normalizeExpectedValueSource(value.expectedValueFrom)
  if (hasExpectedValueFrom && !normalizedExpectedValueFrom) return null
  const expectedValueFrom = normalizedExpectedValueFrom ?? undefined

  if (sensitivity === 'secret' && (expectedValue || expectedValueFrom)) {
    return null
  }

  if (expectedValue && expectedValueFrom) {
    return null
  }

  const notes = normalizeText(value.notes) ?? classified.migrationNotes

  if (canonicalProvider === 'cloudflare') {
    return {
      key,
      managedBy,
      phase,
      sensitivity,
      canonicalProvider,
      cloudflarePlanes,
      ...(expectedValue ? { expectedValue } : {}),
      ...(expectedValueFrom ? { expectedValueFrom } : {}),
      ...(notes ? { notes } : {}),
    }
  }

  return {
    key,
    managedBy,
    phase,
    sensitivity,
    canonicalProvider,
    githubScope: githubScope as SupportedGithubScope,
    ...(expectedValue ? { expectedValue } : {}),
    ...(expectedValueFrom ? { expectedValueFrom } : {}),
    ...(notes ? { notes } : {}),
  }
}

function sortRequirements(requirements: AppEnvContractRequirement[]) {
  return [...requirements].sort((left, right) => left.key.localeCompare(right.key))
}

function hasDuplicateRequirementKeys(requirements: readonly AppEnvContractRequirement[]) {
  return new Set(requirements.map((requirement) => requirement.key)).size !== requirements.length
}

function createRequirementForKey(key: string): AppEnvContractRequirement {
  const requirement = normalizeRequirement({ key, managedBy: 'app' })

  if (!requirement) {
    throw new Error(`Unable to normalize env contract requirement for ${key}.`)
  }

  if (key === 'SITE_URL') {
    return {
      ...requirement,
      expectedValueFrom: 'app.url',
    }
  }

  return requirement
}

export function createPendingEnvReadinessSummary(required = 0) {
  return {
    status: 'pending' as const,
    required,
    satisfied: 0,
    missingKeys: [],
    driftedKeys: [],
    blockingReasons: [],
    missingContract: false,
  }
}

// ─── contract composition: module-driven ─────────────────────────────────────

function isEligibleForEnvContract(entry: CatalogEntry): boolean {
  // Eligibility is driven by DESTINATION (`to`), not SOURCE (`from`). A key
  // belongs to the per-app Cloudflare contract iff it writes at least one
  // Cloudflare plane (build-var / runtime-var / runtime-secret). `from` only
  // tells the resolver *where the value comes from* — e.g. `SITE_URL` is
  // sourced from `app-config:url` but still needs to land on the
  // Worker as `cf:build-var` + `cf:runtime-var`, so it must stay in the
  // contract and in drift checks.
  return entry.to.some((dest) => dest.startsWith('cf:'))
}

export function buildAppEnvContract(options: {
  capabilities: readonly AppCapabilityId[]
}): AppEnvContractDefinition {
  // The env contract surface is driven entirely by the capabilities an app
  // declares. Scope (`every-app` / `one-app`) only governs whether
  // the resolved VALUE is shared across apps or per-app — not whether the key
  // is required. A core-only app intentionally does not provision
  // auth/supabase/posthog keys because those modules were not selected. See
  // the docstring on `CatalogScope` in `env-catalog.ts` for the full meaning.
  const requirementKeys = uniqueSorted(
    listKeysForModules(options.capabilities).filter((key) => {
      const entry = getCatalogEntry(key)
      return entry ? isEligibleForEnvContract(entry) : false
    }),
  )

  return {
    version: APP_ENV_CONTRACT_VERSION,
    requirements: sortRequirements(requirementKeys.map((key) => createRequirementForKey(key))),
  }
}

export function normalizeAppEnvContractDefinition(value: unknown): AppEnvContractDefinition | null {
  if (!isRecord(value)) return null
  if (value.version !== APP_ENV_CONTRACT_VERSION) return null
  if (!Array.isArray(value.requirements)) return null

  const requirements = value.requirements
    .map((requirement) => normalizeRequirement(requirement))
    .filter((requirement): requirement is AppEnvContractRequirement => requirement != null)

  if (requirements.length !== value.requirements.length) {
    return null
  }

  if (hasDuplicateRequirementKeys(requirements)) {
    return null
  }

  return {
    version: APP_ENV_CONTRACT_VERSION,
    requirements: sortRequirements(requirements),
  }
}

export function extractAppEnvContractDefinition(value: unknown): AppEnvContractDefinition | null {
  if (!isRecord(value)) return null
  if (value.version !== APP_ENV_CONTRACT_VERSION) return null
  if (!Array.isArray(value.requirements)) return null

  const requirements = value.requirements
    .map((requirement) => normalizeRequirement(requirement))
    .filter(
      (requirement): requirement is AppEnvContractRequirement =>
        requirement != null && requirement.managedBy === 'app',
    )

  const uniqueRequirements = requirements.filter(
    (requirement, index, entries) =>
      entries.findIndex((entry) => entry.key === requirement.key) === index,
  )

  return {
    version: APP_ENV_CONTRACT_VERSION,
    requirements: sortRequirements(uniqueRequirements),
  }
}

export function mergeAppEnvContractDefinitions(options: {
  existing: AppEnvContractDefinition | null
  required: AppEnvContractDefinition
}): AppEnvContractDefinition {
  const byKey = new Map<string, AppEnvContractRequirement>()
  for (const requirement of [
    ...(options.existing?.requirements ?? []),
    ...options.required.requirements,
  ]) {
    const normalized = normalizeRequirement({ ...requirement, managedBy: 'app' })
    if (normalized) byKey.set(normalized.key, normalized)
  }

  return {
    version: APP_ENV_CONTRACT_VERSION,
    requirements: sortRequirements([...byKey.values()]),
  }
}

export function readAppEnvContract(record: Record<string, unknown>): AppEnvContractResult {
  if (!Object.prototype.hasOwnProperty.call(record, 'envContract')) {
    return { status: 'missing', value: null }
  }

  const normalized = normalizeAppEnvContractDefinition(record.envContract)
  return normalized
    ? { status: 'available', value: normalized }
    : { status: 'invalid', value: null }
}

/** @deprecated Use normalizeAppEnvContractDefinition. */
export const normalizeProvisionEnvContractDefinition = normalizeAppEnvContractDefinition
/** @deprecated Use extractAppEnvContractDefinition. */
export const extractProvisionAppManagedEnvContractDefinition = extractAppEnvContractDefinition
/** @deprecated Use readAppEnvContract. */
export const readProvisionEnvContract = readAppEnvContract
