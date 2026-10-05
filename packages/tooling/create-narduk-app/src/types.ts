import type { Writable } from 'node:stream'

export const GENERATOR_NAME = '@narduk-enterprises/create-narduk-app'
export const GENERATOR_VERSION = '0.21.33'

export const SUPPORTED_CAPABILITIES = [
  'auth',
  'seo',
  'analytics',
  'uploads',
  'ai',
  'mapkit',
  'charts',
] as const
export type Capability = (typeof SUPPORTED_CAPABILITIES)[number]

/**
 * Backends the generator can scaffold. narduk-core also supports `'postgres'`,
 * which needs a Hyperdrive binding the generator does not provision, so a
 * Postgres app declares that backend itself after scaffolding.
 */
export const GENERATED_DATABASE_BACKENDS = ['d1', 'none'] as const
export type GeneratedDatabaseBackend = (typeof GENERATED_DATABASE_BACKENDS)[number]

export type AppVisibility = 'private' | 'public'

/** The shared nuxt-cloudflare workflow's `quality-level` input. */
export type CiQualityLevel = 'legacy' | 'standard'
export type AppExposure = 'public' | 'authenticated'

export interface ProductSpec {
  audience?: string
  constraints?: string
  primaryAction?: string
  problem?: string
  successMetrics?: string
  valueProposition?: string
}

export interface CreateNardukAppOptions {
  appName?: string
  capabilities?: readonly string[] | string
  /**
   * The shared-workflow `quality-level` the AGENTS.md quality bar describes.
   * Defaults to `standard` for a private app, whose generated CI passes it,
   * and `legacy` for a public app, which does not call the shared workflow.
   * `upgrade` passes what the app's own `.github/workflows/ci.yml` declares,
   * so a refreshed router block never claims a gate that app's CI does not run.
   */
  ciQualityLevel?: CiQualityLevel
  /**
   * `'d1'` (the default) scaffolds a D1 binding, schema and migrations.
   * `'none'` scaffolds an app with no database: narduk-core's `/api/health`
   * then reports `database: 'not_applicable'` instead of degrading.
   */
  databaseBackend?: GeneratedDatabaseBackend
  description?: string
  displayName?: string
  exposure?: AppExposure
  force?: boolean
  localDevPort?: number
  localPort?: number
  name?: string
  noGit?: boolean
  product?: ProductSpec
  productSpec?: ProductSpec
  /**
   * The security contact `nardukSeo.securityTxt` publishes, as a `mailto:`,
   * `https:` or `tel:` URI (a bare address is read as `mailto:`).
   *
   * There is deliberately no default. narduk-seo never invents a reporting
   * address, and a generator that supplied one would publish a contact nobody
   * had agreed to answer. An app that passes nothing gets no `security.txt`
   * rather than a fake one (narduk-libs#384).
   */
  securityContact?: string
  siteUrl?: string
  spec?: ProductSpec
  targetDir: string
  visibility?: AppVisibility
}

export interface CreateNardukAppReport {
  appName: string
  capabilities: Capability[]
  databaseBackend: GeneratedDatabaseBackend
  description: string
  displayName: string
  files: string[]
  generator: {
    name: typeof GENERATOR_NAME
    version: typeof GENERATOR_VERSION
  }
  gitInitialized: boolean
  localPort: number
  packageVersions: Record<string, string>
  schemaVersion: 1
  siteUrl: string
  targetDir: string
  validationResults: Array<{
    check: 'capabilities' | 'exact-package-versions' | 'generated-paths'
    detail: string
    passed: true
  }>
  visibility: AppVisibility
  productSpec?: ProductSpec
}

export interface CreateNardukAppCliOptions {
  argv?: readonly string[]
  cwd?: string
  stdout?: Writable
  stderr?: Writable
}

export interface GeneratedFile {
  path: string
  contents: string
}

export class CreateNardukAppError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CreateNardukAppError'
  }
}
