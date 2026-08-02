/**
 * Shared Nitro mutation-route gate.
 *
 * Replaces v1's `server/mutation-route-utils.ts`, whose single regex
 * (`/\/server\/api\/.+\.(post|put|patch|delete)\./`) had three defects that the
 * deep review proved:
 *
 *   1. It only ever matched `server/api/**`, so every handler under
 *      `server/routes/**` was invisible to four security rules at once.
 *   2. It required a leading slash, so a relative filename (`server/api/x.post.ts`
 *      — what ESLint surfaces for many `cwd`/override combinations) never matched.
 *   3. It keyed the entire security tier on a *filename convention*. Renaming
 *      `create.post.ts` to `create.ts` silently disabled CSRF, rate-limit,
 *      body-validation and wrapper enforcement for that route, with no warning.
 *
 * This gate fixes all three. A route is classified from **two independent
 * sources** — the method suffix in the filename AND the method the handler
 * declares in code — and either one is sufficient. A rename therefore cannot
 * silently disable a consumer as long as the handler still says which method it
 * serves; and a handler that declares nothing is reported as `unspecified`
 * rather than being silently treated as read-only.
 *
 * Every path predicate here is pure and directly unit-tested against real
 * absolute and relative fixture paths. There is no `testMode` escape hatch:
 * v1's suites passed `testMode: true` on 18 of 19 CSRF cases, which is exactly
 * why a rule that matched zero real files shipped green at `'error'`.
 *
 * ## Three evasions the adversarial pass proved, and what the gate does now
 *
 * **Aliased handler calls.** `const handler = defineEventHandler` followed by
 * `export default handler(…)` matched no rule, because every consumer compared
 * the callee's *spelling* against a name set. `resolveIdentifierAliasChain()`
 * walks a callee identifier back through single-assignment local bindings via
 * the scope manager, so the alias is classified as what it actually is.
 *
 * **Indeterminate methods.** A handler that compares its method against
 * something this gate cannot read statically (`const m = ['POST'][0]`) declares
 * *nothing*, so it lands on `unspecified` and the rules that need a proven
 * mutation stay silent — a runtime POST handler with no CSRF, rate-limit or
 * wrapper enforcement. The gate cannot invent the method, so it records the
 * ambiguity instead: `hasIndeterminateMethod` is true whenever a method source
 * is compared against a non-literal. `no-raw-define-event-handler-in-mutation-routes`
 * is the single rule that reports it — the route is told to pin the method with
 * a method-suffixed filename or a literal, which makes every other rule in the
 * tier decidable. It is deliberately reported once, by one rule: firing the
 * whole security tier on an ambiguity would report obligations that may not
 * exist.
 *
 * **Test-named routes.** `server/api/deploy.test.post.ts` is a route Nitro
 * deploys, but the shared `isTestOrFixturePath()` exemption matched its `.test.`
 * infix and switched the entire security tier off. Inside a route tree the
 * exemption is directory-only — see `isExemptTestPath()`.
 */

import type { SourceCode } from 'eslint'

import { inTestOrFixtureDirectory, isTestOrFixturePath } from './path-scope'

/** HTTP methods that mutate state and therefore carry the security obligations. */
export const MUTATION_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** HTTP methods that are safe/idempotent reads. */
export const READ_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Every method Nitro accepts as a `.<method>.ts` filename suffix. */
const FILENAME_METHOD_SUFFIXES: ReadonlySet<string> = new Set([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
  'connect',
  'trace',
])

/** Extensions Nitro will load as a server route module. */
const ROUTE_EXTENSIONS: ReadonlySet<string> = new Set(['ts', 'js', 'mjs', 'mts', 'cts', 'cjs'])

/**
 * Wrappers that already apply the estate's mutation guardrails (CSRF check,
 * rate limit, auth) internally. A route declared with one of these is
 * considered compliant by the rules that consume this gate.
 */
export const APPROVED_MUTATION_WRAPPERS: ReadonlySet<string> = new Set([
  'defineAdminMutation',
  'definePublicMutation',
  'defineUserMutation',
  'defineCallbackMutation',
  'defineWebhookMutation',
  'defineCronMutation',
])

/** Calls that define an event handler and therefore introduce a handler body. */
export const HANDLER_DEFINING_CALLS: ReadonlySet<string> = new Set([
  'defineEventHandler',
  'eventHandler',
  'defineLazyEventHandler',
  'lazyEventHandler',
  'defineHandler',
  'defineCachedEventHandler',
  ...APPROVED_MUTATION_WRAPPERS,
])

/** Schema-library methods that count as validating a value. */
export const APPROVED_PARSE_METHODS: ReadonlySet<string> = new Set([
  'parse',
  'parseAsync',
  'safeParse',
  'safeParseAsync',
])

/**
 * Receivers whose `.parse()` is **not** schema validation. `JSON.parse(body)`
 * deserializes; it asserts nothing about shape, type, or bounds. v1's
 * `require-immediate-mutation-body-validation` checked the *method name* only
 * and therefore accepted `JSON.parse(await readBody(event))` as validation —
 * while its own sibling rule already maintained this exact list.
 */
export const NON_SCHEMA_RECEIVERS: ReadonlySet<string> = new Set([
  'JSON',
  'Date',
  'URL',
  'URLSearchParams',
  'Number',
  'cookie',
  'cookies',
  'qs',
  'querystring',
  'yaml',
  'YAML',
  'toml',
  'TOML',
  'csv',
  'ini',
])

/**
 * Route prefixes that the estate's CSRF middleware deliberately bypasses.
 * These receive external POSTs and authenticate with a shared secret or
 * signature instead of a browser CSRF header.
 */
export const CSRF_EXEMPT_ROUTE_PREFIXES: readonly string[] = ['webhooks/', 'cron/', 'callbacks/']

export type RouteArea = 'api' | 'routes'

/**
 * - `mutation`   — the route declares at least one mutating method.
 * - `read-only`  — the route declares methods, all of which are safe reads.
 * - `unspecified`— the route declares no method at all, so Nitro will route
 *                  *every* method to it, including POST. Rules decide for
 *                  themselves whether to treat this as in-scope; the gate
 *                  refuses to guess, because guessing "read-only" here is what
 *                  made a rename able to disable the tier.
 */
export type MethodDisposition = 'mutation' | 'read-only' | 'unspecified'

export interface ServerRoutePathInfo {
  /** True when the file sits under a `server/api/**` or `server/routes/**` tree. */
  isServerRoute: boolean
  area: RouteArea | null
  /** Path of the file relative to the route root, e.g. `users/[id].post.ts`. */
  routeRelativePath: string | null
  /** Lower-case method taken from the `.<method>.<ext>` filename suffix. */
  filenameMethod: string | null
  /** True for `server/api/webhooks|cron|callbacks/**` and the `routes` twin. */
  isCsrfExempt: boolean
}

export interface MutationRouteInfo extends ServerRoutePathInfo {
  /** Upper-case methods proved by the filename and/or the handler body. */
  declaredMethods: string[]
  methodSource: 'filename' | 'handler' | 'filename+handler' | null
  disposition: MethodDisposition
  /** `disposition === 'mutation'`. */
  isMutationRoute: boolean
  /**
   * The handler tests its method against something unreadable, so the gate
   * cannot decide whether this route mutates. Reported by
   * `no-raw-define-event-handler-in-mutation-routes`; see the header.
   */
  hasIndeterminateMethod: boolean
}

/** Normalize Windows separators so every predicate below sees one form. */
export function normalizePath(filename: string): string {
  return String(filename ?? '').replaceAll('\\', '/')
}

/**
 * Anchor a path so relative and absolute filenames behave identically.
 * `server/api/x.post.ts` and `/repo/server/api/x.post.ts` must classify the
 * same way — v1's leading-slash assumption is the single largest source of
 * dead rules in the package.
 */
function anchor(filename: string): string {
  const normalized = normalizePath(filename)
  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

export function getIdentifierName(node: any): string | null {
  if (!node) return null
  if (node.type === 'Identifier') return node.name
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node.type === 'PrivateIdentifier') return node.name
  return null
}

/** Strip TS-only expression wrappers (`x as T`, `<T>x`, `x!`, `x satisfies T`). */
export function unwrapTsWrappers(node: any): any {
  let current = node
  for (let i = 0; current && i < 32; i += 1) {
    if (
      current.type === 'TSAsExpression' ||
      current.type === 'TSSatisfiesExpression' ||
      current.type === 'TSNonNullExpression' ||
      current.type === 'TSTypeAssertion' ||
      current.type === 'TSInstantiationExpression'
    ) {
      current = current.expression
      continue
    }
    if (current.type === 'ChainExpression') {
      current = current.expression
      continue
    }
    return current
  }
  return current
}

/**
 * Locate the `server/api/` or `server/routes/` root inside a path.
 *
 * The **last** occurrence wins: in a monorepo a path may legitimately contain
 * an unrelated `server/` ancestor (`/repo/packages/server/app/server/api/…`),
 * and the route root is always the innermost one.
 */
function findRouteRoot(filename: string): { area: RouteArea; rest: string } | null {
  const anchored = anchor(filename)
  let best: { area: RouteArea; rest: string; index: number } | null = null

  for (const area of ['api', 'routes'] as const) {
    const marker = `/server/${area}/`
    const index = anchored.lastIndexOf(marker)
    if (index === -1) continue
    if (best === null || index > best.index) {
      best = { area, rest: anchored.slice(index + marker.length), index }
    }
  }

  if (!best) return null
  return { area: best.area, rest: best.rest }
}

/**
 * Extract the Nitro method suffix from a route basename.
 * `[id].post.ts` -> `post`; `index.ts` -> null; `handler.post.test.ts` -> null
 * (the last segment must be a loadable route extension).
 */
function filenameMethodOf(routeRelativePath: string): string | null {
  const basename = routeRelativePath.slice(routeRelativePath.lastIndexOf('/') + 1)
  const parts = basename.split('.')
  if (parts.length < 3) return null

  const extension = parts.at(-1)?.toLowerCase() ?? ''
  if (!ROUTE_EXTENSIONS.has(extension)) return null

  const candidate = parts.at(-2)?.toLowerCase() ?? ''
  return FILENAME_METHOD_SUFFIXES.has(candidate) ? candidate : null
}

/** Pure path classification — no AST, no filesystem, no ESLint context. */
export function analyzeServerRoutePath(filename: string): ServerRoutePathInfo {
  const root = findRouteRoot(filename)
  if (!root) {
    return {
      isServerRoute: false,
      area: null,
      routeRelativePath: null,
      filenameMethod: null,
      isCsrfExempt: false,
    }
  }

  const isCsrfExempt = CSRF_EXEMPT_ROUTE_PREFIXES.some((prefix) => root.rest.startsWith(prefix))

  return {
    isServerRoute: true,
    area: root.area,
    routeRelativePath: root.rest,
    filenameMethod: filenameMethodOf(root.rest),
    isCsrfExempt,
  }
}

/** True when the file is a `server/api|routes` module (any method). */
export function isServerRouteFile(filename: string): boolean {
  return analyzeServerRoutePath(filename).isServerRoute
}

/** True for routes the CSRF middleware deliberately does not protect. */
export function isCsrfExemptRoutePath(filename: string): boolean {
  return analyzeServerRoutePath(filename).isCsrfExempt
}

/**
 * The test/fixture exemption every rule in the server tier must use.
 *
 * Outside a route tree it is the ordinary `isTestOrFixturePath()` — a
 * `.test.`/`.spec.` infix anywhere in the path is test code.
 *
 * **Inside `server/api/**` or `server/routes/**` the infix stops counting.**
 * Nitro serves every module in those trees, so `deploy.test.post.ts` is a live
 * `POST /api/deploy.test` endpoint, not a test; only a real test or fixture
 * *directory* (`tests/`, `__tests__/`, `fixtures/`, …) exempts a file there.
 * A route suite that wants the exemption back belongs outside the route tree,
 * which is also where it has to live for Nitro not to deploy it.
 */
export function isExemptTestPath(filename: string): boolean {
  return analyzeServerRoutePath(filename).isServerRoute
    ? inTestOrFixtureDirectory(filename)
    : isTestOrFixturePath(filename)
}

/* -------------------------------------------------------------------------- */
/* Local alias resolution                                                      */
/* -------------------------------------------------------------------------- */

/** Resolve an identifier to its variable through the real scope chain. */
function resolveVariable(identifier: any, sourceCode: SourceCode | null | undefined): any | null {
  if (!identifier || typeof (sourceCode as any)?.getScope !== 'function') return null

  let scope: any
  try {
    scope = (sourceCode as any).getScope(identifier)
  } catch {
    return null
  }

  while (scope) {
    const variable = scope.variables.find((candidate: any) => candidate.name === identifier.name)
    if (variable) return variable
    scope = scope.upper
  }
  return null
}

/**
 * The initializer of a variable that is a *stable* alias: declared exactly once,
 * as a plain identifier binding, and never written again. A parameter, an
 * import, a destructuring pattern, or a reassigned binding is not an alias this
 * gate will follow — following those would let an unrelated later assignment
 * decide how a security rule classifies a call.
 */
function stableAliasInitializer(variable: any): any | null {
  const definitions = variable?.defs ?? []
  if (definitions.length !== 1) return null

  const [definition] = definitions
  if (definition.type !== 'Variable') return null

  const declarator = definition.node
  if (declarator?.type !== 'VariableDeclarator' || declarator.id?.type !== 'Identifier') return null

  const writes = (variable.references ?? []).filter((reference: any) => reference.isWrite?.())
  if (writes.length > 1) return null

  return declarator.init ?? null
}

/**
 * Names an identifier resolves to, following single-assignment local aliases.
 *
 * `const handler = defineEventHandler` yields `['handler', 'defineEventHandler']`,
 * so a consumer asking "is this a raw handler call?" sees the real callee
 * instead of the alias. Returns `[]` for anything that is not an identifier.
 *
 * Bounded at `maxHops` and cycle-guarded, so a self-referential or pathological
 * chain terminates.
 */
export function resolveIdentifierAliasChain(
  node: any,
  sourceCode: SourceCode | null | undefined,
  maxHops = 4,
): string[] {
  const chain: string[] = []
  const seen = new Set<string>()
  let current = unwrapTsWrappers(node)

  for (let hop = 0; hop <= maxHops; hop += 1) {
    if (current?.type !== 'Identifier') break

    const { name } = current
    if (seen.has(name)) break
    seen.add(name)
    chain.push(name)

    const initializer = stableAliasInitializer(resolveVariable(current, sourceCode))
    if (!initializer) break
    current = unwrapTsWrappers(initializer)
  }

  return chain
}

/**
 * The first name in an identifier's alias chain that appears in `names`, or
 * `null`. This is the alias-aware replacement for `names.has(calleeName)`.
 */
export function resolveAliasedName(
  node: any,
  sourceCode: SourceCode | null | undefined,
  names: ReadonlySet<string>,
): string | null {
  for (const name of resolveIdentifierAliasChain(node, sourceCode)) {
    if (names.has(name)) return name
  }
  return null
}

/* -------------------------------------------------------------------------- */
/* Handler-declared methods                                                    */
/* -------------------------------------------------------------------------- */

const METHOD_ACCESSOR_CALLS: ReadonlySet<string> = new Set([
  'getMethod',
  'getRequestMethod',
  'assertMethod',
  'isMethod',
])

const ROUTER_FACTORIES: ReadonlySet<string> = new Set([
  'createRouter',
  'createApp',
  'createNitroApp',
  'useBase',
  'Router',
])

const ROUTER_METHOD_NAMES: ReadonlySet<string> = new Set([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
])

/** Walk every child node without relying on `node.parent` (unset before traversal). */
function walk(node: any, visit: (node: any) => void, depth = 0): void {
  if (!node || typeof node !== 'object' || depth > 200) return

  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit, depth + 1)
    return
  }

  if (typeof node.type !== 'string') return
  visit(node)

  for (const key of Object.keys(node)) {
    if (key === 'parent' || key === 'loc' || key === 'range' || key === 'tokens') continue
    const value = (node as any)[key]
    if (value && typeof value === 'object') walk(value, visit, depth + 1)
  }
}

/**
 * Strings a node yields statically.
 *
 * `literalAliases` carries module-local string constants (`const POST = 'POST'`)
 * so `event.method === POST` reads as determinate rather than as the
 * indeterminate comparison it would otherwise look like.
 */
function literalMethodsOf(node: any, literalAliases: ReadonlyMap<string, string[]> = new Map()) {
  const target = unwrapTsWrappers(node)
  if (!target) return []
  if (target.type === 'Literal' && typeof target.value === 'string') {
    return [target.value.toUpperCase()]
  }
  if (target.type === 'TemplateLiteral' && target.expressions.length === 0) {
    return [String(target.quasis[0]?.value?.raw ?? '').toUpperCase()]
  }
  if (target.type === 'ArrayExpression') {
    return target.elements.flatMap((element: any) => literalMethodsOf(element, literalAliases))
  }
  if (target.type === 'Identifier') {
    return [...(literalAliases.get(target.name) ?? [])]
  }
  return []
}

/**
 * Can this node's value be read statically at lint time?
 *
 * The distinction that matters is **readable-but-not-a-method**
 * (`event.method === 'FOO'` — determinate, simply not an HTTP method) versus
 * **unreadable** (`event.method === computeIt()` — the gate has no idea which
 * methods this route serves). Only the second makes a route indeterminate.
 */
function isStaticallyReadableValue(
  node: any,
  literalAliases: ReadonlyMap<string, string[]> = new Map(),
): boolean {
  const target = unwrapTsWrappers(node)
  if (!target) return false
  if (target.type === 'Literal' && typeof target.value === 'string') return true
  if (target.type === 'TemplateLiteral') return target.expressions.length === 0
  if (target.type === 'Identifier') return literalAliases.has(target.name)
  if (target.type === 'ArrayExpression') {
    return (
      target.elements.length > 0 &&
      target.elements.every(
        (element: any) => element && isStaticallyReadableValue(element, literalAliases),
      )
    )
  }
  return false
}

/** `event.method`, `event.node.req.method`, `event.req.method`, `event.request.method`. */
function isEventMethodExpression(node: any): boolean {
  const target = unwrapTsWrappers(node)
  if (target?.type !== 'MemberExpression') return false
  if (getIdentifierName(target.property) !== 'method') return false

  let object = unwrapTsWrappers(target.object)
  for (let i = 0; object && i < 6; i += 1) {
    if (object.type === 'Identifier') {
      return /^(?:event|e|ev|req|request)$/i.test(object.name)
    }
    if (object.type !== 'MemberExpression') return false
    object = unwrapTsWrappers(object.object)
  }
  return false
}

/** `getMethod(event)` / `getRequestMethod(event)` as an expression. */
function isMethodAccessorCall(node: any): boolean {
  const target = unwrapTsWrappers(node)
  if (target?.type !== 'CallExpression') return false
  const name = getIdentifierName(unwrapTsWrappers(target.callee))
  return name === 'getMethod' || name === 'getRequestMethod'
}

/**
 * `methodAliases` carries one hop of indirection — `const m = getMethod(event)`
 * followed by `if (m === 'DELETE')` is the most common way handlers declare
 * their method, and treating only the direct expression as a source would miss
 * it.
 */
function isMethodSource(node: any, methodAliases: ReadonlySet<string> = new Set()): boolean {
  const target = unwrapTsWrappers(node)
  if (target?.type === 'Identifier' && methodAliases.has(target.name)) return true
  return isEventMethodExpression(target) || isMethodAccessorCall(target)
}

/**
 * Collect every HTTP method the handler body proves it serves.
 *
 * Recognized declarations (each is a *positive* statement about which method
 * the route handles; `!==` counts too, because `if (event.method !== 'POST')
 * throw` is the idiomatic way to declare a POST-only handler):
 *
 *   assertMethod(event, 'POST')            isMethod(event, ['POST','PUT'])
 *   event.method === 'POST'                getMethod(event) !== 'POST'
 *   switch (event.method) { case 'POST':}  ['POST'].includes(event.method)
 *   defineEventHandler({ method: 'POST' }) router.post('/x', handler)
 */
export function collectHandlerDeclaredMethods(ast: any): Set<string> {
  return collectHandlerMethodEvidence(ast).methods
}

/** What the handler body proves, plus whether it proved it *ambiguously*. */
export interface HandlerMethodEvidence {
  methods: Set<string>
  /**
   * The handler tests its method against a value that cannot be read at lint
   * time, so the route serves some method the gate cannot name. See the header.
   */
  indeterminate: boolean
}

/** `collectHandlerDeclaredMethods` plus the indeterminacy signal. */
export function collectHandlerMethodEvidence(ast: any): HandlerMethodEvidence {
  const methods = new Set<string>()
  if (!ast) return { methods, indeterminate: false }

  let indeterminate = false

  // Variables initialized from a router factory, so `router.post(...)` is only
  // treated as a route declaration on an actual router — not on any object
  // that happens to expose a `post` method. The same pass collects one hop of
  // method-source aliasing (`const method = getMethod(event)`), the file-local
  // handler-defining aliases (`const handler = defineEventHandler`), and the
  // module-local string constants a comparison may legitimately use.
  const routerVariables = new Set<string>(['router', 'app'])
  const methodAliases = new Set<string>()
  const handlerAliases = new Set<string>()
  const literalAliases = new Map<string, string[]>()

  walk(ast, (node) => {
    if (node.type !== 'VariableDeclarator' || node.id?.type !== 'Identifier') return
    const init = unwrapTsWrappers(node.init)
    if (isMethodSource(init)) {
      methodAliases.add(node.id.name)
      return
    }
    if (init?.type === 'Identifier' && HANDLER_DEFINING_CALLS.has(init.name)) {
      handlerAliases.add(node.id.name)
      return
    }
    if (isStaticallyReadableValue(init)) {
      literalAliases.set(node.id.name, literalMethodsOf(init))
      return
    }
    if (init?.type !== 'CallExpression') return
    const factory = getIdentifierName(unwrapTsWrappers(init.callee))
    if (factory && ROUTER_FACTORIES.has(factory)) routerVariables.add(node.id.name)
  })

  const add = (values: Iterable<string>) => {
    for (const value of values) {
      const upper = value.toUpperCase()
      if (MUTATION_METHODS.has(upper) || READ_METHODS.has(upper)) methods.add(upper)
    }
  }

  /** Record a method comparison, marking it indeterminate when unreadable. */
  const compare = (valueNode: any) => {
    if (isStaticallyReadableValue(valueNode, literalAliases)) {
      add(literalMethodsOf(valueNode, literalAliases))
      return
    }
    indeterminate = true
  }

  walk(ast, (node) => {
    switch (node.type) {
      case 'CallExpression': {
        const callee = unwrapTsWrappers(node.callee)
        const calleeName = getIdentifierName(callee)

        // assertMethod(event, 'POST') / isMethod(event, ['POST'])
        if (calleeName && METHOD_ACCESSOR_CALLS.has(calleeName) && node.arguments.length > 1) {
          compare(node.arguments[1])
        }

        // handler-defining call with an explicit `{ method: ... }` option
        if (
          calleeName &&
          (HANDLER_DEFINING_CALLS.has(calleeName) || handlerAliases.has(calleeName))
        ) {
          for (const argument of node.arguments) {
            const object = unwrapTsWrappers(argument)
            if (object?.type !== 'ObjectExpression') continue
            for (const property of object.properties ?? []) {
              if (property.type !== 'Property') continue
              if (getIdentifierName(property.key) !== 'method') continue
              compare(property.value)
            }
          }
        }

        // ['POST','PUT'].includes(event.method)
        if (
          callee?.type === 'MemberExpression' &&
          getIdentifierName(callee.property) === 'includes' &&
          node.arguments.length === 1 &&
          isMethodSource(node.arguments[0], methodAliases)
        ) {
          compare(callee.object)
        }

        // router.post('/x', handler)
        if (callee?.type === 'MemberExpression' && !callee.computed) {
          const property = getIdentifierName(callee.property)
          const object = unwrapTsWrappers(callee.object)
          const objectName =
            object?.type === 'Identifier'
              ? object.name
              : object?.type === 'CallExpression'
                ? getIdentifierName(unwrapTsWrappers(object.callee))
                : null
          if (
            property &&
            ROUTER_METHOD_NAMES.has(property) &&
            objectName &&
            (routerVariables.has(objectName) || ROUTER_FACTORIES.has(objectName))
          ) {
            add([property])
          }
        }
        break
      }

      case 'BinaryExpression': {
        if (!['===', '==', '!==', '!='].includes(node.operator)) break
        if (isMethodSource(node.left, methodAliases)) compare(node.right)
        else if (isMethodSource(node.right, methodAliases)) compare(node.left)
        break
      }

      case 'SwitchStatement': {
        if (!isMethodSource(node.discriminant, methodAliases)) break
        for (const switchCase of node.cases ?? []) {
          // `default:` has a null test and is not a method claim.
          if (switchCase.test) compare(switchCase.test)
        }
        break
      }

      default:
        break
    }
  })

  return { methods, indeterminate }
}

/**
 * Full classification: filename evidence ∪ handler evidence.
 *
 * `sourceCode` is optional so the path half stays unit-testable on its own;
 * consumers inside a rule always pass it, which is what makes a rename
 * non-fatal.
 */
export function analyzeMutationRoute(
  filename: string,
  sourceCode?: SourceCode | null,
): MutationRouteInfo {
  const pathInfo = analyzeServerRoutePath(filename)

  const filenameMethods = new Set<string>()
  if (pathInfo.filenameMethod) filenameMethods.add(pathInfo.filenameMethod.toUpperCase())

  const handlerEvidence = pathInfo.isServerRoute
    ? collectHandlerMethodEvidence((sourceCode as any)?.ast ?? null)
    : { methods: new Set<string>(), indeterminate: false }
  const handlerMethods = handlerEvidence.methods

  const declared = new Set<string>([...filenameMethods, ...handlerMethods])
  const declaredMethods = [...declared].sort()

  let methodSource: MutationRouteInfo['methodSource'] = null
  if (filenameMethods.size > 0 && handlerMethods.size > 0) methodSource = 'filename+handler'
  else if (filenameMethods.size > 0) methodSource = 'filename'
  else if (handlerMethods.size > 0) methodSource = 'handler'

  let disposition: MethodDisposition = 'unspecified'
  if (declaredMethods.length > 0) {
    disposition = declaredMethods.some((method) => MUTATION_METHODS.has(method))
      ? 'mutation'
      : 'read-only'
  }

  return {
    ...pathInfo,
    declaredMethods,
    methodSource,
    disposition,
    isMutationRoute: pathInfo.isServerRoute && disposition === 'mutation',
    hasIndeterminateMethod: handlerEvidence.indeterminate,
  }
}

/**
 * True when the gate cannot decide whether a route mutates *and* the filename
 * does not decide it either — Nitro will route every method to the file, one of
 * the handler's branches is gated on a value the linter cannot read, and the
 * whole security tier therefore has nothing to attach to.
 *
 * A method-suffixed filename settles it (Nitro serves only that method), and a
 * route already proven to mutate is guarded by the normal rules, so neither is
 * ambiguous no matter what the body does.
 */
export function hasUnresolvableMethod(info: MutationRouteInfo): boolean {
  return (
    info.isServerRoute &&
    info.hasIndeterminateMethod &&
    info.filenameMethod === null &&
    !info.isMutationRoute
  )
}

/**
 * True when a rule that guards *mutations* should run on this file.
 *
 * `includeUnspecified` exists because "the handler declares no method" is
 * genuinely ambiguous: Nitro will route POST to it, but flagging every
 * method-less route for a missing rate limit would be unusable. Rules that
 * only report on an observed body read (CSRF-exempt misuse, body validation)
 * pass `true`; rules that report on the *absence* of something pass `false`.
 */
export function shouldGuardMutations(
  info: MutationRouteInfo,
  { includeUnspecified = false }: { includeUnspecified?: boolean } = {},
): boolean {
  if (!info.isServerRoute) return false
  if (info.disposition === 'mutation') return true
  return includeUnspecified && info.disposition === 'unspecified'
}
