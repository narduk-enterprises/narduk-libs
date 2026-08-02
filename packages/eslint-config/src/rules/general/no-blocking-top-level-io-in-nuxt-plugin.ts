/**
 * Nuxt runs plugins sequentially unless a plugin opts into `parallel: true`.
 * A top-level `await` of I/O in a non-parallel async plugin blocks app
 * readiness and TTFB for every request.
 *
 * Deep-review verdict: SOLID / KEEP (25 tests).
 *
 * TWO REVIEW FINDINGS IMPLEMENTED:
 *
 * 1. `testMode` removed. DESIGN.md bans it outright ("the old suites'
 *    `testMode` bypass, which let a dead CSRF gate ship green"). v1's option
 *    made `isNuxtPluginFile()` return `true` unconditionally, so a suite could
 *    pass without the path gate ever executing. The gate is now always live and
 *    is exercised through real filenames, including the relative ones ESLint
 *    actually reports.
 *
 * 2. The path gate moved to the shared, tested `path-scope` util — the review's
 *    leading-slash bug class, plus the seven divergent inline copies of one
 *    test/fixture predicate. v1's gate here was already
 *    `startsWith('app/plugins/') || includes('/app/plugins/')`, i.e. it already
 *    handled relative filenames, so the scope this rule reports on is
 *    unchanged; what changes is that the anchoring is proven once instead of
 *    re-derived per rule. The `packages/myapp/plugins/` false-positive guard v1
 *    documented in a comment is now a segment-anchored property of the util and
 *    is asserted as a `valid` case here.
 *
 * The data-fetch AST predicates are inlined rather than imported from the
 * shared `utils/data-fetch-ast` module: the review graded that 733-LOC module
 * SHAKY with no direct test, and this rule needs four of its predicates. They
 * are reproduced here verbatim in behaviour so the port neither inherits an
 * untested dependency nor changes what the rule reports.
 */

import type { Rule } from 'eslint'
import { inAppScope, isTestOrFixturePath, toPosixPath } from '../utils/path-scope'

/* ------------------------------------------------------------------ *
 * Inlined from v1 `src/rules/utils/data-fetch-ast.ts` (behaviour-for-behaviour)
 * ------------------------------------------------------------------ */

const DATA_FETCH_NAMES = new Set([
  'useAsyncData',
  'useFetch',
  'useLazyFetch',
  'useLazyAsyncData',
  '$fetch',
])

const SERVER_IO_FETCH_NAMES = new Set([...DATA_FETCH_NAMES, 'fetch', 'ofetch', '$ofetch'])

/** Strip TS value-wrappers that do not change runtime semantics. */
function unwrapTypeCasts(node: any): any {
  let cur = node
  for (let i = 0; cur && i < 16; i++) {
    if (
      cur.type === 'TSAsExpression' ||
      cur.type === 'TSSatisfiesExpression' ||
      cur.type === 'TSTypeAssertion' ||
      cur.type === 'TSNonNullExpression' ||
      cur.type === 'TSInstantiationExpression' ||
      cur.type === 'ParenthesizedExpression'
    ) {
      cur = cur.expression
    } else {
      return cur
    }
  }
  return cur
}

function unwrapChain(node: any): any {
  const c = unwrapTypeCasts(node)
  if (c?.type === 'ChainExpression') {
    return unwrapTypeCasts(c.expression)
  }
  return c
}

function getCallCalleeName(callee: any): string | null {
  const c = unwrapChain(callee)
  if (c?.type === 'Identifier') {
    return c.name
  }
  if (c?.type === 'MemberExpression' && c.property?.type === 'Identifier') {
    return c.property.name
  }
  return null
}

function asCallExpression(node: any): any | null {
  const n = unwrapChain(node)
  return n?.type === 'CallExpression' && n.callee ? n : null
}

function isDataFetchCallExpression(node: any): boolean {
  const call = asCallExpression(node)
  if (!call) return false
  const name = getCallCalleeName(call.callee)
  return name !== null && DATA_FETCH_NAMES.has(name)
}

function isServerIoCallExpression(node: any): boolean {
  const call = asCallExpression(node)
  if (!call) return false
  const name = getCallCalleeName(call.callee)
  return name !== null && SERVER_IO_FETCH_NAMES.has(name)
}

/**
 * Resolve `defineNuxtPlugin(setup)` to the local function `setup` names, using
 * the scope manager rather than scanning `Program.body`. Best-effort: params
 * and imports are not followed.
 */
function resolveIdentifierToFunction(
  scopeManager: any,
  containingNode: any,
  identifier: any,
): any | null {
  if (identifier?.type !== 'Identifier' || !scopeManager) {
    return null
  }

  let scope: any = null
  let cursor: any = containingNode
  while (cursor && !scope) {
    scope = scopeManager.acquire(cursor, true) ?? scopeManager.acquire(cursor)
    cursor = cursor.parent
  }
  if (!scope) {
    scope = scopeManager.globalScope
    const moduleScope = scope?.childScopes?.find((s: any) => s.type === 'module')
    if (moduleScope) {
      scope = moduleScope
    }
  }

  let cur: any = scope
  let foundVar: any = null
  while (cur) {
    foundVar = cur.variables?.find((v: any) => v.name === identifier.name) ?? null
    if (foundVar) break
    cur = cur.upper
  }
  if (!foundVar || foundVar.defs.length === 0) {
    return null
  }

  const def = foundVar.defs[0]
  if (def.type === 'Parameter' || def.type === 'ImportBinding') {
    return null
  }
  const decl = def.node
  if (!decl) {
    return null
  }
  if (decl.type === 'FunctionDeclaration') {
    return decl
  }
  if (decl.type === 'VariableDeclarator') {
    const init = decl.init ? unwrapChain(decl.init) : null
    if (init?.type === 'FunctionExpression' || init?.type === 'ArrowFunctionExpression') {
      return init
    }
  }
  return null
}

/** Find a matching `AwaitExpression` without descending into nested functions. */
function findAwaitInExpression(node: any, predicate: (awaited: any) => boolean): any | null {
  if (!node || typeof node !== 'object') {
    return null
  }
  if (node.type === 'AwaitExpression' && predicate(node)) {
    return node
  }
  if (
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression' ||
    node.type === 'FunctionDeclaration'
  ) {
    return null
  }
  for (const key of Object.keys(node)) {
    if (
      key === 'parent' ||
      key === 'loc' ||
      key === 'range' ||
      key === 'tokens' ||
      key === 'comments'
    ) {
      continue
    }
    const child = node[key]
    if (!child || typeof child !== 'object') {
      continue
    }
    if (Array.isArray(child)) {
      for (const item of child) {
        const hit = findAwaitInExpression(item, predicate)
        if (hit) return hit
      }
    } else {
      const hit = findAwaitInExpression(child, predicate)
      if (hit) return hit
    }
  }
  return null
}

/* ------------------------------------------------------------------ *
 * Rule
 * ------------------------------------------------------------------ */

function getDefineNuxtPluginCall(node: any): any | null {
  if (node.type !== 'CallExpression') {
    return null
  }
  const name =
    node.callee?.type === 'Identifier'
      ? node.callee.name
      : node.callee?.type === 'MemberExpression' && node.callee.property?.type === 'Identifier'
        ? node.callee.property.name
        : null
  return name === 'defineNuxtPlugin' ? node : null
}

function hasParallelTrue(obj: any): boolean {
  if (obj?.type !== 'ObjectExpression') {
    return false
  }
  for (const p of obj.properties ?? []) {
    if (p.type !== 'Property' || p.key == null) continue
    const k =
      p.key.type === 'Identifier'
        ? p.key.name
        : p.key.type === 'Literal'
          ? String(p.key.value)
          : null
    if (k === 'parallel' && p.value?.type === 'Literal' && p.value.value === true) {
      return true
    }
  }
  return false
}

function isTopLevelIoAwait(awa: any): boolean {
  if (awa?.type !== 'AwaitExpression' || !awa.argument) {
    return false
  }
  return isDataFetchCallExpression(awa.argument) || isServerIoCallExpression(awa.argument)
}

function findAwaitInStatements(stmts: any[]): any {
  for (const stmt of stmts) {
    const found = findAwaitInStatement(stmt)
    if (found) return found
  }
  return null
}

function findAwaitInStatement(stmt: any): any {
  if (!stmt) {
    return null
  }
  if (
    stmt.type === 'ExpressionStatement' &&
    stmt.expression?.type === 'AwaitExpression' &&
    isTopLevelIoAwait(stmt.expression)
  ) {
    return stmt.expression
  }
  if (
    stmt.type === 'ReturnStatement' &&
    stmt.argument?.type === 'AwaitExpression' &&
    isTopLevelIoAwait(stmt.argument)
  ) {
    return stmt.argument
  }
  if (stmt.type === 'VariableDeclaration') {
    for (const d of stmt.declarations ?? []) {
      if (d.init?.type === 'AwaitExpression' && isTopLevelIoAwait(d.init)) {
        return d.init
      }
    }
  }
  if (stmt.type === 'BlockStatement') {
    return findAwaitInStatements(stmt.body ?? [])
  }
  if (stmt.type === 'IfStatement') {
    return findAwaitInStatement(stmt.consequent) || findAwaitInStatement(stmt.alternate)
  }
  if (stmt.type === 'TryStatement') {
    return (
      findAwaitInStatement(stmt.block) ||
      findAwaitInStatement(stmt.handler?.body) ||
      findAwaitInStatement(stmt.finalizer)
    )
  }
  if (stmt.type === 'SwitchStatement') {
    for (const sc of stmt.cases ?? []) {
      const found = findAwaitInStatements(sc.consequent ?? [])
      if (found) return found
    }
    return null
  }
  // Loops at the top level still block plugin boot / TTFB on every iteration.
  if (stmt.type === 'ForOfStatement' || stmt.type === 'ForInStatement') {
    if (stmt.right?.type === 'AwaitExpression' && isTopLevelIoAwait(stmt.right)) {
      return stmt.right
    }
    return findAwaitInStatement(stmt.body)
  }
  if (stmt.type === 'WhileStatement' || stmt.type === 'DoWhileStatement') {
    return findAwaitInStatement(stmt.body)
  }
  if (stmt.type === 'ForStatement') {
    if (stmt.init?.type === 'VariableDeclaration') {
      for (const d of stmt.init.declarations ?? []) {
        if (d.init?.type === 'AwaitExpression' && isTopLevelIoAwait(d.init)) {
          return d.init
        }
      }
    } else if (stmt.init) {
      const hit = findAwaitInExpression(stmt.init, isTopLevelIoAwait)
      if (hit) return hit
    }
    return findAwaitInStatement(stmt.body)
  }
  return null
}

/**
 * Find the first top-level `await` of I/O in a function body, handling both
 * block bodies and expression bodies. Walks into control flow (those still
 * block top-level execution) but not into nested function bodies.
 */
function findTopLevelIoAwaitInFnBody(body: any): any {
  if (!body) {
    return null
  }
  if (body.type === 'AwaitExpression' && isTopLevelIoAwait(body)) {
    return body
  }
  if (body.type !== 'BlockStatement') {
    return null
  }
  return findAwaitInStatements(body.body ?? [])
}

/** ESM module-scope top-level await; Nuxt loads the module during app init. */
function topLevelProgramAwait(prog: any): any {
  for (const stmt of prog.body ?? []) {
    if (
      stmt.type === 'ExportDefaultDeclaration' &&
      stmt.declaration?.type === 'AwaitExpression' &&
      isTopLevelIoAwait(stmt.declaration)
    ) {
      return stmt.declaration
    }
    if (stmt.type === 'ExportNamedDeclaration' && stmt.declaration) {
      const inner = findAwaitInStatement(stmt.declaration)
      if (inner) return inner
    }
    const found = findAwaitInStatement(stmt)
    if (found) return found
  }
  return null
}

function getSetupFromObjectPlugin(arg0: any): { fn: any; parallel: boolean } | null {
  if (arg0?.type !== 'ObjectExpression') {
    return null
  }
  const parallel = hasParallelTrue(arg0)
  for (const p of arg0.properties ?? []) {
    if (p.type !== 'Property' || p.key == null) continue
    const k =
      p.key.type === 'Identifier'
        ? p.key.name
        : p.key.type === 'Literal'
          ? String(p.key.value)
          : null
    if (k === 'setup' && p.value) {
      return { fn: p.value, parallel }
    }
  }
  return null
}

export default {
  meta: {
    type: 'problem' as const,
    docs: {
      description: 'disallow top-level I/O await in Nuxt plugins without `parallel: true`',
      recommended: true,
      url: 'https://nuxt.com/docs/guide/directory-structure/plugins#parallel-plugins',
    },
    schema: [],
    messages: {
      blockingPlugin:
        'Top-level `await` of I/O in a Nuxt plugin blocks the pipeline until this plugin finishes. For independent work, set `parallel: true` in `defineNuxtPlugin({...})` or move I/O to lazy hooks. See: https://nuxt.com/docs/guide/directory-structure/plugins#parallel-plugins',
    },
  },

  create(context: Rule.RuleContext): Rule.RuleListener {
    const scopeManager = (context.sourceCode as any)?.scopeManager ?? null
    const filename = context.filename
    // Nuxt 4 convention: `<srcDir>/app/plugins/…`. Segment-anchored, so
    // `packages/myapp/plugins/init.ts` is out of scope.
    //
    // The `node_modules` exclusion is v1 behaviour (`isNuxtPluginFile` opened
    // with `if (n.includes('node_modules')) return false`) and is kept here
    // rather than pushed into `path-scope`: the shared util is deliberately a
    // pure segment matcher, and two of the other three rules ported in this
    // lane never had a dependency exemption, so adding one there would change
    // what they report.
    const inScope =
      inAppScope(filename, 'app/plugins') &&
      !isTestOrFixturePath(filename) &&
      !toPosixPath(filename).split('/').includes('node_modules')

    if (!inScope) {
      return {}
    }

    return {
      Program(node: any) {
        const tla = topLevelProgramAwait(node)
        if (tla) {
          context.report({ node: tla, messageId: 'blockingPlugin' })
        }
      },

      CallExpression(node: any) {
        if (!getDefineNuxtPluginCall(node)) {
          return
        }

        const first = node.arguments[0]
        if (!first) {
          return
        }

        const fromSetup = getSetupFromObjectPlugin(first)
        if (fromSetup) {
          if (fromSetup.parallel) {
            return
          }
          const f = fromSetup.fn
          if (f.type !== 'ArrowFunctionExpression' && f.type !== 'FunctionExpression') {
            return
          }
          if (f.async === false) {
            return
          }
          const aw = findTopLevelIoAwaitInFnBody(f.body)
          if (aw) {
            context.report({ node: aw, messageId: 'blockingPlugin' })
          }
          return
        }

        let fn: any = null
        if (first.type === 'ArrowFunctionExpression' || first.type === 'FunctionExpression') {
          fn = first
        } else if (first.type === 'Identifier') {
          // Indirect: `async function setup() {…}; defineNuxtPlugin(setup)` —
          // the blocking behaviour is identical to inlining the function.
          fn = resolveIdentifierToFunction(scopeManager, node, first)
        }
        if (!fn || fn.async === false) {
          return
        }
        const aw = findTopLevelIoAwaitInFnBody(fn.body)
        if (aw) {
          context.report({ node: aw, messageId: 'blockingPlugin' })
        }
      },
    }
  },
} satisfies Rule.RuleModule
