/**
 * The `deployment` block of `Config/cloudflare-app.json` -- the single
 * declaration surface for the Narduk deployment standard (deployment-standard
 * design §2.1; Logan approved every recommended option on 2026-09-17,
 * company-hq#745).
 *
 * The standard in one line: **Cloudflare builds, GitHub promotes, production is
 * a promotion and never a push.** Everything an app has to say about that lives
 * in one object. `wrangler.json` keeps only what Wrangler itself reads; this
 * block keeps the estate's contract.
 *
 * Validation is zod, and `deploymentBlockJsonSchema()` projects the same schema
 * to JSON Schema so a non-TypeScript consumer (an estate sweep, an editor) reads
 * one definition rather than a second hand-written copy that could disagree.
 *
 * Two shapes deliberately diverge from the design's literal sketch, both
 * additive:
 *
 * - **`previewBindings` entries may be a string or an object.** §2.1 shows
 *   `{ "d1": [], "kv": [], "r2": [] }` with no element type. A bare binding name
 *   is enough for the conformance gate here, but §3.3 option A also has to
 *   generate `.wrangler.deploy.preview.json` from this block, which needs the
 *   preview resource's own id. Both forms are accepted and the binding name is
 *   read from either.
 * - **`previewChecks` is accepted and optional.** §2.1 does not list it; it is
 *   the `preview-checks` input of the shared workflow (§3.4), and declaring it
 *   beside the rest of the deployment contract is what lets an estate sweep see
 *   which apps still run the default. Its members are the workflow's, plus the
 *   two §3.4 asks for (`health`, `headers`).
 * - **`accountId` is accepted and optional.** §2.2 tier 1 asks that "the account
 *   id in every wrangler config is the Narduk Enterprises account". A repository
 *   read cannot know which account that is, and hard-coding one into a published
 *   package would make the answer a library release rather than an app fact. So
 *   the app declares the account it deploys to, and the conformance item holds
 *   every wrangler config in the checkout to it. An app that declares nothing
 *   gets the weaker internal-consistency check, and is told so in the verdict.
 */

import { z } from 'zod'

import { databaseOwnershipSchema } from './database-ownership.js'
import { developmentSchema } from './development-config.js'

/** The conformance key. Any other value means the app is deliberately exempt
 * from the standard and must justify that elsewhere -- it is not a failure
 * here, because an exempt app is not claiming conformance. */
export const DEPLOYMENT_STANDARD = 'narduk-v1'

/** The only builder narduk-v1 supports: Cloudflare Workers Builds. */
export const DEPLOYMENT_BUILDER = 'workers-builds'

/** Both deploy commands, production and non-production. The whole standard
 * rests on a build never deploying: it uploads a version that serves no
 * traffic, and a GitHub Actions job promotes it after the gate check is green.
 * A build whose command is `deploy` has already pushed to production. */
export const STANDARD_DEPLOY_COMMAND = 'narduk-app deploy versions-upload'

/** The response header `verify --live` compares against the promoted commit.
 * narduk-core emits exactly this one from `runtimeConfig.public.buildVersion`. */
export const BUILD_VERSION_HEADER = 'x-build-version'

/** The three binding kinds whose state is NOT captured by a Worker version, and
 * which therefore leak from a preview straight into production data unless the
 * app declares a preview replacement (§3.2). */
export const PREVIEW_BINDING_KINDS = ['d1', 'kv', 'r2'] as const
export type PreviewBindingKind = (typeof PREVIEW_BINDING_KINDS)[number]

/** Members of the shared workflow's `preview-checks` input (§3.4). */
export const PREVIEW_CHECK_MEMBERS = ['none', 'og', 'health', 'headers', 'e2e-subset'] as const

const appPath = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine(
    (value) => value.startsWith('/') && !value.startsWith('//') && !/[#\\\s]/u.test(value),
    'Expected a concrete app path beginning with "/", without a fragment',
  )

const bindingName = z.string().trim().min(1).max(200)

/** A preview replacement for one production binding: the binding name alone, or
 * an object naming it alongside the preview resource, in wrangler's own field
 * names (KV `id`, D1 `database_id` + `database_name`, R2 `bucket_name`). Only
 * the object form isolates anything: `narduk-app deploy versions-upload` can
 * rebind a binding only to a resource it is told (`./preview-config.ts`). */
const previewBindingEntry = z.union([bindingName, z.looseObject({ binding: bindingName })])

export type PreviewBindingEntry = z.infer<typeof previewBindingEntry>

/** The binding name an entry covers, whichever form it took. */
export function previewBindingName(entry: PreviewBindingEntry): string {
  return typeof entry === 'string' ? entry.trim() : entry.binding.trim()
}

/** One entry per binding. A second entry for the same binding would be silently
 * shadowed by the first, so a contradictory declaration is refused instead. */
const previewBindingList = z
  .array(previewBindingEntry)
  .max(100)
  .default([])
  .superRefine((entries, ctx) => {
    const seen = new Set<string>()
    for (const [index, entry] of entries.entries()) {
      const name = previewBindingName(entry)
      if (seen.has(name)) {
        ctx.addIssue({
          code: 'custom',
          path: [index],
          message: `${name} appears more than once; give each binding exactly one preview entry`,
        })
      }
      seen.add(name)
    }
  })

export const previewBindingsSchema = z.strictObject({
  d1: previewBindingList,
  kv: previewBindingList,
  r2: previewBindingList,
})

/** The two §5.2 gates between "proved on staging" and "live in production". */
export const STAGING_APPROVALS = ['environment', 'auto-after-proof'] as const

/** A Cloudflare account id: 32 lowercase hex characters. */
export const ACCOUNT_ID_PATTERN = /^[0-9a-f]{32}$/u

const accountId = z
  .string()
  .trim()
  .refine(
    (value) => ACCOUNT_ID_PATTERN.test(value),
    'Expected a Cloudflare account id: 32 lowercase hex characters',
  )

const workerName = z.string().trim().min(1).max(200)

/** A bare hostname, not a URL: the live proof composes the scheme itself, and a
 * value carrying one would silently probe the wrong thing. */
const hostname = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .refine(
    (value) => !/[\s/:]/u.test(value) && value.includes('.'),
    'Expected a bare hostname such as staging.example.com, with no scheme or path',
  )

/**
 * §5.2 -- staging is one flag that inserts a stage, never a fork.
 *
 * Disabled is the default and says nothing else. Enabled has to name its own
 * Worker (staging is a separate Worker name; `narduk-app-tools` retires wrangler
 * `env.staging` outright), the hostname its live proof reads, and the gate
 * between staging and production -- an unstated approval mode on a production
 * promotion is exactly the ambiguity §5 exists to remove. `approval:
 * "environment"` additionally names the GitHub Environment carrying
 * `required_reviewers`, because that environment *is* the approval.
 *
 * Configuration for a stage that is switched off is rejected rather than
 * ignored: it reads as a live staging setup and is not one.
 */
export const stagingSchema = z
  .strictObject({
    enabled: z.boolean().default(false),
    workerName: workerName.optional(),
    hostname: hostname.optional(),
    approval: z.enum(STAGING_APPROVALS).optional(),
    environment: z.string().trim().min(1).max(200).optional(),
    bindings: previewBindingsSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const configured = ['workerName', 'hostname', 'approval', 'environment', 'bindings'] as const
    if (!value.enabled) {
      for (const key of configured) {
        if (value[key] !== undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message:
              `staging.enabled is false, so ${key} configures a stage that never runs -- ` +
              `set enabled to true or remove it`,
          })
        }
      }
      return
    }
    if (value.workerName === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['workerName'],
        message:
          'an enabled staging stage must name its own Worker: staging is a separate Worker ' +
          'name, never a wrangler env.staging block',
      })
    }
    if (value.hostname === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['hostname'],
        message: 'an enabled staging stage must name the hostname its live proof reads',
      })
    }
    if (value.approval === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['approval'],
        message:
          'an enabled staging stage must state its gate: "environment" for a GitHub Environment ' +
          'with required_reviewers, or "auto-after-proof" to continue on a green staging proof',
      })
    }
    if (value.approval === 'environment' && value.environment === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['environment'],
        message:
          'approval "environment" is a GitHub Environment with required_reviewers -- name it, ' +
          'or the promotion has no reviewer and the approval is decorative',
      })
    }
  })

export type StagingBlock = z.infer<typeof stagingSchema>

/**
 * One reviewed contract migration (narduk-libs#399): an app migration that
 * drops or renames something, declared safe because the code that read it is
 * past the rollback window. Pinned by checksum -- the same sha256 the migration
 * ledger records -- so the waiver covers the reviewed bytes and nothing else.
 */
export const contractMigrationSchema = z.strictObject({
  /** Checkout-relative path of the `.sql` file. */
  path: z.string().trim().min(1).max(2000),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  /** Why no serving or rollback-target version still reads what it removes. */
  reason: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .refine((reason) => !reason.startsWith('<'), 'replace the placeholder with the actual reason'),
})

export type ContractMigration = z.infer<typeof contractMigrationSchema>

export const deploymentMigrationsSchema = z.strictObject({
  compatibility: z.literal('expand-contract'),
  credential: z.string().trim().min(1).max(300),
  databases: z
    .array(
      z.strictObject({
        binding: bindingName,
        sources: z.string().trim().min(1).max(2000),
      }),
    )
    .min(1)
    .max(100),
  /** The escape hatch from foundation sub-check 12.9's expand-only rule. */
  contractMigrations: z.array(contractMigrationSchema).max(500).optional(),
})

export const deploymentBlockSchema = z.strictObject({
  standard: z.literal(DEPLOYMENT_STANDARD),
  builder: z.literal(DEPLOYMENT_BUILDER),
  /** The Cloudflare account every wrangler config in this repository must
   * declare, when it declares one at all (§2.2 tier 1). Optional: an app that
   * resolves the account from `CLOUDFLARE_ACCOUNT_ID` at deploy time has
   * nothing to compare, and gets the weaker internal-consistency check. */
  accountId: accountId.optional(),
  productionBranch: z.string().trim().min(1).max(200),
  productionDeployCommand: z.string().trim().min(1).max(500),
  nonProductionDeployCommand: z.string().trim().min(1).max(500),
  nonProductionBranchBuilds: z.boolean(),
  promotion: z.strictObject({
    mode: z.enum(['auto-on-green', 'manual-dispatch']),
    gateCheck: z.string().trim().min(1).max(200),
    credential: z.string().trim().min(1).max(300),
  }),
  liveProof: z.strictObject({
    buildVersionHeader: z.string().trim().min(1).max(200).default(BUILD_VERSION_HEADER),
    healthPath: appPath,
    smokePath: appPath,
    attempts: z.number().int().min(1).max(60).default(6),
    intervalSeconds: z.number().int().min(1).max(600).default(10),
  }),
  rollback: z.strictObject({
    /**
     * `manual` is the only mode anything honours: a person, or a step the app
     * wrote into its own promote job, runs `narduk-app deploy rollback`.
     * `auto` still parses so an older manifest does not stop the tools, but
     * nothing reads it, and foundation sub-check 12.10 fails it (#399).
     */
    mode: z.enum(['auto', 'manual']),
    alert: z.enum(['resend', 'none']),
  }),
  /** §5: the single opt-in flag for a staging stage. Default false -- an app
   * that says nothing does not get one. */
  staging: stagingSchema.default({ enabled: false }),
  previewBindings: previewBindingsSchema.default({ d1: [], kv: [], r2: [] }),
  previewChecks: z.array(z.enum(PREVIEW_CHECK_MEMBERS)).max(10).optional(),
  /** Explicit adoption; existing database-free applications need no migration step. */
  migrations: deploymentMigrationsSchema.optional(),
  /**
   * Who owns each D1 binding's schema (`./database-ownership.ts`).
   *
   * Optional, and absent means what it has always meant: every D1 binding is
   * migration-owned and `deployment.migrations` must cover all of them. An app
   * declares this only when at least one database's schema is owned by a
   * contract rather than by a migration history -- which is the only way to
   * declare `deployment.migrations` for the rest without manufacturing a
   * migration baseline for a database nobody migrates.
   *
   * When present it is the **complete** statement: every migrated binding must
   * appear here too, so the manifest never leaves a binding's owner implied.
   */
  databaseOwnership: databaseOwnershipSchema.optional(),
  /** Optional capability. Enrollment and publisher custody live outside source control. */
  development: developmentSchema.optional(),
})

export type DeploymentBlock = z.infer<typeof deploymentBlockSchema>

/** Just enough of the block to decide whether it claims the standard at all.
 * Read first, so an app on a different standard is reported as exempt rather
 * than as 20 schema violations against a contract it never claimed. */
const deploymentEnvelopeSchema = z.looseObject({ standard: z.string().trim().min(1).max(200) })

export interface DeploymentIssue {
  path: string
  message: string
}

export type DeploymentBlockOutcome =
  /** No `deployment` key at all -- the not-yet-adopted state. */
  | { kind: 'absent' }
  /** Present but not an object, or carrying no `standard` key. */
  | { kind: 'malformed'; detail: string }
  /** Declares some other standard: out of scope here, not a failure. */
  | { kind: 'exempt'; standard: string }
  /** Claims narduk-v1 but does not satisfy it. */
  | { kind: 'invalid'; standard: string; issues: DeploymentIssue[] }
  | { kind: 'valid'; block: DeploymentBlock }

function issuesOf(error: z.ZodError): DeploymentIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join('.') : '(root)',
    message: issue.message,
  }))
}

/**
 * Reads the `deployment` block out of a parsed `Config/cloudflare-app.json`.
 * Never throws: every outcome a checkout can present is a named result, because
 * the caller is a conformance item that must report rather than crash.
 */
export function readDeploymentBlock(cloudflareApp: unknown): DeploymentBlockOutcome {
  if (cloudflareApp === null || typeof cloudflareApp !== 'object' || Array.isArray(cloudflareApp)) {
    return { kind: 'absent' }
  }
  const raw = (cloudflareApp as Record<string, unknown>).deployment
  if (raw === undefined) return { kind: 'absent' }
  const envelope = deploymentEnvelopeSchema.safeParse(raw)
  if (!envelope.success) {
    return {
      kind: 'malformed',
      detail: issuesOf(envelope.error)
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join('; '),
    }
  }
  const standard = envelope.data.standard.trim()
  if (standard !== DEPLOYMENT_STANDARD) return { kind: 'exempt', standard }
  const parsed = deploymentBlockSchema.safeParse(raw)
  if (!parsed.success) return { kind: 'invalid', standard, issues: issuesOf(parsed.error) }
  return { kind: 'valid', block: parsed.data }
}

/** The same contract as JSON Schema, for consumers that are not TypeScript. */
export function deploymentBlockJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(deploymentBlockSchema, { io: 'input' }) as Record<string, unknown>
}

/** The block a newly generated app starts from: the standard, both commands,
 * branch builds OFF (an app with production data may not turn them on until it
 * declares preview replacements -- §3.2), and no staging stage. */
export function defaultDeploymentBlock(options: {
  appSlug: string
  productionBranch?: string
  smokePath?: string
}): Record<string, unknown> {
  return {
    standard: DEPLOYMENT_STANDARD,
    builder: DEPLOYMENT_BUILDER,
    productionBranch: options.productionBranch ?? 'main',
    productionDeployCommand: STANDARD_DEPLOY_COMMAND,
    nonProductionDeployCommand: STANDARD_DEPLOY_COMMAND,
    nonProductionBranchBuilds: false,
    promotion: {
      mode: 'auto-on-green',
      gateCheck: 'ci / Required',
      credential: `cloudflare/prd/narduk-enterprises-${options.appSlug}-promote`,
    },
    liveProof: {
      buildVersionHeader: BUILD_VERSION_HEADER,
      healthPath: '/api/health',
      smokePath: options.smokePath ?? '/',
      attempts: 6,
      intervalSeconds: 10,
    },
    rollback: { mode: 'manual', alert: 'resend' },
    staging: { enabled: false },
    previewBindings: { d1: [], kv: [], r2: [] },
  }
}
