/**
 * Bridge wrangler.json `vars` into the `nuxt build` environment.
 *
 * Workers Builds injects Worker secrets at runtime only. It does not export
 * `wrangler.json` / `wrangler.jsonc` `vars` into the build process, so
 * `process.env.NUXT_PUBLIC_*` (and the other public keys apps read in
 * `nuxt.config`) is empty on that path. Fleet apps were hand-rolling a reader
 * (buoys `server/utils/public-runtime-from-wrangler.ts`); this is that reader
 * (narduk-libs#516).
 *
 * Call `applyWranglerVarsToEnv()` at the top of `nuxt.config.ts` so existing
 * `process.env` reads — including narduk-core's `NUXT_PUBLIC_ALLOW_GEOLOCATION`
 * — see the wrangler values. Spread `publicRuntimeFromWrangler()` into
 * `runtimeConfig.public` for keys the app has not already declared.
 *
 * Already-set environment values (Workers Builds build variables, CI, local)
 * always win. Secret-named vars are applied to the build env and never copied
 * into the public object.
 */

import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

import { parse, printParseErrorCode, type ParseError } from 'jsonc-parser'

export interface WranglerPublicRuntimeOptions {
  /** Directory to search for wrangler.jsonc / wrangler.json. Defaults to cwd. */
  cwd?: string
  /** Explicit config path. Relative paths resolve against `cwd`. */
  wranglerPath?: string
  /**
   * Environment overlay. Defaults to `process.env`. Keys already present win
   * over wrangler `vars`.
   */
  env?: NodeJS.ProcessEnv
  /**
   * Named wrangler `env.<name>.vars` overlay. Defaults to
   * `NUXT_WRANGLER_ENVIRONMENT` on `env`.
   */
  wranglerEnv?: string
}

const WRANGLER_FILENAMES = ['wrangler.jsonc', 'wrangler.json'] as const
const NUXT_PUBLIC_PREFIX = 'NUXT_PUBLIC_'
const TRUTHY = new Set(['1', 'true', 'yes', 'on'])
const FALSY = new Set(['0', 'false', 'no', 'off'])
const SECRET_NAME = /(?:^|_)(?:secret|password|passwd|token|private[_-]?key|credential)s?$/iu

const PUBLIC_STRING_VARS: Readonly<Record<string, readonly string[]>> = {
  SITE_URL: ['siteUrl', 'appUrl'],
  POSTHOG_PUBLIC_KEY: ['posthogPublicKey'],
  POSTHOG_HOST: ['posthogHost'],
  GA_MEASUREMENT_ID: ['gaMeasurementId'],
  PUBLIC_CATALOG_BASE_URL: ['publicCatalogBaseUrl'],
  AUTH_BACKEND: ['authBackend'],
  APP_BACKEND_PRESET: ['appBackendPreset'],
  AUTH_AUTHORITY_URL: ['authAuthorityUrl'],
  SUPABASE_URL: ['supabaseUrl'],
  SUPABASE_PUBLISHABLE_KEY: ['supabasePublishableKey'],
  SUPABASE_ANON_KEY: ['supabasePublishableKey'],
  AUTH_ANON_KEY: ['supabasePublishableKey'],
  TURNSTILE_SITE_KEY: ['authTurnstileSiteKey'],
  ANALYTICS_LOAD_STRATEGY: ['analyticsLoadStrategy'],
  NARDUK_DEPLOY_TARGET: ['deploymentTarget'],
  CANONICAL_REDIRECT_HOSTS: ['canonicalRedirectHosts'],
  CSP_SCRIPT_SRC: ['cspScriptSrc'],
  CSP_CONNECT_SRC: ['cspConnectSrc'],
  CSP_FRAME_SRC: ['cspFrameSrc'],
  CSP_WORKER_SRC: ['cspWorkerSrc'],
  CSP_MEDIA_SRC: ['cspMediaSrc'],
}

const BOOLEAN_PUBLIC_KEYS = new Set([
  'allowGeolocation',
  'previewSafeMode',
  'posthogDeadClicksEnabled',
  'posthogExternalDependencyLoadingEnabled',
  'posthogFeatureFlagsEnabled',
  'posthogSessionReplayEnabled',
  'posthogSurveysEnabled',
  'authPublicSignup',
  'authRequireMfa',
  'enforceCanonicalHost',
  'authEnforceCanonicalHost',
])

const PUBLIC_BOOLEAN_VARS: Readonly<Record<string, string>> = {
  NUXT_PUBLIC_ALLOW_GEOLOCATION: 'allowGeolocation',
  NARDUK_PREVIEW_SAFE_MODE: 'previewSafeMode',
  POSTHOG_DEAD_CLICKS_ENABLED: 'posthogDeadClicksEnabled',
  POSTHOG_EXTERNAL_DEPENDENCY_LOADING_ENABLED: 'posthogExternalDependencyLoadingEnabled',
  POSTHOG_FEATURE_FLAGS_ENABLED: 'posthogFeatureFlagsEnabled',
  POSTHOG_SESSION_REPLAY_ENABLED: 'posthogSessionReplayEnabled',
  POSTHOG_SURVEYS_ENABLED: 'posthogSurveysEnabled',
  AUTH_PUBLIC_SIGNUP: 'authPublicSignup',
  AUTH_REQUIRE_MFA: 'authRequireMfa',
  ENFORCE_CANONICAL_HOST: 'enforceCanonicalHost',
  AUTH_ENFORCE_CANONICAL_HOST: 'authEnforceCanonicalHost',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readJsonc(path: string): unknown {
  const errors: ParseError[] = []
  const value = parse(readFileSync(path, 'utf8'), errors, {
    allowEmptyContent: false,
    allowTrailingComma: true,
    disallowComments: false,
  })
  if (errors.length > 0) {
    const details = errors
      .map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`)
      .join(', ')
    throw new Error(`Could not parse Wrangler config ${path}: ${details}`)
  }
  return value
}

function readStringVars(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  const vars: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'string') {
      const trimmed = raw.trim()
      if (trimmed) vars[key] = raw
      continue
    }
    if (typeof raw === 'number' || typeof raw === 'boolean') vars[key] = String(raw)
  }
  return vars
}

function resolveWranglerPath(cwd: string, explicit?: string): string {
  if (explicit) {
    const path = isAbsolute(explicit) ? explicit : join(cwd, explicit)
    if (!existsSync(path)) {
      throw new Error(`Could not read Wrangler config ${path}`)
    }
    return path
  }
  for (const dir of [cwd, join(cwd, 'apps', 'web')]) {
    for (const filename of WRANGLER_FILENAMES) {
      const path = join(dir, filename)
      if (existsSync(path)) return path
    }
  }
  throw new Error(
    'Could not locate wrangler.jsonc or wrangler.json. Workers Builds does not export wrangler vars into `nuxt build`; pass wranglerPath or run from the app directory.',
  )
}

function wranglerVarsFromConfig(config: unknown, wranglerEnv?: string): Record<string, string> {
  if (!isRecord(config)) return {}
  const top = readStringVars(config.vars)
  if (!wranglerEnv) return top
  const environments = isRecord(config.env) ? config.env : undefined
  const named =
    environments && isRecord(environments[wranglerEnv]) ? environments[wranglerEnv] : undefined
  return { ...top, ...readStringVars(isRecord(named) ? named.vars : undefined) }
}

function resolveOptions(options: WranglerPublicRuntimeOptions = {}): {
  cwd: string
  env: NodeJS.ProcessEnv
  wranglerEnv?: string
  wranglerPath?: string
} {
  const cwd = options.cwd ?? process.cwd()
  const env = options.env ?? process.env
  const wranglerEnv = options.wranglerEnv ?? env.NUXT_WRANGLER_ENVIRONMENT?.trim()
  return {
    cwd,
    env,
    ...(wranglerEnv ? { wranglerEnv } : {}),
    ...(options.wranglerPath ? { wranglerPath: options.wranglerPath } : {}),
  }
}

function mergeVars(
  wranglerVars: Record<string, string>,
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  const merged: Record<string, string> = {}
  for (const [key, value] of Object.entries(wranglerVars)) {
    const existing = env[key]
    merged[key] = existing === undefined ? value : existing
  }
  return merged
}

function nuxtPublicKey(envName: string): string | undefined {
  if (!envName.startsWith(NUXT_PUBLIC_PREFIX)) return undefined
  const suffix = envName.slice(NUXT_PUBLIC_PREFIX.length)
  if (!suffix) return undefined
  return suffix
    .toLowerCase()
    .replaceAll(/_([a-z0-9])/gu, (_match, char: string) => char.toUpperCase())
}

function parseBoolean(value: string): boolean | undefined {
  const raw = value.trim().toLowerCase()
  if (TRUTHY.has(raw)) return true
  if (FALSY.has(raw)) return false
  return undefined
}

function isSecretName(name: string): boolean {
  return SECRET_NAME.test(name)
}

export function readWranglerVarsForBuild(
  options: WranglerPublicRuntimeOptions = {},
): Record<string, string> {
  const resolved = resolveOptions(options)
  const config = readJsonc(resolveWranglerPath(resolved.cwd, resolved.wranglerPath))
  return mergeVars(wranglerVarsFromConfig(config, resolved.wranglerEnv), resolved.env)
}

/**
 * Copy unset wrangler `vars` onto `env` (default `process.env`) so existing
 * `process.env.SITE_URL` / `process.env.NUXT_PUBLIC_*` reads in `nuxt.config`
 * and narduk-core see them during `nuxt build`.
 *
 * @returns The keys that were written.
 */
export function applyWranglerVarsToEnv(
  options: WranglerPublicRuntimeOptions = {},
): Record<string, string> {
  const resolved = resolveOptions(options)
  const config = readJsonc(resolveWranglerPath(resolved.cwd, resolved.wranglerPath))
  const wranglerVars = wranglerVarsFromConfig(config, resolved.wranglerEnv)
  const applied: Record<string, string> = {}
  for (const [key, value] of Object.entries(wranglerVars)) {
    if (resolved.env[key] !== undefined) continue
    resolved.env[key] = value
    applied[key] = value
  }
  return applied
}

export type PublicRuntimeValue = string | boolean

/**
 * Nuxt `runtimeConfig.public` keys derived from wrangler `vars` plus env.
 * `NUXT_PUBLIC_*` become camelCase. Known public Worker vars (`SITE_URL`,
 * `POSTHOG_PUBLIC_KEY`, …) map onto the narduk-core public overlay. Secret-named
 * keys are omitted.
 */
export function publicRuntimeFromWrangler(
  options: WranglerPublicRuntimeOptions = {},
): Record<string, PublicRuntimeValue> {
  const vars = readWranglerVarsForBuild(options)
  const publicRuntime: Record<string, PublicRuntimeValue> = {}

  const assign = (key: string, value: string) => {
    if (BOOLEAN_PUBLIC_KEYS.has(key)) {
      const parsed = parseBoolean(value)
      if (parsed !== undefined) publicRuntime[key] = parsed
      return
    }
    publicRuntime[key] = value
  }

  for (const [envName, value] of Object.entries(vars)) {
    if (isSecretName(envName)) continue
    const knownBoolean = PUBLIC_BOOLEAN_VARS[envName]
    if (knownBoolean) {
      assign(knownBoolean, value)
      continue
    }
    const knownStrings = PUBLIC_STRING_VARS[envName]
    if (knownStrings) {
      for (const key of knownStrings) assign(key, value)
    }
  }

  // NUXT_PUBLIC_* is the Nuxt-native spelling and wins over the Worker-var alias.
  for (const [envName, value] of Object.entries(vars)) {
    if (isSecretName(envName)) continue
    const key = nuxtPublicKey(envName)
    if (!key) continue
    assign(key, value)
  }

  return publicRuntime
}
