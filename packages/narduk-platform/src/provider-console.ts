export type ProviderName = 'github' | 'cloudflare' | 'doppler' | 'google'
export type ProviderCredentialKey =
  | 'COMMAND_GITHUB_TOKEN'
  | 'COMMAND_GITHUB_APP_ID'
  | 'COMMAND_GITHUB_APP_CLIENT_ID'
  | 'COMMAND_GITHUB_APP_PRIVATE_KEY'
  | 'COMMAND_GITHUB_APP_INSTALLATION_ID'
  | 'COMMAND_GITHUB_PRIMARY_ORG'
  | 'COMMAND_GSC_SERVICE_ACCOUNT_JSON'
  | 'COMMAND_CLOUDFLARE_API_TOKEN'
  | 'COMMAND_CLOUDFLARE_BUILDS_API_TOKEN'
  | 'COMMAND_CLOUDFLARE_BUILDS_TOKEN_UUID'
  | 'COMMAND_CLOUDFLARE_ACCOUNT_ID'
  | 'COMMAND_DOPPLER_TOKEN'
export type GithubAuthStrategy = 'token' | 'app'
export type EnvKeyPhase = 'workflow' | 'build' | 'runtime' | 'build + runtime'
export type EnvKeySensitivity = 'plain' | 'secret'
export type CanonicalProvider = 'cloudflare' | 'github' | 'doppler' | 'unknown'
export type CloudflarePlane = 'runtime-var' | 'runtime-secret' | 'build-var' | 'build-secret'
export type GithubScope = 'repo' | 'org' | 'environment'
export type AppEnvContractManagedBy = 'template' | 'app'
export type AppEnvContractExpectedValueSource = 'provision.url'
export type ZoneResolutionStatus =
  'resolved' | 'missing-site-url' | 'not-found' | 'ambiguous' | 'unavailable'

export interface ProviderCredentialState {
  configured: boolean
  missing: ProviderCredentialKey[]
  strategy?: GithubAuthStrategy
  note?: string
}

export interface DashboardProviderCredentialSummary {
  github: ProviderCredentialState
  cloudflare: ProviderCredentialState
  doppler: ProviderCredentialState
}

export interface ProviderCredentialHealthState extends ProviderCredentialState {
  valid: boolean
  lastChecked: string
  error?: string
}

export interface DashboardProviderCredentialHealthSummary {
  github: ProviderCredentialHealthState
  cloudflare: ProviderCredentialHealthState
  doppler: ProviderCredentialHealthState
}

export interface EnvContractEntry {
  key: string
  phase: EnvKeyPhase
  sensitivity: EnvKeySensitivity
  canonicalProvider: CanonicalProvider
  currentLocation: string[]
  targetLocation: string[]
  migrationNotes: string
  temporaryDopplerException?: boolean
  githubScope?: GithubScope
  cloudflarePlane?: CloudflarePlane
  cloudflarePlanes?: CloudflarePlane[]
}

export interface AppEnvContractRequirement {
  key: string
  managedBy: AppEnvContractManagedBy
  phase: EnvKeyPhase
  sensitivity: EnvKeySensitivity
  canonicalProvider: Exclude<CanonicalProvider, 'doppler' | 'unknown'>
  cloudflarePlanes?: CloudflarePlane[]
  githubScope?: Exclude<GithubScope, 'environment'>
  expectedValue?: string
  expectedValueFrom?: AppEnvContractExpectedValueSource
  notes?: string
}

export interface AppEnvContractDefinition {
  version: 1
  requirements: AppEnvContractRequirement[]
}

export type AppEnvReadinessStatus = 'ready' | 'drifted' | 'legacy' | 'pending'

export interface AppEnvReadinessSummary {
  status: AppEnvReadinessStatus
  required: number
  satisfied: number
  missingKeys: string[]
  driftedKeys: string[]
  blockingReasons: string[]
  missingContract: boolean
}

export interface AppEnvContractCloudflarePlaneStatus {
  plane: CloudflarePlane
  present: boolean
  isSecret: boolean
  value: string | null
  observable: boolean
  observationError: string | null
}

export interface AppEnvContractGithubStatus {
  scope: Exclude<GithubScope, 'environment'>
  present: boolean | null
}

export type AppEnvContractRequirementStatus = 'satisfied' | 'missing' | 'drifted'
export type AppEnvContractVerificationState = 'verified' | 'missing' | 'unverifiable'

export interface AppEnvContractRequirementEvaluation {
  requirement: AppEnvContractRequirement
  status: AppEnvContractRequirementStatus
  verificationState: AppEnvContractVerificationState
  expectedValue: string | null
  problems: string[]
  cloudflare: {
    buildTriggerAvailable: boolean | null
    planes: AppEnvContractCloudflarePlaneStatus[]
  } | null
  github: AppEnvContractGithubStatus | null
}

export interface AppInventoryWriteStatus {
  githubReady: boolean
  cloudflareReady: boolean
  dopplerReady: boolean
  dnsReady: boolean
  reasons: string[]
}

export type ProvisioningProfileStatus = 'available' | 'missing' | 'unavailable' | 'invalid'

export interface ProvisioningProfileDefinition {
  id: string
  description: string | null
}

export interface AppInventoryProvisioningAppTemplate {
  status: 'selected' | 'none' | 'missing'
  selection: ProvisioningProfileDefinition | null
}

export interface AppInventoryProvisioningTemplateLayer {
  status: 'configured' | 'missing' | 'unsupported'
  mode: 'bundled' | null
  bundles: ProvisioningProfileDefinition[]
}

export interface AppInventoryProvisioningLocalDev {
  nuxtPort: number | null
}

export interface AppInventoryProvisioningProfile {
  status: ProvisioningProfileStatus
  name: string | null
  displayName: string | null
  shortName: string | null
  description: string | null
  url: string | null
  provisionedAt: string | null
  localDev: AppInventoryProvisioningLocalDev | null
  baseTheme: ProvisioningProfileDefinition | null
  appTemplate: AppInventoryProvisioningAppTemplate
  templateLayer: AppInventoryProvisioningTemplateLayer
}

export interface ProviderConsoleApp {
  repoId: number | null
  repoSlug: string
  repoFullName: string
  isSyntheticBootstrap?: boolean
  displayName: string
  description: string
  defaultBranch: string
  siteUrl: string
  workerName: string
  workersDevPolicy?: {
    expected: boolean
    mode: 'required' | 'disabled'
    exceptionReason: string | null
  }
  dopplerProject: string
}

export interface GithubWorkflowSummary {
  id: number
  name: string
  path: string
  state: string
}

export interface GithubWorkflowRunSummary {
  id: number
  name: string
  status: string
  conclusion: string | null
  event: string
  branch: string
  inputs?: Record<string, string>
  htmlUrl: string
  createdAt: string
  updatedAt: string
}

export interface GithubVariableSummary {
  name: string
  value: string
  createdAt?: string
  updatedAt?: string
  scope: GithubScope
  visibility?: string
  environmentName?: string
  appliesToSelectedRepo?: boolean | null
}

export interface GithubSecretSummary {
  name: string
  createdAt?: string
  updatedAt?: string
  scope: GithubScope
  visibility?: string
  environmentName?: string
  appliesToSelectedRepo?: boolean | null
}

export interface GithubEnvironmentSummary {
  name: string
  protectionRules: number
  htmlUrl: string
  variables: GithubVariableSummary[]
  secrets: GithubSecretSummary[]
}

export interface GithubRepoSummary {
  name: string
  fullName: string
  description: string
  defaultBranch: string
  private: boolean
  visibility: string
  htmlUrl: string
  homepage: string
  openIssuesCount: number
}

export interface GithubOverviewResponse {
  available: boolean
  credentials: ProviderCredentialState
  app: ProviderConsoleApp | null
  repo: GithubRepoSummary | null
  workflows: GithubWorkflowSummary[]
  recentRuns: GithubWorkflowRunSummary[]
  repoVariables: GithubVariableSummary[]
  repoSecrets: GithubSecretSummary[]
  orgVariables: GithubVariableSummary[]
  orgSecrets: GithubSecretSummary[]
  environments: GithubEnvironmentSummary[]
  readAccess: {
    repoVariables: boolean
    repoSecrets: boolean
    orgVariables: boolean
    orgSecrets: boolean
  }
  warnings: string[]
}

export interface CloudflareBindingSummary {
  name: string
  type: string
  summary: string
}

export type CloudflareDiffStatus =
  'missing' | 'unexpected' | 'mismatch' | 'degraded' | 'intentional' | 'in-sync'
export type CloudflareVerificationState = 'verified' | 'degraded' | 'unverified'

export interface CloudflareDeploymentSummary {
  id: string
  versionId: string | null
  branch: string | null
  source: string | null
  message: string | null
  author: string | null
  createdAt: string | null
  active: boolean
}

export interface CloudflareScaffoldMetricCard {
  key: string
  label: string
  value: string
  note: string
}

export interface CloudflareMetricsScaffold {
  available: boolean
  windowLabel: string
  cards: CloudflareScaffoldMetricCard[]
  note: string
}

export interface CloudflareObservabilityScaffold {
  available: boolean
  logsEnabled: boolean | null
  tracesEnabled: boolean | null
  note: string
}

export interface CloudflareRuntimeVarSummary {
  name: string
  value: string
}

export interface CloudflareRuntimeSecretSummary {
  name: string
  type: string
}

export interface CloudflareBuildVarSummary {
  name: string
  value: string | null
  isSecret: boolean
  createdAt: string | null
}

export interface CloudflareDnsRecordSummary {
  id: string
  name: string
  type: string
  content: string
  ttl: number | null
  proxied: boolean | null
  priority: number | null
  comment: string | null
  modifiedOn: string | null
}

export interface CloudflareWorkerDomainSummary {
  id: string
  hostname: string
  service: string
  environment: string | null
  zoneId: string | null
  zoneName: string | null
  certId: string | null
  enabled: boolean | null
  previewsEnabled: boolean | null
}

export interface CloudflareOverviewResponse {
  available: boolean
  credentials: ProviderCredentialState
  app: ProviderConsoleApp | null
  access: {
    runtimeRead: boolean
    runtimeWrite: boolean
    buildRead: boolean
    buildWrite: boolean
    dnsRead: boolean
    dnsWrite: boolean
  }
  worker: {
    accountId: string | null
    name: string
    found: boolean
    compatibilityDate: string | null
    usageModel: string | null
    deploymentCount: number
    bindings: CloudflareBindingSummary[]
  }
  domains: {
    workersDev: {
      hostname: string
      enabled: boolean | null
      previewsEnabled: boolean | null
      expected: boolean
      expectedByPolicy: boolean
      exceptionReason: string | null
    }
    customDomains: CloudflareWorkerDomainSummary[]
  }
  deployments: CloudflareDeploymentSummary[]
  runtimeVars: CloudflareRuntimeVarSummary[]
  runtimeSecrets: CloudflareRuntimeSecretSummary[]
  build: {
    available: boolean
    triggerUuid: string | null
    repoReadVerified: boolean
    vars: CloudflareBuildVarSummary[]
    error: string | null
  }
  preview: {
    desired: boolean
    live: boolean
  }
  dns: {
    available: boolean
    host: string
    zoneId: string | null
    zoneName: string | null
    zoneResolution: ZoneResolutionStatus
    verificationState: CloudflareVerificationState
    message: string
    records: CloudflareDnsRecordSummary[]
  }
  metrics: CloudflareMetricsScaffold
  observability: CloudflareObservabilityScaffold
  warnings: string[]
}

export type GoogleCredentialEncoding = 'json' | 'base64'

export interface GoogleCredentialStatus {
  configured: boolean
  valid: boolean
  encoding: GoogleCredentialEncoding | null
  clientEmail: string | null
  note: string
}

export interface GoogleManagedAppSummary {
  slug: string
  displayName: string
  repoFullName: string
  siteUrl: string
  workerName: string
}

export interface GoogleCurrentAssignments {
  gaMeasurementId: string | null
  gaPropertyId: string | null
  gscSiteUrl: string | null
  gscSiteUrlAssigned: string | null
  gscDerivedSiteUrl: string | null
}

export interface GoogleSearchConsoleSiteSummary {
  siteUrl: string
  permissionLevel: string | null
  host: string | null
  matchesHostname: boolean
  matchesAssignment: boolean
  recommended: boolean
}

export interface GoogleAnalyticsWebStreamSummary {
  streamId: string
  displayName: string
  measurementId: string | null
  defaultUri: string | null
  host: string | null
  matchesHostname: boolean
  matchesAssignment: boolean
  recommended: boolean
}

export interface GoogleAnalyticsPropertySummary {
  propertyId: string
  displayName: string
  propertyType: string | null
  accountDisplayName: string | null
  webStreams: GoogleAnalyticsWebStreamSummary[]
}

export interface GoogleOverviewResponse {
  available: boolean
  app: GoogleManagedAppSummary | null
  credential: GoogleCredentialStatus
  currentAssignments: GoogleCurrentAssignments
  gsc: {
    available: boolean
    sites: GoogleSearchConsoleSiteSummary[]
    warnings: string[]
    error: string | null
  }
  ga: {
    available: boolean
    properties: GoogleAnalyticsPropertySummary[]
    warnings: string[]
    error: string | null
  }
  warnings: string[]
}

export interface AppEnvContractResponse {
  app: ProviderConsoleApp | null
  contract: AppEnvContractDefinition | null
  summary: AppEnvReadinessSummary
  evaluations: AppEnvContractRequirementEvaluation[]
}

export interface AppEnvContractFleetKeySummary {
  key: string
  count: number
  apps: string[]
}

export interface AppEnvContractFleetResponse {
  apps: AppEnvContractResponse[]
  summary: {
    totalApps: number
    readyApps: number
    driftedApps: number
    legacyApps: number
    pendingApps: number
  }
  missingKeys: AppEnvContractFleetKeySummary[]
  driftedKeys: AppEnvContractFleetKeySummary[]
  auditedAt: string
}

export interface DopplerConfigSummary {
  name: string
  environment: string
}

export interface DopplerKeyDiffSummary {
  name: string
  configs: string[]
  sensitivity: EnvKeySensitivity
  canonicalProvider: CanonicalProvider
  cloudflarePlane: CloudflarePlane | null
  cloudflarePlanes: CloudflarePlane[]
  githubScope: GithubScope | null
  currentLocation: string[]
  targetLocation: string[]
  migrationNotes: string
  temporaryDopplerException: boolean
  dopplerPresent: boolean
  currentTargetPresent: boolean | null
  plainValueMatch: boolean | null
}

export interface DopplerUnmanagedKeySummary {
  name: string
  configs: string[]
  sensitivity: EnvKeySensitivity
  canonicalProvider: CanonicalProvider
}

export interface DopplerOverviewResponse {
  available: boolean
  credentials: ProviderCredentialState
  app: ProviderConsoleApp | null
  project: string
  configs: DopplerConfigSummary[]
  keys: DopplerKeyDiffSummary[]
  unmanagedKeys: DopplerUnmanagedKeySummary[]
  warnings: string[]
}

// ────────────────────────────────────────────────────────────────────────────
// Home
// ────────────────────────────────────────────────────────────────────────────

export interface HomeSummary {
  fleet: {
    totalApps: number
    starterRequested: number
    starterGenerated: number
    adopted: number
    live: number
  }
  github: {
    openPrs: number
    openIssues: number
    recentRuns: number
    failedRuns: number
  }
  credentials: DashboardProviderCredentialSummary
}

// ────────────────────────────────────────────────────────────────────────────
// GitHub Directory and Workbench
// ────────────────────────────────────────────────────────────────────────────

export interface GithubDirectoryRepo {
  name: string
  fullName: string
  description: string
  defaultBranch: string
  visibility: string
  openIssuesCount: number
  openPrsCount: number
  lastPushedAt: string
  hasActionsFailure: boolean
  /** true when the repo has a registry row */
  isRegistryLinked: boolean
  htmlUrl: string
}

export interface GithubDirectoryResponse {
  available: boolean
  credentials: ProviderCredentialState
  repos: GithubDirectoryRepo[]
}

export interface GithubPrSummary {
  number: number
  title: string
  state: 'open' | 'closed'
  draft: boolean
  author: string
  createdAt: string
  updatedAt: string
  htmlUrl: string
  labels: string[]
}

export interface GithubIssueSummary {
  number: number
  title: string
  state: 'open' | 'closed'
  author: string
  createdAt: string
  updatedAt: string
  htmlUrl: string
  labels: string[]
}

export interface GithubRepoWorkbenchOverview {
  available: boolean
  credentials: ProviderCredentialState
  repo: GithubRepoSummary | null
  recentRuns: GithubWorkflowRunSummary[]
  openPrsCount: number
  openIssuesCount: number
  warnings: string[]
}

export interface GithubRepoActionsResponse {
  available: boolean
  workflows: GithubWorkflowSummary[]
  recentRuns: GithubWorkflowRunSummary[]
}

export interface GithubRepoConfigResponse {
  available: boolean
  repoVariables: GithubVariableSummary[]
  repoSecrets: GithubSecretSummary[]
  orgVariables: GithubVariableSummary[]
  orgSecrets: GithubSecretSummary[]
  environments: GithubEnvironmentSummary[]
  readAccess: {
    repoVariables: boolean
    repoSecrets: boolean
    orgVariables: boolean
    orgSecrets: boolean
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Doppler Project / Config Management
// ────────────────────────────────────────────────────────────────────────────

export interface DopplerProjectSummary {
  id: string
  name: string
  description: string
  createdAt: string
}

export interface DopplerProjectsResponse {
  available: boolean
  projects: DopplerProjectSummary[]
}

export interface DopplerSecretEntry {
  name: string
  /** null for secret-type values; visible for plain-text values */
  value: string | null
  isComputed: boolean
}

export interface DopplerConfigDetailResponse {
  available: boolean
  project: string
  config: string
  environment: string
  secrets: DopplerSecretEntry[]
}
