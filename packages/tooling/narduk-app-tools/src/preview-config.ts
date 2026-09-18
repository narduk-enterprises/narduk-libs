/**
 * The preview wrangler config -- deployment-standard design §3.3 option A
 * (narduk-libs#473).
 *
 * Why this exists. A Worker version captures its binding configuration but not
 * the state behind it, and `preview_database_id` / `preview_id` /
 * `preview_bucket_name` are `wrangler dev` only (§3.2). So a non-production
 * branch build that uploads with the production config binds production D1, KV
 * and R2, and every pull request writes production data.
 *
 * What it does. `deployment.previewBindings` in `Config/cloudflare-app.json`
 * names, per production binding, the preview resource that replaces it, using
 * wrangler's own field names: `id` for KV, `database_id` + `database_name` for
 * D1, `bucket_name` for R2. `narduk-app deploy versions-upload` on a
 * non-production branch calls `planPreviewConfig` and, when it is `ready`,
 * uploads with `.wrangler.deploy.preview.json` instead of the production file.
 *
 * One function, two callers. The build and conformance item 12.4 both call
 * `planPreviewConfig`, so a PASS from 12.4 is a statement about the exact config
 * the build would upload, not about a declaration.
 *
 * All or nothing. A preview that rebinds some bindings and leaves others on
 * production is worse than either extreme: it reads preview data and writes
 * production caches under the same keys. So the plan is `ready` only when every
 * binding is rebound, and anything short of that leaves the production config
 * in place, loudly.
 */

import {
  PREVIEW_BINDING_KINDS,
  previewBindingName,
  type DeploymentBlock,
  type PreviewBindingEntry,
  type PreviewBindingKind,
} from './deployment-config.js'

export const PREVIEW_CONFIG_FILENAME = '.wrangler.deploy.preview.json'

interface KindFields {
  /** The wrangler key holding this kind's bindings. */
  block: string
  /** The fields that name the resource. Every one must come from the preview
   * entry, and none may equal a production value. */
  resource: readonly string[]
}

/** Wrangler's own field names, so a preview entry reads like the binding it
 * replaces. D1 carries its name as well as its id: `wrangler d1` commands
 * resolve a database by name, and a production name left on a preview binding
 * would point those commands at production. */
export const PREVIEW_RESOURCE_FIELDS: Record<PreviewBindingKind, KindFields> = {
  d1: { block: 'd1_databases', resource: ['database_id', 'database_name'] },
  kv: { block: 'kv_namespaces', resource: ['id'] },
  r2: { block: 'r2_buckets', resource: ['bucket_name'] },
}

export type PreviewBindings = DeploymentBlock['previewBindings']

export type PreviewPlanStatus =
  /** The config binds no D1/KV/R2 binding: nothing to isolate. */
  | 'no-bindings'
  /** Every binding is rebound to a resource that is not a production one. */
  | 'ready'
  /** A binding has no preview entry at all. */
  | 'uncovered'
  /** A preview entry names a production resource. */
  | 'unsafe'
  /** Every binding has an entry, but at least one carries no resource id --
   * "declared, not enforced". */
  | 'declared-only'

export interface PreviewConfigPlan {
  status: PreviewPlanStatus
  /** The config to upload. Present only when `status` is `ready`. */
  config: Record<string, unknown> | null
  /** `kind:BINDING -> resource`, one per rebound binding. */
  rebound: string[]
  /** `kind:BINDING` with no preview entry. */
  uncovered: string[]
  /** `kind:BINDING` whose entry names no preview resource. */
  declaredOnly: string[]
  /** `kind:BINDING field=value`, where value is a production resource. */
  reused: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** Every scope of a wrangler config: the top level and each `env.*`. */
function scopesOf(config: unknown): Array<Record<string, unknown>> {
  if (!isRecord(config)) return []
  const scopes = [config]
  if (isRecord(config.env)) {
    for (const scope of Object.values(config.env)) if (isRecord(scope)) scopes.push(scope)
  }
  return scopes
}

/**
 * Every production resource value a config names, by kind and field, across
 * every scope. A preview entry may equal none of them: pointing a preview at
 * another binding's production namespace is still production data.
 */
export function productionResourceValues(
  ...configs: unknown[]
): Record<PreviewBindingKind, Set<string>> {
  const out: Record<PreviewBindingKind, Set<string>> = {
    d1: new Set(),
    kv: new Set(),
    r2: new Set(),
  }
  for (const config of configs) {
    for (const scope of scopesOf(config)) {
      for (const kind of PREVIEW_BINDING_KINDS) {
        const entries = scope[PREVIEW_RESOURCE_FIELDS[kind].block]
        if (!Array.isArray(entries)) continue
        for (const entry of entries) {
          if (!isRecord(entry)) continue
          for (const field of PREVIEW_RESOURCE_FIELDS[kind].resource) {
            const value = text(entry[field])
            if (value) out[kind].add(value)
          }
        }
      }
    }
  }
  return out
}

function entryFor(
  entries: readonly PreviewBindingEntry[],
  binding: string,
): PreviewBindingEntry | undefined {
  return entries.find((entry) => previewBindingName(entry) === binding)
}

/**
 * Plans the preview config for one flattened deploy config.
 *
 * `deployConfig` is what a production build would upload (the top-level
 * bindings are what a version binds). `sourceConfigs` are the committed
 * configs whose every scope counts as production for the reuse check; they
 * default to `deployConfig` itself.
 */
export function planPreviewConfig(
  deployConfig: Record<string, unknown>,
  previewBindings: PreviewBindings,
  sourceConfigs: unknown[] = [deployConfig],
): PreviewConfigPlan {
  const production = productionResourceValues(deployConfig, ...sourceConfigs)
  const config = JSON.parse(JSON.stringify(deployConfig)) as Record<string, unknown>
  const plan: PreviewConfigPlan = {
    status: 'no-bindings',
    config: null,
    rebound: [],
    uncovered: [],
    declaredOnly: [],
    reused: [],
  }
  let bindings = 0
  for (const kind of PREVIEW_BINDING_KINDS) {
    const { block, resource } = PREVIEW_RESOURCE_FIELDS[kind]
    const entries = config[block]
    if (!Array.isArray(entries)) continue
    for (const entry of entries) {
      if (!isRecord(entry)) continue
      const binding = text(entry.binding)
      if (!binding) continue
      bindings += 1
      const label = `${kind}:${binding}`
      const declared = entryFor(previewBindings[kind], binding)
      if (declared === undefined) {
        plan.uncovered.push(label)
        continue
      }
      const values = resource.map((field) => [
        field,
        typeof declared === 'string' ? null : text((declared as Record<string, unknown>)[field]),
      ])
      if (values.some(([, value]) => value === null)) {
        plan.declaredOnly.push(label)
        continue
      }
      const reused = values.filter(([, value]) => production[kind].has(value as string))
      if (reused.length > 0) {
        plan.reused.push(...reused.map(([field, value]) => `${label} ${field}=${value}`))
        continue
      }
      for (const [field, value] of values) entry[field as string] = value
      plan.rebound.push(`${label} -> ${values[0][1]}`)
    }
  }
  if (bindings === 0) return plan
  if (plan.uncovered.length > 0) plan.status = 'uncovered'
  else if (plan.reused.length > 0) plan.status = 'unsafe'
  else if (plan.declaredOnly.length > 0) plan.status = 'declared-only'
  else {
    plan.status = 'ready'
    plan.config = config
  }
  return plan
}

/** One line naming why a plan is not `ready`, for a build log or a verdict. */
export function describePreviewPlan(plan: PreviewConfigPlan): string {
  switch (plan.status) {
    case 'no-bindings':
      return 'the config binds no D1, KV or R2 binding, so there is nothing to isolate'
    case 'ready':
      return `every binding is rebound to a preview resource: ${plan.rebound.join(', ')}`
    case 'uncovered':
      return `deployment.previewBindings has no entry for ${plan.uncovered.join(', ')}`
    case 'unsafe':
      return `deployment.previewBindings names a production resource: ${plan.reused.join(', ')}`
    case 'declared-only':
      return (
        `deployment.previewBindings names ${plan.declaredOnly.join(', ')} without the preview ` +
        `resource (KV "id", D1 "database_id" and "database_name", R2 "bucket_name")`
      )
  }
}
