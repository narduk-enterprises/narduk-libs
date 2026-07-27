import type { Writable } from 'node:stream'

export const GENERATOR_NAME = '@narduk-enterprises/create-narduk-app'
export const GENERATOR_VERSION = '0.1.5'

export const SUPPORTED_CAPABILITIES = [
  'auth',
  'seo',
  'analytics',
  'uploads',
  'ai',
  'mapkit',
] as const
export type Capability = (typeof SUPPORTED_CAPABILITIES)[number]

export type AppVisibility = 'private' | 'public'

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
  description?: string
  displayName?: string
  force?: boolean
  localDevPort?: number
  localPort?: number
  name?: string
  noGit?: boolean
  product?: ProductSpec
  productSpec?: ProductSpec
  siteUrl?: string
  spec?: ProductSpec
  targetDir: string
  visibility?: AppVisibility
}

export interface CreateNardukAppReport {
  appName: string
  capabilities: Capability[]
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
