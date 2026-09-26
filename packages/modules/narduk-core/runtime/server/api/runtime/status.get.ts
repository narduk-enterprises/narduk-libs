import {
  FLEET_MODULE_IDS,
  listCatalogEntriesForModules,
  resolveCatalogRuntimePlane,
} from '@narduk-enterprises/narduk-platform/env-catalog'
import { defineEventHandler, setResponseHeader } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

import { trimRuntimeString } from '../../utils/runtime-env'
import { readCloudflareRuntimeEnv } from '../../utils/worker-env'

import type { CatalogEntry, FleetModuleId } from '@narduk-enterprises/narduk-platform/env-catalog'
import type { H3Event } from 'h3'

type RuntimePlane = 'runtime' | 'hybrid'
const CORE_RUNTIME_MODULES: FleetModuleId[] = ['site', 'session', 'cf-builds', 'gh-packages']
const FLEET_MODULE_ID_SET = new Set<string>(FLEET_MODULE_IDS)

interface RuntimeStatusEntry {
  key: string
  module: CatalogEntry['module']
  optional: boolean
  plane: RuntimePlane
  present: boolean
  secret: boolean
}

function isFleetRuntimeEntry(entry: CatalogEntry) {
  return entry.to.includes('cf:runtime-var') || entry.to.includes('cf:runtime-secret')
}

function resolveRuntimePlane(entry: CatalogEntry): RuntimePlane {
  return resolveCatalogRuntimePlane(entry) === 'hybrid' ? 'hybrid' : 'runtime'
}

function hasPresentRuntimeValue(env: Record<string, unknown>, key: string): boolean {
  return trimRuntimeString(env[key]).length > 0
}

function resolveRuntimeModules(event: H3Event): FleetModuleId[] {
  const config = useRuntimeConfig(event) as { nardukRuntimeModules?: unknown }
  const configured = config.nardukRuntimeModules
  if (!Array.isArray(configured)) return CORE_RUNTIME_MODULES
  const modules = configured.filter(
    (module): module is FleetModuleId =>
      typeof module === 'string' && FLEET_MODULE_ID_SET.has(module),
  )
  return modules.length > 0 ? modules : CORE_RUNTIME_MODULES
}

/** The API-key scope this route opts into (narduk-libs#971). */
const RUNTIME_STATUS_READ_SCOPE = 'runtime:status:read'

export default defineEventHandler(async (event) => {
  const { requireAdmin, requireAdminRouteScopes } = await import('../../utils/auth')
  requireAdminRouteScopes(await requireAdmin(event), [RUNTIME_STATUS_READ_SCOPE])
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const env = readCloudflareRuntimeEnv(event)
  const modules = resolveRuntimeModules(event)
  const entries = listCatalogEntriesForModules(modules)
    .filter(isFleetRuntimeEntry)
    .map((entry): RuntimeStatusEntry => ({
      key: entry.key,
      module: entry.module,
      optional: entry.optional === true,
      plane: resolveRuntimePlane(entry),
      present: hasPresentRuntimeValue(env, entry.key),
      secret: entry.secret,
    }))
  const required = entries.filter((entry) => !entry.optional)
  const missing = required.filter((entry) => !entry.present).map((entry) => entry.key)

  return {
    success: true as const,
    data: {
      runtimeBindingCount: Object.keys(env).length,
      modules,
      requiredCount: required.length,
      presentRequiredCount: required.length - missing.length,
      missingRequiredKeys: missing,
      entries,
    },
  }
})
