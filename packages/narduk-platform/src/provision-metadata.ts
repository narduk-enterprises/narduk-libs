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

export interface ProvisionMetadata {
  name: string | null
  displayName: string | null
  shortName: string | null
  description: string | null
  url: string | null
  localDevNuxtPort: number | null
}

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

const EMPTY_METADATA: ProvisionMetadata = {
  name: null,
  displayName: null,
  shortName: null,
  description: null,
  url: null,
  localDevNuxtPort: null,
}

/**
 * Reads app metadata from `apps/web/package.json`. `provision.json` has been
 * retired; the package manifest is the single source of truth for app name,
 * description, and URL. Name kept for call-site compatibility.
 */
export function readProvisionMetadata(rootDir: string): ProvisionMetadata {
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
    // to manifest/sync/drift tooling instead of silently displaying "web".
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
  provision: ProvisionMetadata,
  fallback: number,
  options: {
    preferPlaywrightPort?: boolean
  } = {},
) {
  if (options.preferPlaywrightPort) {
    return (
      normalizePort(env.PLAYWRIGHT_PORT) ??
      normalizePort(env.NUXT_PORT) ??
      provision.localDevNuxtPort ??
      fallback
    )
  }

  return normalizePort(env.NUXT_PORT) ?? provision.localDevNuxtPort ?? fallback
}

export function getProvisionDisplayName(provision: ProvisionMetadata, fallback: string): string {
  return provision.displayName || provision.name || fallback
}

export function getProvisionShortName(provision: ProvisionMetadata, fallback: string): string {
  return provision.shortName || provision.displayName || provision.name || fallback
}

export function parseProvisionMetadata(raw: Record<string, unknown>): ProvisionMetadata {
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

export function emptyProvisionMetadata(): ProvisionMetadata {
  return {
    name: null,
    displayName: null,
    shortName: null,
    description: null,
    url: null,
    localDevNuxtPort: null,
  }
}
