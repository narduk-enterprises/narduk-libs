/**
 * Shared internals for the nuxt/data-fetch tier.
 *
 * NOT a rule module — files in this directory beginning with `_` are internal
 * helpers and must be excluded from any rule enumeration in `src/index.ts`.
 */

import type { Rule } from 'eslint'

import { inAppScope, isTestOrFixturePath } from '../utils/path-scope'

export { isTestOrFixturePath }

/** See the note on the identical adapter in `hydration/_internal.ts`. */
export function inDir(filename: string, dir: string): boolean {
  return inAppScope(filename, dir)
}

export function getFilename(context: Rule.RuleContext): string {
  return (
    context.filename ??
    (context as unknown as { getFilename?(): string }).getFilename?.() ??
    ''
  ).replaceAll('\\', '/')
}

export const SCRIPT_EXTENSION_PATTERN = /\.[cm]?[jt]sx?$/

/** `server/**` in both the Nuxt 4 and Nuxt 3 layouts, absolute or relative. */
export function inServerDir(filename: string, subdir?: string): boolean {
  const tail = subdir ? `server/${subdir}/` : 'server/'
  return filename.startsWith(tail) || filename.includes(`/${tail}`)
}

/* -------------------------------------------------------------------------- */
/* callee identity                                                             */
/* -------------------------------------------------------------------------- */

/** Unwraps `($fetch as any)(…)`, `(<any>$fetch)(…)` and `a?.b(…)` wrapper nodes. */
export function unwrapCalleeWrappers(node: any): any {
  let current = node
  while (
    current &&
    (current.type === 'TSNonNullExpression' ||
      current.type === 'TSAsExpression' ||
      current.type === 'TSTypeAssertion' ||
      current.type === 'TSSatisfiesExpression' ||
      current.type === 'ChainExpression')
  ) {
    current = current.expression ?? current.argument
  }
  return current
}

/** `$fetch(…)` → `$fetch`; `api.$fetch(…)` → `$fetch`; `chokidar.watch(…)` → `watch`. */
export function calleeName(callee: any): string | null {
  const unwrapped = unwrapCalleeWrappers(callee)
  if (unwrapped?.type === 'Identifier') return unwrapped.name
  if (
    unwrapped?.type === 'MemberExpression' &&
    !unwrapped.computed &&
    unwrapped.property?.type === 'Identifier'
  ) {
    return unwrapped.property.name
  }
  return null
}

/** Only a bare, unqualified identifier callee — `fs.watch` deliberately fails this. */
export function bareCalleeName(callee: any): string | null {
  const unwrapped = unwrapCalleeWrappers(callee)
  return unwrapped?.type === 'Identifier' ? unwrapped.name : null
}

/* -------------------------------------------------------------------------- */
/* data-fetch composables                                                      */
/* -------------------------------------------------------------------------- */

export const DATA_FETCH_COMPOSABLES = new Set([
  'useAsyncData',
  'useLazyAsyncData',
  'useFetch',
  'useLazyFetch',
])

/**
 * Is this node inside the handler/options of a Nuxt data-fetch composable?
 *
 * `useAsyncData('users', () => $fetch('/api/users'))` is the canonical, correct
 * composition — v1's `no-raw-fetch` reported it as an error (deep-review proof 12).
 */
export function isInsideDataFetchComposable(node: any): boolean {
  let current: any = node?.parent
  while (current) {
    if (current.type === 'CallExpression') {
      const name = bareCalleeName(current.callee)
      if (name && DATA_FETCH_COMPOSABLES.has(name)) return true
    }
    current = current.parent
  }
  return false
}

/** `true` when no enclosing function separates the node from module/setup scope. */
export function isTopLevel(node: any): boolean {
  let current: any = node?.parent
  while (current) {
    if (
      current.type === 'FunctionDeclaration' ||
      current.type === 'FunctionExpression' ||
      current.type === 'ArrowFunctionExpression'
    ) {
      return false
    }
    current = current.parent
  }
  return true
}

/* -------------------------------------------------------------------------- */
/* I/O call shapes (receiver-aware, never keyed on the identifier `db`)         */
/* -------------------------------------------------------------------------- */

const NETWORK_CALLEES = new Set(['$fetch', 'fetch', 'ofetch'])

/** Terminal methods of a query builder — the point where a query actually runs. */
const QUERY_TERMINALS = new Set([
  'execute',
  'all',
  'run',
  'get',
  'first',
  'returning',
  'findMany',
  'findFirst',
  'batch',
  'raw',
])

/** Builder/entry methods that mark a member chain as database access. */
const QUERY_BUILDERS = new Set([
  'select',
  'insert',
  'update',
  'delete',
  'from',
  'where',
  'prepare',
  'query',
  'transaction',
])

const STORAGE_METHODS = new Set(['getItem', 'setItem', 'removeItem', 'getKeys', 'hasItem'])

const FS_CALLEES = new Set([
  'readFile',
  'writeFile',
  'appendFile',
  'readdir',
  'stat',
  'mkdir',
  'rm',
  'copyFile',
])

function memberChainNames(node: any): string[] {
  const names: string[] = []
  let current = unwrapCalleeWrappers(node)
  let guard = 0
  while (current && guard++ < 30) {
    if (current.type === 'CallExpression') {
      current = unwrapCalleeWrappers(current.callee)
      continue
    }
    if (current.type === 'MemberExpression') {
      if (!current.computed && current.property?.type === 'Identifier')
        names.push(current.property.name)
      current = unwrapCalleeWrappers(current.object)
      continue
    }
    break
  }
  return names
}

/**
 * Detects I/O by **call shape**, not by the receiver's name.
 *
 * v1's `no-blocking-io-in-server-plugin` decided a call was database I/O by
 * testing for the literal identifier `db`, so `database.select()…`, an injected
 * client, or a Drizzle handle under any other name was invisible.
 */
export function isIoCall(node: any): boolean {
  if (node?.type !== 'CallExpression') return false

  const bare = bareCalleeName(node.callee)
  if (bare && (NETWORK_CALLEES.has(bare) || FS_CALLEES.has(bare))) return true

  const callee = unwrapCalleeWrappers(node.callee)
  if (callee?.type !== 'MemberExpression') return false

  const property =
    !callee.computed && callee.property?.type === 'Identifier' ? callee.property.name : null
  if (!property) return false

  if (NETWORK_CALLEES.has(property) || FS_CALLEES.has(property) || STORAGE_METHODS.has(property))
    return true

  if (QUERY_TERMINALS.has(property)) return true

  // `db.select().from(users)` — a builder chain that is awaited without a
  // terminal method still executes (Drizzle queries are thenable).
  const chain = memberChainNames(node.callee)
  return chain.some((name) => QUERY_BUILDERS.has(name))
}

/** `Promise.all([...])` / `Promise.allSettled([...])` / `Promise.race([...])`. */
export function isPromiseCombinator(node: any): boolean {
  if (node?.type !== 'CallExpression') return false
  const callee = unwrapCalleeWrappers(node.callee)
  return (
    callee?.type === 'MemberExpression' &&
    !callee.computed &&
    callee.object?.type === 'Identifier' &&
    callee.object.name === 'Promise' &&
    callee.property?.type === 'Identifier' &&
    ['all', 'allSettled', 'race', 'any'].includes(callee.property.name)
  )
}

/** An awaited expression that performs I/O, including a `Promise.all` of I/O. */
export function isIoExpression(node: any): boolean {
  if (isIoCall(node)) return true
  if (!isPromiseCombinator(node)) return false
  const argument = node.arguments?.[0]
  const elements = argument?.type === 'ArrayExpression' ? argument.elements : []
  return elements.some(
    (element: any) =>
      isIoCall(element) || (element?.type === 'AwaitExpression' && isIoCall(element.argument)),
  )
}

/* -------------------------------------------------------------------------- */
/* HTTP method / mutation classification                                       */
/* -------------------------------------------------------------------------- */

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const MUTATION_BUILDERS = new Set(['insert', 'update', 'delete', 'transaction', 'batch'])

/**
 * Is this call a **mutation** rather than a read?
 *
 * Used to keep `no-sequential-awaited-io-in-event-handler` from recommending
 * `Promise.all` for `/cart/lock` followed by `/cart/submit`, where the ordering
 * is the point (deep-review finding on `no-sequential-awaited-data-fetching`).
 */
export function isMutationCall(node: any): boolean {
  if (node?.type !== 'CallExpression') return false

  for (const argument of node.arguments ?? []) {
    if (argument?.type !== 'ObjectExpression') continue
    for (const property of argument.properties ?? []) {
      if (
        property.type !== 'Property' ||
        property.computed ||
        !(
          (property.key?.type === 'Identifier' && property.key.name === 'method') ||
          (property.key?.type === 'Literal' && property.key.value === 'method')
        )
      ) {
        continue
      }
      // A non-literal method is unknowable — treat it as a mutation (fail safe).
      if (property.value?.type !== 'Literal') return true
      if (MUTATION_METHODS.has(String(property.value.value).toUpperCase())) return true
    }
  }

  const chain = memberChainNames(node.callee)
  return chain.some((name) => MUTATION_BUILDERS.has(name))
}

/* -------------------------------------------------------------------------- */
/* identifier reachability                                                     */
/* -------------------------------------------------------------------------- */

/** Every identifier name referenced anywhere inside `node`. */
export function collectIdentifierNames(
  node: any,
  into = new Set<string>(),
  depth = 0,
): Set<string> {
  if (!node || typeof node !== 'object' || depth > 40) return into
  if (node.type === 'Identifier' && typeof node.name === 'string') into.add(node.name)

  for (const key of Object.keys(node)) {
    if (key === 'parent' || key === 'loc' || key === 'range') continue
    const child = (node as any)[key]
    if (Array.isArray(child)) {
      for (const entry of child) {
        if (entry && typeof entry === 'object' && typeof entry.type === 'string') {
          collectIdentifierNames(entry, into, depth + 1)
        }
      }
    } else if (child && typeof child === 'object' && typeof child.type === 'string') {
      collectIdentifierNames(child, into, depth + 1)
    }
  }
  return into
}

/** Names bound by a declaration's pattern (`const { a, b } = …`). */
export function collectBoundNames(pattern: any, into = new Set<string>()): Set<string> {
  if (!pattern || typeof pattern !== 'object') return into
  switch (pattern.type) {
    case 'Identifier':
      into.add(pattern.name)
      break
    case 'ObjectPattern':
      for (const property of pattern.properties ?? []) {
        collectBoundNames(
          property.type === 'RestElement' ? property.argument : property.value,
          into,
        )
      }
      break
    case 'ArrayPattern':
      for (const element of pattern.elements ?? []) collectBoundNames(element, into)
      break
    case 'AssignmentPattern':
      collectBoundNames(pattern.left, into)
      break
    case 'RestElement':
      collectBoundNames(pattern.argument, into)
      break
    default:
      break
  }
  return into
}
