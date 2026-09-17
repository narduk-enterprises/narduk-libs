export { buildGeneratedFiles, createNardukApp } from './generate.js'
export {
  packageNameForCapability,
  packageVersionsForCapabilities,
  PACKAGE_VERSIONS,
} from './manifest.js'
export { parseCliArguments, parseUpgradeArguments, runCli } from './cli.js'
export {
  CI_CALLER_PIN_PATTERN,
  MANAGED_SCRIPT_KEYS,
  MANAGED_TARGETS,
  managedTargetFor,
  REGION_MARKERS,
  UNMANAGED_MARKER,
} from './ownership.js'
export type { ManagedTarget, OwnershipMode, RegionName } from './ownership.js'
export { formatUpgradeReport, inferUpgradeProfile, upgradeNardukApp } from './upgrade.js'
export type {
  UpgradeChange,
  UpgradeNardukAppOptions,
  UpgradeProfile,
  UpgradeReport,
  UpgradeStatus,
} from './upgrade.js'
export { unifiedDiff } from './diff.js'
export {
  CreateNardukAppError,
  GENERATED_DATABASE_BACKENDS,
  GENERATOR_NAME,
  GENERATOR_VERSION,
  SUPPORTED_CAPABILITIES,
} from './types.js'
export type {
  AppVisibility,
  Capability,
  CreateNardukAppCliOptions,
  CreateNardukAppOptions,
  CreateNardukAppReport,
  GeneratedDatabaseBackend,
  GeneratedFile,
  ProductSpec,
} from './types.js'
