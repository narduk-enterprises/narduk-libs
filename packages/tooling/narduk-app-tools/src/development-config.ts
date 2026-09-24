/** Capability declaration only. Host activation records carry owner approval. */
import { z } from 'zod'

export function reservedDevelopmentVariable(name: string): boolean {
  return (
    /^(?:WORKERS_CI|CLOUDFLARE_|GIT_|GITHUB_|NPM_CONFIG_)/u.test(name) ||
    [
      'PATH',
      'HOME',
      'USER',
      'LOGNAME',
      'SHELL',
      'PNPM_HOME',
      'NODE_OPTIONS',
      'CI',
      'BUILD_VERSION',
      'NUXT_PUBLIC_BUILD_VERSION',
      'NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY',
    ].includes(name)
  )
}

const identifier = z.string().regex(/^[a-z][a-z0-9-]{0,62}$/u)
const envName = z.string().regex(/^[A-Z_][A-Z0-9_]*$/u)
const relativePath = z
  .string()
  .min(1)
  .max(2000)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.includes('\\') &&
      !value.split('/').includes('..') &&
      !/\p{Cc}/u.test(value),
    'Use a repository-relative path without parent traversal',
  )
const text = z.string().min(1).max(2000)

/** Executables receive literal argv. No command text is evaluated by a shell. */
export const developmentCommandSchema = z.strictObject({
  executable: z
    .string()
    .min(1)
    .max(2000)
    .refine((value) => !/\p{Cc}/u.test(value)),
  args: z.array(z.string().max(4000)).max(200).default([]),
  cwd: relativePath.default('.'),
  timeoutSeconds: z.number().int().min(1).max(3600).default(600),
})

/** Values are resolved only for their declared phase; never stored in receipts. */
export const developmentVaultSelectorSchema = z.strictObject({
  project: text,
  environment: text,
  config: text,
  key: envName,
})
const secretMap = z.record(envName, developmentVaultSelectorSchema)
const command = developmentCommandSchema
const origin = z.url().refine((value) => {
  const url = new URL(value)
  return (
    url.protocol === 'https:' &&
    url.pathname === '/' &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash
  )
}, 'Use an exact HTTPS serving origin')

export const developmentComponentSchema = z.strictObject({
  appDir: relativePath,
  wranglerConfig: relativePath,
  accountId: z.string().regex(/^[a-f0-9]{32}$/u),
  workerName: identifier,
  origins: z.array(origin).min(1).max(20),
  bindings: z
    .array(
      z.strictObject({
        kind: z.enum(['d1', 'kv', 'r2', 'service', 'durable-object']),
        name: envName,
        identity: text,
      }),
    )
    .max(100),
  build: command,
  assertArtifact: command,
  /** An authenticated behavior probe or a declared owner-only proof. */
  behavior: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('command'), command }),
    z.strictObject({ kind: z.literal('owner'), instructions: text }),
  ]),
  artifactDirectory: relativePath,
  buildVariables: z.record(envName, z.string().max(4000)).default({}),
  buildSecrets: secretMap.default({}),
  requiredRuntimeSecrets: z.array(envName).max(200).default([]),
  schemaChecks: z
    .array(
      z.strictObject({
        command,
        readOnlyCredentials: secretMap,
        /** Registered operation whose read-only authority was checked at enrollment. */
        credentialOperation: text,
      }),
    )
    .max(20)
    .default([]),
  deploymentCredential: developmentVaultSelectorSchema,
  buildsCredential: developmentVaultSelectorSchema,
  /** Every protected provider build variable must have a declared restoration source. */
  buildVariableSources: secretMap.default({}),
  schemaContracts: z.record(identifier, text).default({}),
})

export const developmentSchema = z
  .strictObject({
    defaultTargetSet: identifier,
    components: z.record(identifier, developmentComponentSchema),
    targetSets: z.record(
      identifier,
      z.strictObject({
        components: z.array(identifier).min(1).max(10),
        checks: z.array(command).min(1).max(30),
      }),
    ),
    /** Must perform a frozen install; used only when dependency inputs change. */
    install: command,
    /** Registry read credentials for `install` only, resolved only on a dependency cache miss. */
    installSecrets: secretMap.default({}),
    additionalBuildInputs: z.array(relativePath).max(200).default([]),
    /** Applied files here become immutable once an authorized migration records them. */
    migrationDirectories: z.array(relativePath).max(50).default([]),
    /**
     * Repository-relative globs (`*`, `**`, `?`) whose change takes the gated
     * route: deploy:dev refuses a capture that changes one since the last
     * verified capture unless run with `--gated`. Absent means
     * DEFAULT_PROTECTED_PATHS. The migration directories and a Wrangler binding
     * or Durable Object change are always protected. Optional without a default,
     * so an app that says nothing keeps its declaration digest.
     */
    protectedPaths: z.array(relativePath).max(200).optional(),
    /**
     * Automatic rollback when live proof fails. Off unless declared, and it can
     * be switched on only with a reference to a passed live rollback rehearsal
     * against the real Worker. It never crosses a Durable Object, binding or
     * non-expand-only migration change; those page instead.
     */
    rollback: z
      .strictObject({
        automatic: z.boolean(),
        /** Where the live rollback rehearsal for this app is recorded. */
        rehearsalRef: text.optional(),
      })
      .optional(),
    automation: z.strictObject({
      workflows: z.array(relativePath).min(1).max(100),
      /** Credentialed writers settle naturally; other held runs may be cancelled. */
      writeWorkflows: z.array(relativePath).max(100).default([]),
      /** Unsafe historical workflow identities remain disabled on exit. */
      retiredWorkflows: z.array(relativePath).max(100).default([]),
      /** Independently operating production paths are inventoried, never held. */
      independentWorkflows: z.array(relativePath).max(100).default([]),
      manualValidationWorkflow: relativePath,
      validationRequiredJobs: z
        .array(text)
        .min(1)
        .max(100)
        .default(['ci / Build', 'ci / Checks', 'ci / Caller lint', 'ci / Required']),
      continuingWriters: z
        .array(
          z.strictObject({
            id: identifier,
            workflow: relativePath.optional(),
            revision: z.string().regex(/^[a-f0-9]{40}$/u),
            schemaContracts: z.record(identifier, text),
            procedure: text,
          }),
        )
        .max(30)
        .default([]),
      /** Human inventory also covers apps, dependency bots, dynamic workflows and cron. */
      inventoryReference: text,
    }),
  })
  .superRefine((value, ctx) => {
    const add = (path: Array<string | number>, message: string): void => {
      ctx.addIssue({ code: 'custom', path, message })
    }
    if (!value.targetSets[value.defaultTargetSet])
      add(['defaultTargetSet'], 'The default target set must be declared')
    for (const [id, set] of Object.entries(value.targetSets)) {
      const targets = new Set<string>()
      for (const [index, componentId] of set.components.entries()) {
        const component = value.components[componentId]
        if (!component) {
          add(['targetSets', id, 'components', index], 'Unknown component')
          continue
        }
        const key = `${component.accountId}/${component.workerName}`
        if (targets.has(key)) add(['targetSets', id, 'components', index], 'Target appears twice')
        targets.add(key)
      }
    }
    const held = new Set(value.automation.workflows)
    if (held.size !== value.automation.workflows.length)
      add(['automation', 'workflows'], 'Automatic workflow paths must be unique')
    if (held.has(value.automation.manualValidationWorkflow))
      add(['automation', 'manualValidationWorkflow'], 'Manual validation must remain enabled')
    for (const key of ['writeWorkflows', 'retiredWorkflows'] as const) {
      for (const path of value.automation[key]) {
        if (!held.has(path)) add(['automation', key], 'This workflow must also be held')
      }
    }
    for (const path of value.automation.independentWorkflows) {
      if (held.has(path))
        add(['automation', 'independentWorkflows'], 'Independent production paths cannot be held')
    }
    if (value.rollback?.automatic && !value.rollback.rehearsalRef)
      add(
        ['rollback', 'rehearsalRef'],
        'Automatic rollback stays off until a live rollback rehearsal is recorded here',
      )
    if (!value.automation.validationRequiredJobs.includes('ci / Required'))
      add(['automation', 'validationRequiredJobs'], 'The real required aggregate must be checked')
    for (const [index, writer] of value.automation.continuingWriters.entries()) {
      if (writer.workflow && held.has(writer.workflow))
        add(['automation', 'continuingWriters', index], 'A continuing writer cannot also be held')
    }
    for (const key of Object.keys(value.installSecrets)) {
      if (reservedDevelopmentVariable(key))
        add(['installSecrets', key], 'Process controls cannot be install secrets')
    }
    for (const [id, component] of Object.entries(value.components)) {
      for (const key of Object.keys(component.buildVariables)) {
        if (key in component.buildSecrets || reservedDevelopmentVariable(key))
          add(
            ['components', id, 'buildVariables', key],
            'Credential/provenance overrides are not build inputs',
          )
      }
      for (const key of Object.keys(component.buildSecrets)) {
        if (reservedDevelopmentVariable(key))
          add(['components', id, 'buildSecrets', key], 'Process controls cannot be build secrets')
      }
    }
  })

/**
 * Protected paths when an app declares none: auth, session, payment and
 * credential code takes the gated route (the T2 path escalation).
 */
export const DEFAULT_PROTECTED_PATHS = [
  '**/auth/**',
  '**/session/**',
  '**/sessions/**',
  '**/payments/**',
  '**/billing/**',
  '**/credentials/**',
] as const

export type DevelopmentConfig = z.infer<typeof developmentSchema>
export type DevelopmentComponent = z.infer<typeof developmentComponentSchema>
export type DevelopmentCommand = z.infer<typeof developmentCommandSchema>
export type DevelopmentVaultSelector = z.infer<typeof developmentVaultSelectorSchema>
