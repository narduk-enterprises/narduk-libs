/**
 * Layer bundle manifest.
 *
 * A "layer bundle" is the installable package axis: the thing an app takes a dependency
 * on and extends in its `nuxt.config.ts`. Each layer declares which `ModuleId`s it
 * brings in. Env keys are never listed here; they are derived from
 * `listKeysForModules(layer.providesModules)`.
 *
 * If you want to add env keys, add them to `env-catalog.ts` and tag them with the
 * module their layer already provides. If you want a new capability that groups
 * several keys, add a `ModuleId` and add the keys to the module there.
 */
import { type FleetModuleId, type ModuleId, listKeysForModules } from './env-catalog'

export const OPTIONAL_LAYER_BUNDLE_IDS = [
  'seo',
  'auth',
  'operator',
  'analytics',
  'ingestion',
  'ai',
  'maps',
  'uploads',
  'pwa',
] as const
export const LAYER_BUNDLE_IDS = ['core', ...OPTIONAL_LAYER_BUNDLE_IDS] as const

export type OptionalLayerBundleId = (typeof OPTIONAL_LAYER_BUNDLE_IDS)[number]
export type LayerBundleId = (typeof LAYER_BUNDLE_IDS)[number]

export type TemplateLayerSelection = { mode: 'bundled'; bundles: OptionalLayerBundleId[] }
export type StrictTemplateLayerSelectionInput = {
  mode?: unknown
  bundles?: unknown
}

export interface LayerBundleDefinition {
  id: LayerBundleId
  packageName: string
  description: string
  optional: boolean
  hasDrizzlePayload: boolean
  requiredAppDependencies: string[]
  /** Modules this layer installs. The env contract is derived from these. */
  providesModules: readonly FleetModuleId[]
}

export const LAYER_BUNDLE_MANIFEST: Record<LayerBundleId, LayerBundleDefinition> = {
  core: {
    id: 'core',
    packageName: '@narduk-enterprises/narduk-nuxt-template-layer-core',
    description: 'Core UI, worker runtime, database helpers, and shared utilities.',
    optional: false,
    hasDrizzlePayload: true,
    requiredAppDependencies: ['@iconify-json/lucide'],
    providesModules: ['site', 'session', 'cf-builds', 'gh-packages'],
  },
  seo: {
    id: 'seo',
    packageName: '@narduk-enterprises/narduk-nuxt-template-layer-seo',
    description: 'Public SEO, Schema.org, and Open Graph helpers for SSR apps.',
    optional: true,
    hasDrizzlePayload: false,
    requiredAppDependencies: [],
    providesModules: ['og-image'],
  },
  auth: {
    id: 'auth',
    packageName: '@narduk-enterprises/narduk-nuxt-template-layer-auth',
    description: 'Auth, user session, and protected-route capabilities.',
    optional: true,
    hasDrizzlePayload: true,
    requiredAppDependencies: [],
    providesModules: ['supabase', 'auth-config'],
  },
  operator: {
    id: 'operator',
    packageName: '@narduk-enterprises/narduk-nuxt-template-layer-operator',
    description: 'Operator-console shell, tables, and admin workspace primitives.',
    optional: true,
    hasDrizzlePayload: false,
    requiredAppDependencies: [],
    providesModules: [],
  },
  analytics: {
    id: 'analytics',
    packageName: '@narduk-enterprises/narduk-nuxt-template-layer-analytics',
    description: 'PostHog, GA, Search Console, and IndexNow helpers.',
    optional: true,
    hasDrizzlePayload: false,
    requiredAppDependencies: [],
    providesModules: ['posthog', 'ga', 'search-console', 'indexnow'],
  },
  ingestion: {
    id: 'ingestion',
    packageName: '@narduk-enterprises/narduk-nuxt-template-layer-ingestion',
    description: 'Scheduled ingestion dispatch, cron routes, and run ledger helpers.',
    optional: true,
    hasDrizzlePayload: true,
    requiredAppDependencies: [],
    providesModules: ['ingestion'],
  },
  ai: {
    id: 'ai',
    packageName: '@narduk-enterprises/narduk-nuxt-template-layer-ai',
    description: 'Shared AI runtime utilities, system prompts, and admin model controls.',
    optional: true,
    hasDrizzlePayload: true,
    requiredAppDependencies: [],
    providesModules: ['xai'],
  },
  maps: {
    id: 'maps',
    packageName: '@narduk-enterprises/narduk-nuxt-template-layer-maps',
    description: 'Apple Maps and map-kit helpers.',
    optional: true,
    hasDrizzlePayload: false,
    requiredAppDependencies: [],
    providesModules: ['apple-maps'],
  },
  uploads: {
    id: 'uploads',
    packageName: '@narduk-enterprises/narduk-nuxt-template-layer-uploads',
    description: 'R2 upload and image delivery helpers.',
    optional: true,
    hasDrizzlePayload: false,
    requiredAppDependencies: [],
    providesModules: ['r2-uploads'],
  },
  pwa: {
    id: 'pwa',
    packageName: '@narduk-enterprises/narduk-nuxt-template-layer-pwa',
    description: 'Installable PWA shell, service worker, and offline fallback.',
    optional: true,
    hasDrizzlePayload: false,
    requiredAppDependencies: [],
    providesModules: [],
  },
}

export const DEFAULT_TEMPLATE_LAYER_SELECTION: TemplateLayerSelection = {
  mode: 'bundled',
  bundles: [],
}

export function isKnownOptionalLayerBundleId(value: string): value is OptionalLayerBundleId {
  return OPTIONAL_LAYER_BUNDLE_IDS.includes(value as OptionalLayerBundleId)
}

export function ensureOptionalLayerBundleOrder(
  bundles: readonly OptionalLayerBundleId[],
): OptionalLayerBundleId[] {
  return OPTIONAL_LAYER_BUNDLE_IDS.filter((bundleId) => bundles.includes(bundleId))
}

export function createBundledLayerSelection(
  bundles: readonly OptionalLayerBundleId[],
): TemplateLayerSelection {
  return {
    mode: 'bundled',
    bundles: ensureOptionalLayerBundleOrder(bundles),
  }
}

export function normalizeTemplateLayerSelection(
  selection:
    TemplateLayerSelection | { mode?: string; bundles?: string[] } | string | null | undefined,
): TemplateLayerSelection {
  if (selection == null) {
    return DEFAULT_TEMPLATE_LAYER_SELECTION
  }

  if (typeof selection === 'string') {
    return DEFAULT_TEMPLATE_LAYER_SELECTION
  }

  if (selection.mode !== 'bundled') {
    return DEFAULT_TEMPLATE_LAYER_SELECTION
  }

  const bundles = Array.isArray(selection.bundles)
    ? selection.bundles.reduce<OptionalLayerBundleId[]>((accumulator, bundle) => {
        if (isKnownOptionalLayerBundleId(bundle)) {
          accumulator.push(bundle)
        }
        return accumulator
      }, [])
    : []

  return createBundledLayerSelection(bundles)
}

function formatKnownOptionalLayerBundleIds(): string {
  return OPTIONAL_LAYER_BUNDLE_IDS.join(', ')
}

function formatUnknownLayerBundleValue(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  try {
    const serialized = JSON.stringify(value)
    if (serialized != null) {
      return serialized
    }
  } catch {
    // Fall back to String(value) for non-serializable values.
  }

  return String(value)
}

export function parseStrictOptionalLayerBundles(value: string): OptionalLayerBundleId[] {
  const rawBundles = value
    .split(',')
    .map((bundle) => bundle.trim())
    .filter(Boolean)

  const unknownBundles = rawBundles.filter((bundle) => !isKnownOptionalLayerBundleId(bundle))
  if (unknownBundles.length > 0) {
    throw new Error(
      `Unknown template layer bundle: ${unknownBundles.join(', ')} (expected one of: ${formatKnownOptionalLayerBundleIds()})`,
    )
  }

  return ensureOptionalLayerBundleOrder([...new Set(rawBundles as OptionalLayerBundleId[])])
}

export function validateStrictTemplateLayerSelection(
  selection: StrictTemplateLayerSelectionInput,
): TemplateLayerSelection {
  if (selection.mode !== 'bundled') {
    throw new Error('Invalid template layer selection: mode must be "bundled"')
  }

  if (!Array.isArray(selection.bundles)) {
    throw new Error('Invalid template layer selection: bundles must be an array')
  }

  const unknownBundles = selection.bundles.filter(
    (bundle) => typeof bundle !== 'string' || !isKnownOptionalLayerBundleId(bundle),
  )
  if (unknownBundles.length > 0) {
    throw new Error(
      `Unknown template layer bundle: ${unknownBundles.map(formatUnknownLayerBundleValue).join(', ')} (expected one of: ${formatKnownOptionalLayerBundleIds()})`,
    )
  }

  return createBundledLayerSelection([...new Set(selection.bundles as OptionalLayerBundleId[])])
}

export function parseStrictTemplateLayerSelectionJson(value: string): TemplateLayerSelection {
  if (!value.trim()) {
    throw new Error('Invalid template layer selection: JSON value is required')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid template layer selection JSON: ${error.message}`)
    }

    throw error
  }

  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid template layer selection: expected an object')
  }

  return validateStrictTemplateLayerSelection(parsed as StrictTemplateLayerSelectionInput)
}

export function parseTemplateLayerSelectionJson(
  value: string | null | undefined,
): TemplateLayerSelection {
  if (!value?.trim()) return DEFAULT_TEMPLATE_LAYER_SELECTION

  try {
    const parsed = JSON.parse(value) as
      TemplateLayerSelection | { mode?: string; bundles?: string[] }
    return normalizeTemplateLayerSelection(parsed)
  } catch (error) {
    if (error instanceof SyntaxError) {
      return DEFAULT_TEMPLATE_LAYER_SELECTION
    }

    throw error
  }
}

export function parseOptionalLayerBundles(value: string): OptionalLayerBundleId[] {
  const bundles = value
    .split(',')
    .map((bundle) => bundle.trim())
    .filter(isKnownOptionalLayerBundleId)

  return ensureOptionalLayerBundleOrder([...new Set(bundles)])
}

export function parseOptionalLayerBundleArgs(
  value: string | null | undefined,
): TemplateLayerSelection {
  if (!value?.trim()) {
    return DEFAULT_TEMPLATE_LAYER_SELECTION
  }

  return createBundledLayerSelection(parseOptionalLayerBundles(value))
}

export function getLayerBundleDefinition(bundleId: LayerBundleId = 'core') {
  return LAYER_BUNDLE_MANIFEST[bundleId]
}

export function getLayerBundlePackageName(bundleId: LayerBundleId = 'core') {
  return getLayerBundleDefinition(bundleId).packageName
}

export function getLayerBundleByPackageName(packageName: string): LayerBundleDefinition | null {
  const normalized = packageName.trim()
  if (!normalized) return null

  return (
    Object.values(LAYER_BUNDLE_MANIFEST).find((bundle) => bundle.packageName === normalized) ?? null
  )
}

export function listLayerBundleDefinitions(): LayerBundleDefinition[] {
  return Object.values(LAYER_BUNDLE_MANIFEST)
}

/** All modules a given selection brings in, including the mandatory core layer. */
export function listProvidedModules(
  selection:
    TemplateLayerSelection | { mode?: string; bundles?: string[] } | string | null | undefined,
): FleetModuleId[] {
  const normalized = normalizeTemplateLayerSelection(selection)
  const bundleIds: LayerBundleId[] = ['core', ...normalized.bundles]
  const seen = new Set<FleetModuleId>()
  for (const bundleId of bundleIds) {
    for (const moduleId of LAYER_BUNDLE_MANIFEST[bundleId].providesModules) {
      seen.add(moduleId)
    }
  }
  return Array.from(seen)
}

/** Convenience: the full env-key set installed by a selection. */
export function listRequiredEnvKeys(
  selection:
    TemplateLayerSelection | { mode?: string; bundles?: string[] } | string | null | undefined,
): string[] {
  const modules = listProvidedModules(selection)
  return listKeysForModules(modules as readonly ModuleId[]).sort((left, right) =>
    left.localeCompare(right),
  )
}

export function resolveSelectedOptionalBundles(
  selection:
    TemplateLayerSelection | { mode?: string; bundles?: string[] } | string | null | undefined,
): OptionalLayerBundleId[] {
  return normalizeTemplateLayerSelection(selection).bundles
}

export function resolveSelectedLayerPackageNames(
  selection:
    TemplateLayerSelection | { mode?: string; bundles?: string[] } | string | null | undefined,
): string[] {
  const normalized = normalizeTemplateLayerSelection(selection)

  return [
    LAYER_BUNDLE_MANIFEST.core.packageName,
    ...normalized.bundles.map((bundleId) => LAYER_BUNDLE_MANIFEST[bundleId].packageName),
  ]
}

export function resolveSelectedLayerDrizzlePackageNames(
  selection:
    TemplateLayerSelection | { mode?: string; bundles?: string[] } | string | null | undefined,
): string[] {
  const normalized = normalizeTemplateLayerSelection(selection)
  const bundleIds: LayerBundleId[] = ['core', ...normalized.bundles]

  return bundleIds
    .filter((bundleId) => LAYER_BUNDLE_MANIFEST[bundleId].hasDrizzlePayload)
    .map((bundleId) => LAYER_BUNDLE_MANIFEST[bundleId].packageName)
}

export function resolvePrimaryLayerPackageName(
  selection:
    TemplateLayerSelection | { mode?: string; bundles?: string[] } | string | null | undefined,
): string {
  return resolveSelectedLayerPackageNames(selection)[0] || LAYER_BUNDLE_MANIFEST.core.packageName
}

export function resolveRequiredAppDependencies(
  selection:
    TemplateLayerSelection | { mode?: string; bundles?: string[] } | string | null | undefined,
): string[] {
  const normalized = normalizeTemplateLayerSelection(selection)
  const bundleIds: LayerBundleId[] = ['core', ...normalized.bundles]

  const dependencies = bundleIds.flatMap(
    (bundleId) => LAYER_BUNDLE_MANIFEST[bundleId].requiredAppDependencies,
  )

  return dependencies.filter((dependency, index) => dependencies.indexOf(dependency) === index)
}
