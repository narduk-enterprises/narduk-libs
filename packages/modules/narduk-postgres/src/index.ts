/**
 * `@narduk-enterprises/narduk-postgres` -- one PostgreSQL access surface for
 * Narduk apps.
 *
 * The root entry carries everything that is runtime-agnostic: the executor
 * seam, errors, redaction, the bound-parameter budget, the three roles, the
 * health check, connection tuning and the backend seam. The two connection
 * paths are subpaths so a Worker bundle never pulls in `node:fs`:
 *
 *  - `./worker` -- a Hyperdrive binding, one connection per invocation;
 *  - `./node`   -- a direct connection, plus loading migrations from disk;
 *  - `./migrate`-- the immutable-file migrations runner;
 *  - `./testing`-- the protocol fake the unit suites run against.
 *
 * The Supabase backend (`createSupabaseBackend`) is root-level: it opens no
 * file and imports no driver, so it is safe in a Worker bundle.
 */

export {
  SELF_HOSTED_CAPABILITIES,
  SUPABASE_BACKEND_STATUS,
  type PostgresBackend,
  type PostgresBackendCapabilities,
  type PostgresBackendKind,
} from './backends.js'
export {
  NardukPostgresError,
  POSTGRES_ERROR_CODES,
  isNardukPostgresError,
  type PostgresErrorCode,
} from './errors.js'
export {
  checkHealth,
  type ExtensionStatus,
  type HealthCheckOptions,
  type HealthReport,
} from './health.js'
export {
  DEFAULT_PARAMETER_BUDGET,
  POSTGRES_MAX_BIND_PARAMETERS,
  assertParameterBudget,
  assertParametersPerRow,
  chunkRowsByParameterBudget,
  maxRowsPerStatement,
  placeholderTuples,
  placeholderTuplesWithCasts,
} from './parameters.js'
export {
  SUPABASE_CAPABILITIES,
  SUPABASE_TRANSACTION_POOLER_PORT,
  createSupabaseBackend,
  parseSupabaseConnectionString,
  type SupabaseBackend,
  type SupabaseBackendOptions,
  type SupabaseConnect,
  type SupabaseConnectionInfo,
  type SupabaseConnectionMode,
  type SupabasePostgresJsOptions,
  type SupabaseSsl,
} from './supabase.js'
export { REDACTED, getUnredactedCause, redactConnectionString, redactSecrets } from './redact.js'
export {
  POSTGRES_ROLES,
  assertPostgresRole,
  isPostgresRole,
  resetRoleStatement,
  roleGrantStatements,
  setRoleStatement,
  type PostgresRoleName,
  type RolePrivilegeSpec,
  type RolePrivileges,
} from './roles.js'
export {
  NODE_TUNING_DEFAULTS,
  WORKER_CONNECTION_CEILING,
  WORKER_DEFAULT_MAX_CONNECTIONS,
  WORKER_TUNING_DEFAULTS,
  resolveTuning,
  startupParameters,
  toNodePostgresOptions,
  toPostgresJsOptions,
  type ConnectionTuning,
  type ConnectionTuningOptions,
  type NodePostgresOptions,
  type PostgresJsOptions,
} from './tuning.js'
export {
  isTransactionalExecutor,
  type ConnectionFactory,
  type ManagedConnection,
  type QueryResult,
  type SqlExecutor,
  type TransactionalExecutor,
} from './types.js'
