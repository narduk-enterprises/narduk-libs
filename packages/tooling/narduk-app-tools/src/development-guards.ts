/**
 * Decisions the development deploy loop takes before and after it moves
 * traffic: which changes take the gated route, whether a stale red `main`
 * blocks the deploy, whether a development-mode migration is expand-only, and
 * whether a failed deploy may roll back. Everything here is pure over records
 * and source bytes; callers own the provider and GitHub reads.
 */
import { existsSync } from 'node:fs'
import { join, posix } from 'node:path'

import type { ContractMigration } from './deployment-config.js'
import { DEFAULT_PROTECTED_PATHS, type DevelopmentConfig } from './development-config.js'
import type { DevelopmentReceipt } from './development-deploy.js'
import {
  repositoryKey,
  type ActivationRecord,
  type AppliedMigration,
} from './development-records.js'
import type { SourceEntry } from './development-source.js'
import { declarationDigest, readPrivateJson } from './development-state.js'
import { findDestructiveStatements, type DestructiveStatement } from './migration-compatibility.js'

// ─── protected paths ─────────────────────────────────────────────────────────

/** `**` spans directories, `*` and `?` stay inside one path segment. Anchored. */
export function globToRegExp(pattern: string): RegExp {
  let source = ''
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]
    if (char === '*' && pattern[index + 1] === '*') {
      const atSegmentStart = index === 0 || pattern[index - 1] === '/'
      if (atSegmentStart && pattern[index + 2] === '/') {
        source += '(?:.*/)?'
        index += 2
      } else {
        source += '.*'
        index += 1
      }
    } else if (char === '*') source += '[^/]*'
    else if (char === '?') source += '[^/]'
    else source += char.replace(/[.+^${}()|[\]\\]/gu, '\\$&')
  }
  return new RegExp(`^${source}$`, 'u')
}

/** The declared (or default) globs plus every migration directory. */
export function protectedPatterns(development: DevelopmentConfig): string[] {
  return [
    ...(development.protectedPaths ?? DEFAULT_PROTECTED_PATHS),
    ...development.migrationDirectories.map((directory) => `${directory.replace(/\/+$/u, '')}/**`),
  ]
}

export function matchProtectedPaths(
  paths: readonly string[],
  patterns: readonly string[],
): string[] {
  const expressions = patterns.map(globToRegExp)
  return paths.filter((path) => expressions.some((expression) => expression.test(path)))
}

function entryKey(entry: SourceEntry): string | undefined {
  if (entry.kind === 'deleted') return undefined
  return `${entry.kind}:${entry.digest ?? entry.link ?? ''}:${entry.mode}`
}

/** Paths added, removed or changed (bytes, link or mode) between two capture manifests. */
export function changedSourcePaths(base: readonly SourceEntry[], current: readonly SourceEntry[]) {
  const before = new Map(base.map((entry) => [entry.path, entryKey(entry)]))
  const after = new Map(current.map((entry) => [entry.path, entryKey(entry)]))
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((path) => before.get(path) !== after.get(path))
    .sort()
}

// Top-level Wrangler keys that declare bindings. `vars` is configuration, not a
// binding: a rollback restores the old version's values with its code.
const BINDING_KEYS = [
  'ai',
  'analytics_engine_datasets',
  'assets',
  'browser',
  'containers',
  'd1_databases',
  'dispatch_namespaces',
  'hyperdrive',
  'images',
  'kv_namespaces',
  'mtls_certificates',
  'pipelines',
  'queues',
  'r2_buckets',
  'secrets_store_secrets',
  'send_email',
  'services',
  'tail_consumers',
  'unsafe',
  'vectorize',
  'version_metadata',
  'workflows',
] as const
const DURABLE_OBJECT_KEYS = ['durable_objects', 'migrations'] as const

export interface BindingSurface {
  /** Digest of every binding declaration except Durable Objects. */
  bindings: string
  /** Digest of Durable Object bindings and their class migrations. */
  durableObjects: string
}

/** Stable digests of what a Worker version binds, top level and per `env`. */
export function bindingSurface(config: unknown): BindingSurface {
  const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  const pick = (source: Record<string, unknown>, keys: readonly string[]) =>
    Object.fromEntries(
      keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]),
    )
  const root = record(config)
  const environments = record(root.env)
  const surface = (keys: readonly string[]) =>
    declarationDigest({
      root: pick(root, keys),
      env: Object.fromEntries(
        Object.entries(environments).map(([name, value]) => [name, pick(record(value), keys)]),
      ),
    })
  return { bindings: surface(BINDING_KEYS), durableObjects: surface(DURABLE_OBJECT_KEYS) }
}

/** Human reasons a binding surface moved between two builds; empty when it did not. */
export function bindingChanges(
  id: string,
  before: BindingSurface | undefined,
  after: BindingSurface | undefined,
): string[] {
  if (!before || !after)
    return [`${id}: binding surface unknown (a receipt predates binding digests)`]
  const reasons: string[] = []
  if (before.durableObjects !== after.durableObjects)
    reasons.push(`${id}: Durable Object bindings or class migrations changed`)
  if (before.bindings !== after.bindings) reasons.push(`${id}: Worker bindings changed`)
  return reasons
}

// ─── red main ────────────────────────────────────────────────────────────────

export interface RedMainIssue {
  number: number
  title: string
  createdAt: string
}

export const RED_MAIN_GRACE_MS = 24 * 60 * 60 * 1000

/**
 * A `red-main` issue open longer than the grace period blocks deploy:dev unless
 * the deploy names it as the fix. Naming an issue that is not open and
 * labelled is refused, so the override cannot become a habit by typo.
 */
export function assessRedMain(
  issues: readonly RedMainIssue[],
  now: number,
  fix?: number,
): { stale: RedMainIssue[]; refusal?: string } {
  const stale = issues.filter((issue) => now - Date.parse(issue.createdAt) > RED_MAIN_GRACE_MS)
  if (fix !== undefined && !issues.some((issue) => issue.number === fix))
    return {
      stale,
      refusal: `--red-main-fix ${fix} names no open red-main issue; drop the flag or name one of: ${
        issues.map((issue) => `#${issue.number}`).join(', ') || '(none open)'
      }`,
    }
  if (stale.length && fix === undefined)
    return {
      stale,
      refusal: `main has been red for more than 24 h: ${stale
        .map((issue) => `#${issue.number} "${issue.title}" (opened ${issue.createdAt})`)
        .join('; ')}. Fix main first, or deploy the fix with --red-main-fix <issue number>`,
    }
  return { stale }
}

// ─── development-mode migrations (12.9) ──────────────────────────────────────

const DESTRUCTIVE_WORDING: Record<DestructiveStatement['kind'], string> = {
  'drop-table': 'drops table',
  'drop-view': 'drops view',
  'drop-column': 'drops a column of',
  'rename-table': 'renames table',
  'rename-column': 'renames a column of',
}

export interface MigrationAssessment {
  /**
   * SQL files this run may apply: not recorded as applied here with these
   * bytes, and not shipped by normal delivery before enrollment.
   */
  pending: string[]
  /** Pending files that drop or rename, each a reviewed contract migration on the production branch. */
  contract: string[]
  refusals: string[]
}

/**
 * The promote path's expand-only rule, applied to `exec --operation migration`.
 * A pending file that drops or renames what the serving Worker (or the version
 * a rollback would restore) still reads refuses, unless it is a reviewed
 * contract migration: declared under `deployment.migrations.contractMigrations`
 * with its exact checksum **and** already landed byte-identical on the
 * production branch. Contract migrations are reviewed on the gated path;
 * development mode never introduces one.
 */
export function assessDevelopmentMigrations(args: {
  files: ReadonlyArray<{ path: string; sha256: string }>
  applied: readonly AppliedMigration[]
  /**
   * Byte-identical on the production branch as fetched before the hold took
   * effect: normal delivery shipped it through the promote path's own 12.9
   * check. Anything that landed during the hold is judged here.
   */
  beforeEnrollment?: (path: string) => boolean
  read: (path: string) => string
  waivers: readonly ContractMigration[]
  landed: (path: string, sha256: string) => boolean
  productionBranch: string
}): MigrationAssessment {
  const applied = new Map<string, string>()
  for (const migration of args.applied)
    for (const file of migration.files) applied.set(file.path, file.sha256)
  const waived = new Map(
    args.waivers.map((waiver) => [posix.normalize(waiver.path), waiver.sha256]),
  )
  const assessment: MigrationAssessment = { pending: [], contract: [], refusals: [] }
  for (const file of args.files) {
    if (
      !file.path.toLowerCase().endsWith('.sql') ||
      applied.get(file.path) === file.sha256 ||
      args.beforeEnrollment?.(file.path)
    )
      continue
    assessment.pending.push(file.path)
    const destructive = findDestructiveStatements(args.read(file.path))
    if (!destructive.length) continue
    const statements = destructive
      .map(
        (found) => `${file.path}:${found.line} ${DESTRUCTIVE_WORDING[found.kind]} ${found.object}`,
      )
      .join('; ')
    if (waived.get(file.path) !== file.sha256) {
      assessment.refusals.push(
        `${statements}. Development-mode migrations are expand-only (12.9): add, backfill and switch code instead. A contract migration is reviewed on the gated path: land it on ${args.productionBranch} declared under deployment.migrations.contractMigrations as {"path":"${file.path}","sha256":"${file.sha256}","reason":"<why no serving or rollback-target version reads it>"}`,
      )
    } else if (!args.landed(file.path, file.sha256)) {
      assessment.refusals.push(
        `${file.path} is a declared contract migration that has not landed on ${args.productionBranch}; contract migrations take the gated path, never development mode`,
      )
    } else assessment.contract.push(file.path)
  }
  return assessment
}

// ─── rollback ────────────────────────────────────────────────────────────────

export type RollbackPlan =
  | { kind: 'rollback'; buildId: string; versions: Record<string, string> }
  | { kind: 'page'; buildId?: string; reasons: string[] }

export function developmentReceiptPath(
  stateDirectory: string,
  repository: string,
  buildId: string,
): string {
  return join(stateDirectory, 'receipts', repositoryKey(repository), buildId, 'receipt.json')
}

/**
 * Whether serving may move back to a known-good build. A Worker rollback
 * restores code and bindings, never a schema or a Durable Object migration, so
 * it refuses (pages) across a Durable Object change, a binding change, or any
 * migration applied since that build that is not proven expand-only.
 */
export function planDevelopmentRollback(args: {
  stateDirectory: string
  record: ActivationRecord
  targetBuildId: string | undefined
  components: readonly string[]
  current: Record<string, BindingSurface | undefined>
}): RollbackPlan {
  const { targetBuildId } = args
  if (!targetBuildId)
    return { kind: 'page', reasons: ['no verified build is recorded on this workstation'] }
  const path = developmentReceiptPath(args.stateDirectory, args.record.repository, targetBuildId)
  if (!existsSync(path))
    return {
      kind: 'page',
      buildId: targetBuildId,
      reasons: [`receipt for ${targetBuildId} is gone`],
    }
  const target = readPrivateJson(path) as DevelopmentReceipt
  if (target.outcome !== 'verified' && target.outcome !== 'awaiting-owner')
    return {
      kind: 'page',
      buildId: targetBuildId,
      reasons: [`${targetBuildId} ended ${target.outcome}, not verified`],
    }
  const reasons: string[] = []
  const versions: Record<string, string> = {}
  for (const id of args.components) {
    const version = target.components[id]?.servingVersionId
    if (!version) reasons.push(`${id}: ${targetBuildId} recorded no serving version`)
    else versions[id] = version
    reasons.push(...bindingChanges(id, target.components[id]?.bindings, args.current[id]))
  }
  const since = target.updatedAt
  for (const migration of args.record.appliedMigrations) {
    if (migration.appliedAt <= since) continue
    if (migration.compatibility !== 'expand-only')
      reasons.push(
        `migration ${migration.commit.slice(0, 12)} applied after ${targetBuildId} is ${
          migration.compatibility === 'contract' ? 'a contract migration' : 'not proven expand-only'
        }`,
      )
  }
  return reasons.length
    ? { kind: 'page', buildId: targetBuildId, reasons }
    : { kind: 'rollback', buildId: targetBuildId, versions }
}
