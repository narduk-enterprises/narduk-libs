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
 * The published package entry (`src/module-entry.ts`) fires the hook once,
 * after `defineNuxtModule`'s duplicate-install and compatibility checks would
 * pass, and hands the contribution to the existing `src/module.ts` through
 * its inline options, so the install site itself does not have to change.
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

/**
 * Fire `narduk-core:csp` once with a fresh mutable allowlist and register the
 * single `modules:done` check that fails the build when a listener added after
 * this call contributes sources that missed the merge. Call it exactly once per
 * install: every call fires the hook and registers another check.
 */
export async function collectCspContributions(
  nuxt: CspContributionNuxt,
): Promise<MutableSecurityHeadersAllowlist> {
  const contributed = createMutableCspAllow()
  await nuxt.callHook('narduk-core:csp', contributed)
  const snapshot = snapshotAllow(contributed)
  nuxt.hook('modules:done', (async () => {
    const again = createMutableCspAllow()
    await nuxt.callHook('narduk-core:csp', again)
    if (snapshotAllow(again) !== snapshot) {
      throw new Error(CSP_LATE_CONTRIBUTION_ERROR)
    }
  }) as (...args: never[]) => unknown)
  return contributed
}

/**
 * Collect contributions and merge them into already-resolved `options` in
 * place. Only for a caller that holds the options `setup()` will receive; the
 * published entry's `defineNuxtModule` path uses `withCspContributions`
 * instead, because resolved options must never be fed back through
 * `getOptions` (narduk-libs#850 review).
 */
export async function applyCspContributionPoint(
  options: CspContributionHost,
  nuxt: CspContributionNuxt,
): Promise<void> {
  const contributed = await collectCspContributions(nuxt)
  if (hasContributedSources(contributed)) {
    assignAllow(options, mergeCspAllow(readExistingAllow(options.security?.headers), contributed))
  }
}

/**
 * Return a shallow copy of the module's ORIGINAL inline options that carries
 * the contributed sources, for the published entry to hand to the unwrapped
 * module. `getOptions` then merges it with `nuxt.options.nardukCore` and the
 * defaults exactly once. defu puts inline values first and concatenates
 * arrays, so the contribution is appended to the app's allowlist rather than
 * replacing it, and no app array is merged twice.
 *
 * `effectiveHeaders` is `security.headers` as `getOptions` resolves it
 * without the contribution. When it is a boolean the copy restates it as
 * `enabled`, so a contribution never switches the preset on or off. One edge
 * is not preserved: an inline boolean that was shadowing an object
 * `nardukCore.security.headers` becomes an object, and defu then merges the
 * two.
 *
 * Returns `inlineOptions` itself, untouched, when nothing was contributed.
 */
export function withCspContributions<T extends CspContributionHost>(
  inlineOptions: T | undefined,
  effectiveHeaders: SecurityHeadersOptions | boolean | undefined,
  contributed: MutableSecurityHeadersAllowlist,
): T | undefined {
  if (!hasContributedSources(contributed)) return inlineOptions
  const inline = (inlineOptions ?? {}) as T
  const inlineHeaders = inline.security?.headers
  let headers: SecurityHeadersOptions
  if (inlineHeaders && typeof inlineHeaders === 'object') {
    headers = { ...inlineHeaders, allow: mergeCspAllow(inlineHeaders.allow, contributed) }
  } else if (typeof effectiveHeaders === 'boolean') {
    headers = { enabled: effectiveHeaders, allow: mergeCspAllow(undefined, contributed) }
  } else {
    headers = { allow: mergeCspAllow(undefined, contributed) }
  }
  return { ...inline, security: { ...inline.security, headers } }
}

declare module '@nuxt/schema' {
  interface NuxtHooks {
    'narduk-core:csp': (allow: MutableSecurityHeadersAllowlist) => void | Promise<void>
  }
}
