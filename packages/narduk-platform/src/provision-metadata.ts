import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface CloudflareWorkersBuildsSettings {
  rootDirectory: string
  buildCachingEnabled: boolean
  skipDependencyInstall: boolean
  requiredBuildSecrets: string[]
  requiredRuntimeVariables: string[]
  targets: {
    production: {
      branch: string
      environmentName: string
      buildCommand: string
      deployCommand: string
    }
  }
}

export interface AppOnboardingMetadata {
  name: string | null
  displayName: string | null
  shortName: string | null
  description: string | null
  url: string | null
  localDevNuxtPort: number | null
}

/** @deprecated Use AppOnboardingMetadata. */
export type ProvisionMetadata = AppOnboardingMetadata

export function getCloudflareWorkersBuildsSettings(): CloudflareWorkersBuildsSettings {
  return {
    rootDirectory: '/apps/web',
    buildCachingEnabled: true,
    skipDependencyInstall: true,
    requiredBuildSecrets: [
      'NARDUK_PLATFORM_GH_PACKAGES_READ',
      'NUXT_SESSION_PASSWORD',
      'NUXT_OG_IMAGE_SECRET',
    ],
    requiredRuntimeVariables: ['SITE_URL', 'NUXT_SESSION_PASSWORD', 'NUXT_OG_IMAGE_SECRET'],
    targets: {
      production: {
        branch: 'main',
        environmentName: 'production',
        buildCommand: 'pnpm run cf:build:production',
        deployCommand: 'pnpm run cf:deploy',
      },
    },
  }
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || /^__.+__$/.test(trimmed)) return null
  return trimmed
}

function normalizePort(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    return null
  }

  return parsed
}

const EMPTY_METADATA: AppOnboardingMetadata = {
  name: null,
  displayName: null,
  shortName: null,
  description: null,
  url: null,
  localDevNuxtPort: null,
}

/**
 * Reads app-owned onboarding metadata from `apps/web/package.json`. The package
 * manifest is the source of truth for app identity, URL, and local dev port.
 */
export function readAppOnboardingMetadata(rootDir: string): AppOnboardingMetadata {
  const packagePath = join(rootDir, 'apps', 'web', 'package.json')
  if (!existsSync(packagePath)) return EMPTY_METADATA

  try {
    const parsed = JSON.parse(readFileSync(packagePath, 'utf-8')) as Record<string, unknown>
    const narduk =
      typeof parsed.narduk === 'object' && parsed.narduk !== null
        ? (parsed.narduk as Record<string, unknown>)
        : {}

    // `apps/web/package.json.name` is always `"web"` in synced repos because
    // root scripts target `pnpm --filter web ...`. Resolve app identity from
    // the `narduk` block first; only fall back to `pkg.name` when it is a
    // meaningful value (i.e. *not* the fixture sentinel `"web"`). Returning
    // `null` for unbackfilled apps surfaces a real "missing metadata" signal
    // to onboarding/status tooling instead of silently displaying "web".
    const nardukShortName = normalizeText(narduk.shortName)
    const nardukDisplayName = normalizeText(narduk.displayName)
    const legacyName = normalizeText(parsed.name)
    const meaningfulLegacyName = legacyName === 'web' ? null : legacyName

    return {
      name: nardukShortName || nardukDisplayName || meaningfulLegacyName,
      displayName: nardukDisplayName || nardukShortName || meaningfulLegacyName,
      shortName: nardukShortName || nardukDisplayName,
      description: normalizeText(parsed.description),
      url: normalizeText(narduk.url) || normalizeText((parsed.homepage as unknown) ?? null),
      localDevNuxtPort: normalizePort(narduk.localDevNuxtPort),
    }
  } catch {
    return EMPTY_METADATA
  }
}

export function resolveLocalNuxtPort(
  env: Record<string, string | undefined>,
  metadata: AppOnboardingMetadata,
  fallback: number,
  options: {
    preferPlaywrightPort?: boolean
  } = {},
) {
  if (options.preferPlaywrightPort) {
    return (
      normalizePort(env.PLAYWRIGHT_PORT) ??
      normalizePort(env.NUXT_PORT) ??
      metadata.localDevNuxtPort ??
      fallback
    )
  }

  return normalizePort(env.NUXT_PORT) ?? metadata.localDevNuxtPort ?? fallback
}

export function getAppDisplayName(metadata: AppOnboardingMetadata, fallback: string): string {
  return metadata.displayName || metadata.name || fallback
}

export function getAppShortName(metadata: AppOnboardingMetadata, fallback: string): string {
  return metadata.shortName || metadata.displayName || metadata.name || fallback
}

export function parseAppOnboardingMetadata(raw: Record<string, unknown>): AppOnboardingMetadata {
  const localDev =
    typeof raw.localDev === 'object' && raw.localDev !== null
      ? (raw.localDev as Record<string, unknown>)
      : null

  return {
    name: normalizeText(raw.name),
    displayName: normalizeText(raw.displayName),
    shortName: normalizeText(raw.shortName),
    description: normalizeText(raw.description),
    url: normalizeText(raw.url),
    localDevNuxtPort: normalizePort(localDev?.nuxtPort),
  }
}

export function emptyAppOnboardingMetadata(): AppOnboardingMetadata {
  return {
    name: null,
    displayName: null,
    shortName: null,
    description: null,
    url: null,
    localDevNuxtPort: null,
  }
}

/** @deprecated Use readAppOnboardingMetadata. */
export const readProvisionMetadata = readAppOnboardingMetadata
/** @deprecated Use getAppDisplayName. */
export const getProvisionDisplayName = getAppDisplayName
/** @deprecated Use getAppShortName. */
export const getProvisionShortName = getAppShortName
/** @deprecated Use parseAppOnboardingMetadata. */
export const parseProvisionMetadata = parseAppOnboardingMetadata
/** @deprecated Use emptyAppOnboardingMetadata. */
export const emptyProvisionMetadata = emptyAppOnboardingMetadata
