/**
 * CSP contribution point for downstream Nuxt modules (narduk-libs#410).
 *
 * narduk-core resolves and installs the estate policy inside `setup()`. The
 * only app-owned allowlist is `nardukCore.security.headers.allow`, and a
 * module that mutates that option after core has already run is a silent
 * no-op. This hook is the extension point: fire `narduk-core:csp` with a
 * mutable allowlist, merge what arrived, then at `modules:done` fire it
 * again and fail the build if a late listener added sources that missed
 * the merge.
 *
 * The published package entry (`src/module-entry.ts`) applies this immediately
 * before the existing `src/module.ts` setup, so the install site itself does
 * not have to change.
 */
import type {
  SecurityHeadersAllowlist,
  SecurityHeadersOptions,
} from '../runtime/shared/security-headers'

export const CSP_ALLOW_DIRECTIVES = [
  'connect',
  'font',
  'frame',
  'img',
  'media',
  'script',
  'style',
  'worker',
] as const satisfies ReadonlyArray<keyof SecurityHeadersAllowlist>

export type CspAllowDirective = (typeof CSP_ALLOW_DIRECTIVES)[number]

export type MutableSecurityHeadersAllowlist = {
  [K in CspAllowDirective]: string[]
}

export const CSP_LATE_CONTRIBUTION_ERROR =
  '@narduk-enterprises/narduk-core: a narduk-core:csp contribution arrived after the ' +
  'policy was resolved and was not merged. Register the hook from the contributing ' +
  "module's `hooks` option (so it is in place before narduk-core setup), or list that " +
  'module before @narduk-enterprises/narduk-core in `nuxt.config` modules ' +
  '(narduk-libs#410).'

export interface CspContributionHost {
  security?: {
    headers?: SecurityHeadersOptions | boolean
  }
}

export interface CspContributionNuxt {
  callHook(name: string, ...args: unknown[]): unknown
  hook(name: string, handler: (...args: never[]) => unknown): unknown
}

export function createMutableCspAllow(): MutableSecurityHeadersAllowlist {
  return {
    connect: [],
    font: [],
    frame: [],
    img: [],
    media: [],
    script: [],
    style: [],
    worker: [],
  }
}

function snapshotAllow(allow: MutableSecurityHeadersAllowlist): string {
  const record: Record<CspAllowDirective, string[]> = {
    connect: [],
    font: [],
    frame: [],
    img: [],
    media: [],
    script: [],
    style: [],
    worker: [],
  }
  for (const key of CSP_ALLOW_DIRECTIVES) {
    record[key] = [...allow[key]].sort()
  }
  return JSON.stringify(record)
}

function hasContributedSources(allow: MutableSecurityHeadersAllowlist): boolean {
  return CSP_ALLOW_DIRECTIVES.some((key) => allow[key].length > 0)
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

export function mergeCspAllow(
  existing: SecurityHeadersAllowlist | undefined,
  contributed: MutableSecurityHeadersAllowlist,
): SecurityHeadersAllowlist {
  const merged: SecurityHeadersAllowlist = { ...existing }
  for (const key of CSP_ALLOW_DIRECTIVES) {
    const values = dedupe([...(existing?.[key] ?? []), ...contributed[key]])
    if (values.length > 0) merged[key] = values
  }
  return merged
}

function readExistingAllow(
  headers: SecurityHeadersOptions | boolean | undefined,
): SecurityHeadersAllowlist | undefined {
  if (!headers || headers === true) return undefined
  return headers.allow
}

function assignAllow(options: CspContributionHost, allow: SecurityHeadersAllowlist): void {
  const security = options.security ?? (options.security = {})
  const headers = security.headers
  if (headers === true) {
    security.headers = { enabled: true, allow }
    return
  }
  if (headers === false) {
    security.headers = { enabled: false, allow }
    return
  }
  if (!headers) {
    security.headers = { allow }
    return
  }
  security.headers = { ...headers, allow }
}

export async function applyCspContributionPoint(
  options: CspContributionHost,
  nuxt: CspContributionNuxt,
): Promise<void> {
  const contributed = createMutableCspAllow()
  await nuxt.callHook('narduk-core:csp', contributed)
  if (hasContributedSources(contributed)) {
    assignAllow(options, mergeCspAllow(readExistingAllow(options.security?.headers), contributed))
  }
  const snapshot = snapshotAllow(contributed)
  nuxt.hook('modules:done', (async () => {
    const again = createMutableCspAllow()
    await nuxt.callHook('narduk-core:csp', again)
    if (snapshotAllow(again) !== snapshot) {
      throw new Error(CSP_LATE_CONTRIBUTION_ERROR)
    }
  }) as (...args: never[]) => unknown)
}

declare module '@nuxt/schema' {
  interface NuxtHooks {
    'narduk-core:csp': (allow: MutableSecurityHeadersAllowlist) => void | Promise<void>
  }
}
