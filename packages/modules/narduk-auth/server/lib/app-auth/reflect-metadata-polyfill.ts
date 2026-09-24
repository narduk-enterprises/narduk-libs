/**
 * Workers-safe Reflect metadata polyfill for tsyringe (narduk-libs#786).
 *
 * `@simplewebauthn/server` → `@peculiar/x509` → `tsyringe` throws at module
 * evaluation when `Reflect.getMetadata` is missing:
 *
 *   tsyringe requires a reflect polyfill. Please add 'import "reflect-metadata"'
 *   to the top of your entry point.
 *
 * Cloudflare Workers does not implement the TC39 metadata proposal.
 * `@peculiar/x509` already has a bare `import 'reflect-metadata'`, but Nitro's
 * `moduleSideEffects` is an allowlist, so rollup drops that import from a
 * `cloudflare_module` bundle. This file installs the same surface as a module
 * side effect so a first-line import (and the `00-reflect-metadata` Nitro
 * plugin) runs before tsyringe evaluates.
 *
 * Implemented in-tree so narduk-auth does not need a new published dependency
 * (`package.json` for this package is owned by the open release PR).
 */

type MetadataKey = unknown
type PropertyKeyOrUndefined = PropertyKey | undefined

type ReflectMetadataHost = typeof Reflect & {
  defineMetadata?: (
    key: MetadataKey,
    value: unknown,
    target: object,
    propertyKey?: PropertyKey,
  ) => void
  deleteMetadata?: (key: MetadataKey, target: object, propertyKey?: PropertyKey) => boolean
  getMetadata?: (key: MetadataKey, target: object, propertyKey?: PropertyKey) => unknown
  getMetadataKeys?: (target: object, propertyKey?: PropertyKey) => MetadataKey[]
  getOwnMetadata?: (key: MetadataKey, target: object, propertyKey?: PropertyKey) => unknown
  getOwnMetadataKeys?: (target: object, propertyKey?: PropertyKey) => MetadataKey[]
  hasMetadata?: (key: MetadataKey, target: object, propertyKey?: PropertyKey) => boolean
  hasOwnMetadata?: (key: MetadataKey, target: object, propertyKey?: PropertyKey) => boolean
}

const metadataStore = new WeakMap<object, Map<PropertyKeyOrUndefined, Map<MetadataKey, unknown>>>()

function metadataMap(target: object, propertyKey?: PropertyKey): Map<MetadataKey, unknown> {
  let byProperty = metadataStore.get(target)
  if (!byProperty) {
    byProperty = new Map()
    metadataStore.set(target, byProperty)
  }
  let byKey = byProperty.get(propertyKey)
  if (!byKey) {
    byKey = new Map()
    byProperty.set(propertyKey, byKey)
  }
  return byKey
}

function parentOf(target: object): object | undefined {
  if (target === null || (typeof target !== 'function' && typeof target !== 'object')) {
    return undefined
  }
  const parent = Object.getPrototypeOf(target) as object | null
  if (!parent || parent === Object.prototype || parent === Function.prototype) {
    return undefined
  }
  return parent
}

function defineReflectMethod<K extends keyof ReflectMetadataHost>(
  name: K,
  value: NonNullable<ReflectMetadataHost[K]>,
): void {
  Object.defineProperty(Reflect, name, {
    configurable: true,
    enumerable: false,
    value,
    writable: true,
  })
}

export function installReflectMetadataPolyfill(): boolean {
  const reflect = Reflect as ReflectMetadataHost
  if (typeof reflect.getMetadata === 'function') {
    return false
  }

  defineReflectMethod('defineMetadata', (key, value, target, propertyKey) => {
    metadataMap(target, propertyKey).set(key, value)
  })
  defineReflectMethod('getOwnMetadata', (key, target, propertyKey) =>
    metadataMap(target, propertyKey).get(key),
  )
  defineReflectMethod('getMetadata', (key, target, propertyKey) => {
    let current: object | undefined = target
    while (current) {
      const own = metadataStore.get(current)?.get(propertyKey)
      if (own?.has(key)) return own.get(key)
      current = parentOf(current)
    }
    return
  })
  defineReflectMethod(
    'hasOwnMetadata',
    (key, target, propertyKey) => metadataStore.get(target)?.get(propertyKey)?.has(key) === true,
  )
  defineReflectMethod('hasMetadata', (key, target, propertyKey) => {
    let current: object | undefined = target
    while (current) {
      if (metadataStore.get(current)?.get(propertyKey)?.has(key)) return true
      current = parentOf(current)
    }
    return false
  })
  defineReflectMethod('getOwnMetadataKeys', (target, propertyKey) => [
    ...(metadataStore.get(target)?.get(propertyKey)?.keys() ?? []),
  ])
  defineReflectMethod('getMetadataKeys', (target, propertyKey) => {
    const keys = new Set<MetadataKey>()
    let current: object | undefined = target
    while (current) {
      for (const key of metadataStore.get(current)?.get(propertyKey)?.keys() ?? []) {
        keys.add(key)
      }
      current = parentOf(current)
    }
    return [...keys]
  })
  defineReflectMethod(
    'deleteMetadata',
    (key, target, propertyKey) => metadataStore.get(target)?.get(propertyKey)?.delete(key) === true,
  )

  return true
}

export const reflectMetadataPolyfillInstalled = installReflectMetadataPolyfill()
