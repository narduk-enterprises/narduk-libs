/**
 * Shared Cloudflare Worker-runtime gate and module-evaluation analyzer.
 *
 * Replaces v1's `rules/cloudflare/utils.ts`, which the deep review graded
 * UNRELIABLE for three separate reasons:
 *
 *   1. `isWorkerRuntimeFile` tested `normalized.includes('/workers/')` against
 *      the **whole absolute path**. A developer whose checkout lives under
 *      `~/workers/` had every file in every project — `.vue` pages included —
 *      classified as Worker runtime.
 *   2. A **module-level** `WeakMap` cached recursion-truncated results keyed
 *      only by AST node, shared across all three Cloudflare rules and across
 *      lint runs in a long-lived editor server. A node visited first during a
 *      truncated recursion poisoned the answer for every later query.
 *   3. Callback-invoked module scope (`arr.map(() => new Pool())`) was not
 *      detected: the arrow is neither immediately invoked nor bound to a
 *      variable, so the analyzer concluded it never runs.
 *
 * All three are fixed below. Caches are created per analyzer instance (one per
 * `create()` call, i.e. one per file per rule), never at module level.
 */

import { existsSync } from 'node:fs'

import type { SourceCode } from 'eslint'

import { isTestOrFixturePath } from './path-scope'

/* -------------------------------------------------------------------------- */
/* Worker-runtime file detection                                              */
/* -------------------------------------------------------------------------- */

export const WORKER_HANDLERS_DOCS_URL =
  'https://developers.cloudflare.com/workers/runtime-apis/handlers/'

export const HYPERDRIVE_TROUBLESHOOTING_DOCS_URL =
  'https://developers.cloudflare.com/hyperdrive/observability/troubleshooting/'

/**
 * Files whose presence marks a directory as a deployable project root.
 * `package.json` is probed first purely for cost: the check is "does this
 * directory hold ANY manifest", so the order does not change the answer, and
 * the most common hit first means one stat per directory instead of ten.
 */
const PROJECT_ROOT_MANIFESTS: readonly string[] = [
  'package.json',
  'wrangler.toml',
  'wrangler.json',
  'wrangler.jsonc',
  'nuxt.config.ts',
  'nuxt.config.js',
  'nuxt.config.mjs',
  'nitro.config.ts',
  'nitro.config.js',
  'nitro.config.mjs',
]

export type WorkerRuntimeReason =
  | 'test-or-fixture'
  | 'explicit-glob'
  | 'file-marker'
  | 'nitro-server-dir'
  | 'worker-dir-in-project'
  | 'pages-functions-dir'
  | 'outside-project-root'
  | 'not-worker'

export interface WorkerRuntimeClassification {
  isWorkerRuntime: boolean
  /** Which signal decided the answer — surfaced so tests assert the *reason*. */
  reason: WorkerRuntimeReason
  /** Directory the decision was made relative to, when one was resolved. */
  projectRoot: string | null
  /** The file path relative to `projectRoot`, which is what gets classified. */
  relativePath: string | null
}

export interface WorkerRuntimeOptions {
  /** ESLint's `context.cwd`. The primary project-root signal — no I/O needed. */
  cwd?: string | null
  /**
   * Injected manifest probe: given an absolute directory, does it hold a
   * project manifest? Defaults to a filesystem check. Injectable so the
   * detection logic is unit-testable without touching disk.
   */
  hasManifest?: (directory: string) => boolean
  /** Extra project-relative path prefixes to treat as Worker runtime. */
  workerPathPrefixes?: readonly string[]
  /** Predicate marking test/fixture files, which are never Worker runtime. */
  isTestOrFixture?: (filename: string) => boolean
}

function normalize(filename: string): string {
  return String(filename ?? '').replaceAll('\\', '/')
}

/**
 * Walk up from `startDirectory` looking for a project manifest, stopping at
 * `stopAt` (ESLint's cwd) so the probe can never wander above the workspace.
 * Results are memoized in the caller-supplied map, which lives for exactly one
 * `create()` call — never at module level.
 */
function resolveProjectRoot(
  startDirectory: string,
  stopAt: string | null,
  hasManifest: (directory: string) => boolean,
  cache: Map<string, string | null>,
): string | null {
  const seen: string[] = []
  let current = startDirectory

  for (let depth = 0; current && depth < 64; depth += 1) {
    const cached = cache.get(current)
    if (cached !== undefined) {
      for (const directory of seen) cache.set(directory, cached)
      return cached
    }
    seen.push(current)

    if (hasManifest(current)) {
      for (const directory of seen) cache.set(directory, current)
      return current
    }
    if (stopAt && current === stopAt) break

    const parent = current.slice(0, current.lastIndexOf('/'))
    if (!parent || parent === current) break
    current = parent
  }

  const fallback = stopAt && startDirectory.startsWith(stopAt) ? stopAt : null
  for (const directory of seen) cache.set(directory, fallback)
  return fallback
}

function defaultManifestProbe(directory: string): boolean {
  return PROJECT_ROOT_MANIFESTS.some((manifest) => existsSync(`${directory}/${manifest}`))
}

/**
 * Classify a file as Cloudflare Worker runtime or not.
 *
 * **Signals that decide the answer, in order:**
 *
 * 1. *Test/fixture path* → never Worker runtime. Checked first so a fixture
 *    named `server/api/x.ts` inside a test tree cannot be linted as runtime.
 * 2. *Explicit config prefix* (`workerPathPrefixes`) → Worker runtime. The
 *    escape hatch for layouts this heuristic does not know.
 * 3. *File-level marker* — `*.worker.ts` / `*.server.ts`. Marker lives in the
 *    filename itself, so no ancestor directory can fake it.
 * 4. *Project-relative layout* — and this is the fix for the `~/workers/`
 *    bug. The path is first made relative to a **project root** (the nearest
 *    ancestor holding `wrangler.*` / `nuxt.config.*` / `nitro.config.*` /
 *    `package.json`, never above ESLint's `cwd`). Only then are the layout
 *    prefixes matched: `server/` (Nitro), `workers/` (Worker entry dir),
 *    `functions/` (Pages Functions). A checkout at `~/workers/my-app` yields
 *    `projectRoot=~/workers/my-app`, so `app/pages/index.vue` is relative path
 *    `app/pages/index.vue` — no `workers/` segment, correctly not runtime.
 * 5. Anything else → not Worker runtime.
 */
export function classifyWorkerRuntimeFile(
  filename: string,
  options: WorkerRuntimeOptions = {},
): WorkerRuntimeClassification {
  const normalized = normalize(filename)
  const isTestOrFixture = options.isTestOrFixture ?? isTestOrFixturePath

  if (!normalized) {
    return { isWorkerRuntime: false, reason: 'not-worker', projectRoot: null, relativePath: null }
  }

  if (isTestOrFixture(normalized)) {
    return {
      isWorkerRuntime: false,
      reason: 'test-or-fixture',
      projectRoot: null,
      relativePath: null,
    }
  }

  const cwd = options.cwd ? normalize(options.cwd).replace(/\/+$/, '') : null
  const hasManifest = options.hasManifest ?? defaultManifestProbe
  const directory = normalized.slice(0, normalized.lastIndexOf('/')) || '/'

  const projectRoot = normalized.startsWith('/')
    ? resolveProjectRoot(directory, cwd, hasManifest, new Map())
    : cwd
  const relativePath =
    projectRoot && normalized.startsWith(`${projectRoot}/`)
      ? normalized.slice(projectRoot.length + 1)
      : normalized.startsWith('/')
        ? null
        : normalized.replace(/^\.\//, '')

  const basename = normalized.slice(normalized.lastIndexOf('/') + 1)

  for (const prefix of options.workerPathPrefixes ?? []) {
    const cleaned = prefix.replace(/^\.?\//, '')
    if (relativePath && (relativePath === cleaned || relativePath.startsWith(cleaned))) {
      return { isWorkerRuntime: true, reason: 'explicit-glob', projectRoot, relativePath }
    }
  }

  if (/\.(?:worker|server)\.[cm]?[jt]sx?$/.test(basename)) {
    return { isWorkerRuntime: true, reason: 'file-marker', projectRoot, relativePath }
  }

  if (relativePath === null) {
    // Absolute path with no resolvable project root (and not under cwd). Only
    // the filename marker above can classify it; guessing from ancestors is
    // precisely the bug this function exists to fix.
    return {
      isWorkerRuntime: false,
      reason: 'outside-project-root',
      projectRoot,
      relativePath: null,
    }
  }

  // `server/` may be nested under a Nuxt layer (`layers/admin/server/api/x.ts`)
  // or an app dir in a monorepo, so match the segment anywhere in the
  // *project-relative* path rather than only at its start.
  if (/(?:^|\/)server\//.test(relativePath)) {
    return { isWorkerRuntime: true, reason: 'nitro-server-dir', projectRoot, relativePath }
  }
  if (/(?:^|\/)workers\//.test(relativePath)) {
    return { isWorkerRuntime: true, reason: 'worker-dir-in-project', projectRoot, relativePath }
  }
  if (/(?:^|\/)functions\//.test(relativePath)) {
    return { isWorkerRuntime: true, reason: 'pages-functions-dir', projectRoot, relativePath }
  }

  return { isWorkerRuntime: false, reason: 'not-worker', projectRoot, relativePath }
}

export function isWorkerRuntimeFile(filename: string, options: WorkerRuntimeOptions = {}): boolean {
  return classifyWorkerRuntimeFile(filename, options).isWorkerRuntime
}

/**
 * Build a per-`create()` resolver. The manifest cache lives on the returned
 * object, so it dies with the rule instance and can never serve a stale answer
 * to a later lint run.
 */
export function createWorkerRuntimeResolver(options: WorkerRuntimeOptions = {}) {
  const manifestCache = new Map<string, boolean>()
  const baseProbe = options.hasManifest ?? defaultManifestProbe
  const hasManifest = (directory: string): boolean => {
    const cached = manifestCache.get(directory)
    if (cached !== undefined) return cached
    const result = baseProbe(directory)
    manifestCache.set(directory, result)
    return result
  }

  return {
    classify: (filename: string) =>
      classifyWorkerRuntimeFile(filename, { ...options, hasManifest }),
    isWorkerRuntime: (filename: string) =>
      classifyWorkerRuntimeFile(filename, { ...options, hasManifest }).isWorkerRuntime,
  }
}

/* -------------------------------------------------------------------------- */
/* Module-evaluation analysis                                                 */
/* -------------------------------------------------------------------------- */

export function getPropertyName(node: any): string | null {
  if (!node) return null
  if (node.type === 'Identifier') return node.name
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value
  return null
}

function isFunctionLike(node: any): boolean {
  return (
    node?.type === 'FunctionDeclaration' ||
    node?.type === 'FunctionExpression' ||
    node?.type === 'ArrowFunctionExpression'
  )
}

function isCallLike(node: any, callee: any): boolean {
  return (
    (node?.type === 'CallExpression' || node?.type === 'NewExpression') && node.callee === callee
  )
}

function isImmediatelyInvoked(node: any): boolean {
  const parent = node?.parent
  return (
    (parent?.type === 'CallExpression' && parent.callee === node) ||
    (parent?.type === 'NewExpression' && parent.callee === node)
  )
}

/**
 * Higher-order methods that invoke their callback **synchronously, during the
 * call**. This is the fix for `arr.map(() => new Pool())`: the arrow is not
 * immediately invoked and is bound to no variable, but `.map()` runs it right
 * now, so anything inside it executes during module evaluation.
 *
 * Deliberately excludes deferring receivers — `setTimeout`, `queueMicrotask`,
 * `addEventListener`, `.then`, `.catch`, `.finally` — whose callbacks do *not*
 * run during module evaluation and must not be reported.
 */
const EAGER_CALLBACK_METHODS: ReadonlySet<string> = new Set([
  'map',
  'forEach',
  'filter',
  'flatMap',
  'reduce',
  'reduceRight',
  'some',
  'every',
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'sort',
  'toSorted',
  'group',
  'groupBy',
])

/** `Array.from(x, fn)` and `Object.groupBy(x, fn)` also invoke eagerly. */
const EAGER_STATIC_CALLS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['Array', new Set(['from'])],
  ['Object', new Set(['groupBy'])],
  ['Map', new Set(['groupBy'])],
])

function isEagerCallbackInvocation(call: any): boolean {
  if (call?.type !== 'CallExpression') return false
  const callee = call.callee
  if (callee?.type !== 'MemberExpression') return false

  const propertyName = getPropertyName(callee.property)
  if (!propertyName) return false

  const objectName = getPropertyName(callee.object)
  const staticMethods = objectName ? EAGER_STATIC_CALLS.get(objectName) : undefined
  if (staticMethods?.has(propertyName)) return true

  return EAGER_CALLBACK_METHODS.has(propertyName)
}

/**
 * `new Promise(executor)` runs `executor` synchronously, during construction
 * (narduk-libs#887), so the executor inherits the `new` expression's execution
 * context. Only the executor argument itself: `resolve`/`reject` and anything
 * the executor defers (`setTimeout`, `.then`) are judged on their own.
 */
function isPromiseExecutorArgument(expression: any, argument: any): boolean {
  return (
    expression?.type === 'NewExpression' &&
    expression.callee?.type === 'Identifier' &&
    expression.callee.name === 'Promise' &&
    expression.arguments?.[0] === argument
  )
}

export interface ModuleEvaluationAnalyzer {
  isExecutedDuringModuleEvaluation(node: any): boolean
}

/**
 * Create an analyzer bound to one `SourceCode`.
 *
 * The memo is created **here**, per instance, not at module level: the v1
 * module-level `WeakMap` stored results computed under a truncated recursion
 * and reused them forever, across files and across lint runs.
 */
export function createModuleEvaluationAnalyzer(sourceCode: SourceCode): ModuleEvaluationAnalyzer {
  const functionInvocationMemo = new WeakMap<any, boolean>()

  function getDeclaredFunctionVariable(functionNode: any): any | null {
    if (functionNode?.type === 'FunctionDeclaration') {
      return sourceCode.getDeclaredVariables(functionNode)[0] ?? null
    }
    const parent = functionNode?.parent
    if (parent?.type === 'VariableDeclarator' && parent.id?.type === 'Identifier') {
      return sourceCode.getDeclaredVariables(parent)[0] ?? null
    }
    return null
  }

  function hasMemberInvocationDuringModuleEvaluation(
    variable: any,
    propertyName: string,
    seen: Set<any>,
  ): boolean {
    return variable.references.some((reference: any) => {
      const identifier = reference.identifier
      const parent = identifier?.parent
      if (!reference.isRead?.() || !parent) return false
      if (
        parent.type === 'MemberExpression' &&
        parent.object === identifier &&
        getPropertyName(parent.property) === propertyName &&
        isCallLike(parent.parent, parent)
      ) {
        return isExecutedDuringModuleEvaluation(parent.parent, seen)
      }
      return false
    })
  }

  function hasInstanceMethodInvocationDuringModuleEvaluation(
    classVariable: any,
    methodName: string,
    seen: Set<any>,
  ): boolean {
    return classVariable.references.some((reference: any) => {
      const identifier = reference.identifier
      const parent = identifier?.parent
      if (!reference.isRead?.() || !parent) return false
      if (parent.type !== 'NewExpression' || parent.callee !== identifier) return false

      if (
        parent.parent?.type === 'MemberExpression' &&
        parent.parent.object === parent &&
        getPropertyName(parent.parent.property) === methodName &&
        isCallLike(parent.parent.parent, parent.parent)
      ) {
        return isExecutedDuringModuleEvaluation(parent.parent.parent, seen)
      }

      if (parent.parent?.type !== 'VariableDeclarator' || parent.parent.id?.type !== 'Identifier') {
        return false
      }

      const instanceVariable = sourceCode.getDeclaredVariables(parent.parent)[0] ?? null
      if (!instanceVariable) return false
      return hasMemberInvocationDuringModuleEvaluation(instanceVariable, methodName, seen)
    })
  }

  function isMethodInvokedDuringModuleEvaluation(functionNode: any, seen: Set<any>): boolean {
    const parent = functionNode?.parent

    if (parent?.type === 'Property' && parent.value === functionNode) {
      const propertyName = getPropertyName(parent.key)
      const objectExpression = parent.parent
      const container = objectExpression?.parent
      if (
        !propertyName ||
        objectExpression?.type !== 'ObjectExpression' ||
        container?.type !== 'VariableDeclarator' ||
        container.id?.type !== 'Identifier'
      ) {
        return false
      }
      const objectVariable = sourceCode.getDeclaredVariables(container)[0] ?? null
      if (!objectVariable) return false
      return hasMemberInvocationDuringModuleEvaluation(objectVariable, propertyName, seen)
    }

    if (parent?.type === 'MethodDefinition' && parent.value === functionNode) {
      const methodName = getPropertyName(parent.key)
      const classBody = parent.parent
      const classNode = classBody?.parent
      if (
        !methodName ||
        classBody?.type !== 'ClassBody' ||
        (classNode?.type !== 'ClassDeclaration' && classNode?.type !== 'ClassExpression')
      ) {
        return false
      }
      const classVariable =
        classNode.type === 'ClassDeclaration'
          ? (sourceCode.getDeclaredVariables(classNode)[0] ?? null)
          : classNode.parent?.type === 'VariableDeclarator'
            ? (sourceCode.getDeclaredVariables(classNode.parent)[0] ?? null)
            : null
      if (!classVariable) return false
      if (parent.static) {
        return hasMemberInvocationDuringModuleEvaluation(classVariable, methodName, seen)
      }
      return hasInstanceMethodInvocationDuringModuleEvaluation(classVariable, methodName, seen)
    }

    return false
  }

  function isFunctionInvokedDuringModuleEvaluation(functionNode: any, seen: Set<any>): boolean {
    const memoized = functionInvocationMemo.get(functionNode)
    if (memoized !== undefined) return memoized

    // Recursion guard. The result is *not* memoized while the guard is active,
    // because a truncated `false` is an artifact of the walk order, not an
    // answer — memoizing it is precisely v1's cache-poisoning bug.
    if (seen.has(functionNode)) return false
    seen.add(functionNode)

    let result: boolean

    if (isImmediatelyInvoked(functionNode)) {
      result = isExecutedDuringModuleEvaluation(functionNode.parent, seen)
    } else if (
      functionNode?.parent?.type === 'CallExpression' &&
      functionNode.parent.callee !== functionNode &&
      isEagerCallbackInvocation(functionNode.parent)
    ) {
      // `[cfg].map(() => new Pool())` — the callback runs synchronously inside
      // the `.map()` call, so it inherits that call's execution context.
      result = isExecutedDuringModuleEvaluation(functionNode.parent, seen)
    } else if (isPromiseExecutorArgument(functionNode?.parent, functionNode)) {
      result = isExecutedDuringModuleEvaluation(functionNode.parent, seen)
    } else {
      const variable = getDeclaredFunctionVariable(functionNode)
      result = variable
        ? variable.references.some((reference: any) => {
            const identifier = reference.identifier
            const parent = identifier?.parent
            if (!reference.isRead?.() || !parent) return false
            // Directly called: `factory()`.
            if (isCallLike(parent, identifier)) {
              return isExecutedDuringModuleEvaluation(parent, seen)
            }
            // Passed as an eagerly-invoked callback: `list.map(factory)`.
            if (
              parent.type === 'CallExpression' &&
              parent.callee !== identifier &&
              parent.arguments?.includes(identifier) &&
              isEagerCallbackInvocation(parent)
            ) {
              return isExecutedDuringModuleEvaluation(parent, seen)
            }
            // Passed as a Promise executor: `new Promise(start)`.
            if (isPromiseExecutorArgument(parent, identifier)) {
              return isExecutedDuringModuleEvaluation(parent, seen)
            }
            return false
          })
        : isMethodInvokedDuringModuleEvaluation(functionNode, seen)
    }

    seen.delete(functionNode)
    if (seen.size === 0) functionInvocationMemo.set(functionNode, result)
    return result
  }

  function isExecutedDuringModuleEvaluation(node: any, seen = new Set<any>()): boolean {
    let current = node?.parent
    for (let depth = 0; current && depth < 512; depth += 1) {
      if (current.type === 'Program') return true
      if (isFunctionLike(current)) {
        return isFunctionInvokedDuringModuleEvaluation(current, seen)
      }
      // A class body's static block / field initializer runs at class
      // definition time, which is module evaluation for a top-level class.
      current = current.parent
    }
    return false
  }

  return {
    isExecutedDuringModuleEvaluation: (node: any) => isExecutedDuringModuleEvaluation(node),
  }
}
