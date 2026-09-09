import { statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

import type { ResolvedDurableObject } from './worker-entry.js'

/**
 * A JavaScript identifier. The class name is emitted verbatim into a generated
 * `export { <name> } from '...'` statement, so anything else would turn a
 * configuration typo into a rollup parse error with no useful location.
 */
const IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*$/u

/**
 * Extensions probed when a relative Durable Object module path is given without
 * one. Nitro's rollup resolver would find these itself, but resolving here lets
 * a missing module fail at configuration time with the path that was tried.
 */
const MODULE_SUFFIXES = ['', '.ts', '.mts', '.js', '.mjs', '/index.ts', '/index.js'] as const

function isFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile()
  } catch {
    return false
  }
}

export class NardukRealtimeConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NardukRealtimeConfigurationError'
  }
}

function resolveModulePath(className: string, modulePath: string, rootDir: string): string {
  // A bare specifier (`@scope/package/durable`) is left to the bundler: it is
  // resolved from the app's own node_modules, which this module cannot probe
  // reliably from inside a pnpm store.
  if (!modulePath.startsWith('.') && !isAbsolute(modulePath)) return modulePath

  const base = isAbsolute(modulePath) ? modulePath : resolve(rootDir, modulePath)
  // `isFile`, not `existsSync`: a bare `./server/durable/tenant` is a directory
  // on disk, and the entry point wanted there is `tenant/index.ts`.
  const found = MODULE_SUFFIXES.map((suffix) => base + suffix).find((candidate) =>
    isFile(candidate),
  )

  if (!found) {
    throw new NardukRealtimeConfigurationError(
      `realtime.durableObjects.${className} points at "${modulePath}", which does not resolve to a file. Tried: ${MODULE_SUFFIXES.map(
        (suffix) => base + suffix,
      ).join(', ')}.`,
    )
  }

  return found
}

/**
 * Validate and resolve the `realtime.durableObjects` map.
 *
 * Entries are returned sorted by class name so that the generated Worker entry
 * is byte-identical across builds of the same configuration.
 */
export function resolveDurableObjects(
  durableObjects: Record<string, string>,
  rootDir: string,
): ResolvedDurableObject[] {
  return Object.entries(durableObjects)
    .map(([className, modulePath]) => {
      if (!IDENTIFIER_PATTERN.test(className)) {
        throw new NardukRealtimeConfigurationError(
          `realtime.durableObjects key "${className}" is not a valid JavaScript identifier. Use the exported class name, for example "VesselDO".`,
        )
      }
      if (typeof modulePath !== 'string' || modulePath.trim().length === 0) {
        throw new NardukRealtimeConfigurationError(
          `realtime.durableObjects.${className} needs a module path, for example "./server/durable/vessel-do".`,
        )
      }

      return {
        className,
        modulePath: resolveModulePath(className, modulePath.trim(), rootDir),
      }
    })
    .sort((left, right) => (left.className < right.className ? -1 : 1))
}
