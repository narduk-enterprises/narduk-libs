/**
 * Where an app actually deploys (narduk-libs#158).
 *
 * Item 1.1 used to treat every checkout as a Cloudflare Worker with a Nitro
 * `cloudflare_module` preset. A Coolify/node-server app and a hand-rolled
 * Worker with `worker.nitroPreset: "none"` both failed that check forever.
 *
 * `Config/project-lifecycle.json` `environments[].deploymentTargets[].provider`
 * is the declared list. When every named provider is non-Cloudflare, the
 * Workers-only sub-checks are not-applicable. `Config/coolify-app.json` without
 * `Config/cloudflare-app.json` is the same signal when the lifecycle file has
 * no targets yet. Mixed or undeclared platforms keep the existing Workers
 * rules.
 */

import { isRecord, parseJson, type AppRepo } from './source.js'

export const PROJECT_LIFECYCLE_FILE = 'Config/project-lifecycle.json'
export const COOLIFY_APP_FILE = 'Config/coolify-app.json'
export const CLOUDFLARE_APP_FILE = 'Config/cloudflare-app.json'

export type DeploymentPlatformKind = 'cloudflare' | 'mixed' | 'non-cloudflare' | 'undeclared'

export interface DeploymentPlatform {
  kind: DeploymentPlatformKind
  providers: readonly string[]
  evidence: string
}

export interface ExposureClassReading {
  value: string | null
  evidence: string
}

function isCloudflareProvider(provider: string): boolean {
  return provider === 'cloudflare' || provider === 'workers' || provider.startsWith('cloudflare')
}

function collectLifecycleProviders(repo: AppRepo): string[] {
  const lifecycle = parseJson(repo.read(PROJECT_LIFECYCLE_FILE))
  if (!isRecord(lifecycle) || !Array.isArray(lifecycle.environments)) return []
  const providers: string[] = []
  for (const env of lifecycle.environments) {
    if (!isRecord(env) || !Array.isArray(env.deploymentTargets)) continue
    for (const target of env.deploymentTargets) {
      if (!isRecord(target) || typeof target.provider !== 'string') continue
      const provider = target.provider.trim().toLowerCase()
      if (provider) providers.push(provider)
    }
  }
  return [...new Set(providers)]
}

export function classifyDeploymentPlatform(repo: AppRepo): DeploymentPlatform {
  const providers = collectLifecycleProviders(repo)
  if (providers.length > 0) {
    const cloudflare = providers.filter((provider) => isCloudflareProvider(provider))
    if (cloudflare.length > 0 && cloudflare.length < providers.length) {
      return { evidence: PROJECT_LIFECYCLE_FILE, kind: 'mixed', providers }
    }
    if (cloudflare.length > 0) {
      return { evidence: PROJECT_LIFECYCLE_FILE, kind: 'cloudflare', providers }
    }
    return { evidence: PROJECT_LIFECYCLE_FILE, kind: 'non-cloudflare', providers }
  }
  if (repo.exists(COOLIFY_APP_FILE) && !repo.exists(CLOUDFLARE_APP_FILE)) {
    return { evidence: COOLIFY_APP_FILE, kind: 'non-cloudflare', providers: ['coolify'] }
  }
  return { evidence: PROJECT_LIFECYCLE_FILE, kind: 'undeclared', providers: [] }
}

export function isNonCloudflareOnly(platform: DeploymentPlatform): boolean {
  return platform.kind === 'non-cloudflare'
}

function readAccessExposureClass(value: unknown): string | null {
  return isRecord(value) && isRecord(value.access) && typeof value.access.exposureClass === 'string'
    ? value.access.exposureClass
    : null
}

/** Public/private signal: cloudflare-app first, then coolify-app. */
export function readExposureClass(repo: AppRepo): ExposureClassReading {
  const fromCloudflare = readAccessExposureClass(parseJson(repo.read(CLOUDFLARE_APP_FILE)))
  if (fromCloudflare !== null) {
    return { evidence: CLOUDFLARE_APP_FILE, value: fromCloudflare }
  }
  const fromCoolify = readAccessExposureClass(parseJson(repo.read(COOLIFY_APP_FILE)))
  if (fromCoolify !== null) {
    return { evidence: COOLIFY_APP_FILE, value: fromCoolify }
  }
  return { evidence: `${CLOUDFLARE_APP_FILE} or ${COOLIFY_APP_FILE}`, value: null }
}
