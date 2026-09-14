/**
 * Shared internals for the hydration tier.
 *
 * NOT a rule module — files in this directory beginning with `_` are internal
 * helpers and must be excluded from any rule enumeration in `src/index.ts`.
 *
 * Two defects from the v1 deep review are fixed here, once:
 *
 *  1. `VElement.name` is **lowercased** by `vue-eslint-parser`; `rawName`
 *     preserves the author's casing. v1's `VElement[name="USwitch"]` selectors
 *     and `parent.name === 'ClientOnly'` ancestor checks could therefore never
 *     match, which made two `'error'` rules exactly inverted. Every tag
 *     comparison in this package goes through {@link normalizeTagName}.
 *
 *  2. v1's "am I inside a template?" check was `current.type.startsWith('V')`,
 *     which matches `VariableDeclarator`/`VariableDeclaration` and so silently
 *     skipped most real script-side DOM access in `.vue` files. Script visitors
 *     returned from `create()` never visit the template body under
 *     `vue-eslint-parser`, so no such check is needed at all — see
 *     {@link templateBodyVisitor}.
 */

import type { Rule } from 'eslint'

import { inAppScope, isTestOrFixturePath } from '../utils/path-scope'

export { isTestOrFixturePath }

/**
 * Adapter over the shared, tested path gate. Every per-directory scope check in
 * this lane funnels through here so the `'/app/pages/'.includes()` bug class
 * (dead on relative filenames and on Nuxt 3 non-`app/` layouts) has exactly one
 * implementation.
 */
export function inDir(filename: string, dir: string): boolean {
  return inAppScope(filename, dir)
}

/* -------------------------------------------------------------------------- */
/* filenames                                                                   */
/* -------------------------------------------------------------------------- */

export function getFilename(context: Rule.RuleContext): string {
  return (
    context.filename ??
    (context as unknown as { getFilename?(): string }).getFilename?.() ??
    ''
  ).replaceAll('\\', '/')
}

/** `foo.client.ts`, `components/x.client.vue`, `plugins/y.client/index.ts`. */
export function isClientOnlyFile(filename: string): boolean {
  return filename.includes('.client.') || filename.includes('.client/')
}

/** `foo.server.ts` — never shipped to the browser, so hydration cannot mismatch. */
export function isServerOnlyFile(filename: string): boolean {
  return filename.includes('.server.') || filename.includes('.server/')
}

/**
 * Broad "is this file executed by the Nuxt app runtime" predicate, used by rules
 * whose scope is the whole app rather than one directory. Matches both the
 * Nuxt 4 `app/` layout and the Nuxt 3 root layout, absolute or relative.
 */
export function isAppRuntimeFile(filename: string): boolean {
  if (filename.endsWith('.vue')) return true
  if (!/\.[cm]?[jt]sx?$/.test(filename)) return false
  return /(?:^|\/)(?:app|pages|components|composables|layouts|middleware|plugins|stores|utils)\//.test(
    filename,
  )
}

/* -------------------------------------------------------------------------- */
/* template helpers                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Case- and kebab-insensitive tag identity: `<USwitch>`, `<u-switch>` and
 * `<u-Switch>` all normalize to `uswitch`.
 */
export function normalizeTagName(raw: unknown): string {
  return String(raw ?? '')
    .toLowerCase()
    .replaceAll('-', '')
}

/** Tag names that suppress server rendering of their default slot. */
export const CLIENT_ONLY_TAGS = new Set(['clientonly', 'lazyclientonly'])

export function tagNameOf(element: any): string {
  return normalizeTagName(element?.rawName ?? element?.name)
}

/** Walks the real `VElement` ancestor chain looking for `<ClientOnly>`. */
export function isInsideClientOnly(node: any): boolean {
  let current: any = node?.parent
  while (current) {
    if (current.type === 'VElement' && CLIENT_ONLY_TAGS.has(tagNameOf(current))) return true
    current = current.parent
  }
  return false
}

/**
 * Registers a template-body visitor when running under `vue-eslint-parser`, and
 * degrades to the script visitor alone under any other parser.
 *
 * Script visitors registered this way visit the `<script>`/`<script setup>` AST
 * only — the template body is a separate tree reached exclusively through
 * `defineTemplateBodyVisitor`. That is why no rule in this tier needs an
 * "is this node in the template?" ancestor test.
 */
export function templateBodyVisitor(
  context: Rule.RuleContext,
  templateVisitor: Record<string, (...args: any[]) => void>,
  scriptVisitor: Record<string, (...args: any[]) => void> = {},
): Rule.RuleListener {
  const services = (context.sourceCode as any)?.parserServices ?? (context as any).parserServices
  if (typeof services?.defineTemplateBodyVisitor !== 'function') {
    return scriptVisitor as Rule.RuleListener
  }
  return services.defineTemplateBodyVisitor(templateVisitor, scriptVisitor)
}

/* -------------------------------------------------------------------------- */
/* scope                                                                       */
/* -------------------------------------------------------------------------- */

/** `true` when `name` is not bound by any enclosing scope (i.e. a real global). */
export function isUnshadowedGlobal(context: Rule.RuleContext, node: any, name: string): boolean {
  const sourceCode: any = context.sourceCode ?? (context as any).getSourceCode?.()
  let scope: any
  try {
    scope = sourceCode?.getScope?.(node)
  } catch {
    return true
  }
  while (scope) {
    const variable = scope.set?.get(name)
    if (variable) return (variable.defs?.length ?? 0) === 0
    scope = scope.upper
  }
  return true
}

/** Resolves an identifier to the initializer of its single `const`/`let` definition. */
export function resolveBindingInit(context: Rule.RuleContext, node: any, name: string): any {
  const sourceCode: any = context.sourceCode ?? (context as any).getSourceCode?.()
  let scope: any
  try {
    scope = sourceCode?.getScope?.(node)
  } catch {
    return null
  }
  while (scope) {
    const variable = scope.set?.get(name)
    if (variable) {
      const defs = variable.defs ?? []
      if (defs.length !== 1) return null
      const def = defs[0]
      if (def.type !== 'Variable') return null
      return def.node?.init ?? null
    }
    scope = scope.upper
  }
  return null
}

/* -------------------------------------------------------------------------- */
/* client/server guard detection                                               */
/* -------------------------------------------------------------------------- */

export const DOM_GLOBALS = new Set([
  'window',
  'document',
  'localStorage',
  'sessionStorage',
  'navigator',
  'history',
  'location',
  'screen',
])

function isMemberNamed(node: any, objectName: string, propertyNames: string[]): boolean {
  return (
    node?.type === 'MemberExpression' &&
    !node.computed &&
    node.object?.type === 'Identifier' &&
    node.object.name === objectName &&
    node.property?.type === 'Identifier' &&
    propertyNames.includes(node.property.name)
  )
}

function isImportMetaMember(node: any, propertyNames: string[]): boolean {
  return (
    node?.type === 'MemberExpression' &&
    !node.computed &&
    node.object?.type === 'MetaProperty' &&
    node.object.meta?.name === 'import' &&
    node.object.property?.name === 'meta' &&
    node.property?.type === 'Identifier' &&
    propertyNames.includes(node.property.name)
  )
}

/** `typeof window !== 'undefined'` (and the reversed-operand form). */
function isTypeofDefinedCheck(node: any, negated: boolean): boolean {
  if (node?.type !== 'BinaryExpression') return false
  const wantEquality = negated ? ['===', '=='] : ['!==', '!=']
  if (!wantEquality.includes(node.operator)) return false
  const sides = [
    [node.left, node.right],
    [node.right, node.left],
  ]
  return sides.some(
    ([typeofSide, literalSide]: any[]) =>
      typeofSide?.type === 'UnaryExpression' &&
      typeofSide.operator === 'typeof' &&
      typeofSide.argument?.type === 'Identifier' &&
      DOM_GLOBALS.has(typeofSide.argument.name) &&
      literalSide?.type === 'Literal' &&
      literalSide.value === 'undefined',
  )
}

/** An expression that is truthy **only in the browser**. */
function isClientTruthyGuard(node: any): boolean {
  if (!node) return false
  if (isImportMetaMember(node, ['client', 'browser'])) return true
  if (isMemberNamed(node, 'process', ['client', 'browser'])) return true
  if (isTypeofDefinedCheck(node, false)) return true
  if (node.type === 'UnaryExpression' && node.operator === '!') {
    return isClientFalsyGuard(node.argument)
  }
  return false
}

/** An expression that is truthy **only on the server**. */
function isClientFalsyGuard(node: any): boolean {
  if (!node) return false
  if (isImportMetaMember(node, ['server'])) return true
  if (isMemberNamed(node, 'process', ['server'])) return true
  if (isTypeofDefinedCheck(node, true)) return true
  if (node.type === 'UnaryExpression' && node.operator === '!') {
    return isClientTruthyGuard(node.argument)
  }
  return false
}

/**
 * `import.meta.client && ready` guards its consequent; `x || import.meta.client`
 * does **not** (v1 accepted both, which the review proved was an evasion hole).
 */
export function containsClientTruthyGuard(node: any): boolean {
  if (isClientTruthyGuard(node)) return true
  if (node?.type === 'LogicalExpression' && node.operator === '&&') {
    return containsClientTruthyGuard(node.left) || containsClientTruthyGuard(node.right)
  }
  return false
}

/**
 * Used for `else` branches and early returns: after `if (import.meta.server || x) return`
 * the remaining code is client-only, so a `||` disjunct is sufficient here — but
 * `&&` is not.
 */
export function containsClientFalsyGuard(node: any): boolean {
  if (isClientFalsyGuard(node)) return true
  if (node?.type === 'LogicalExpression' && node.operator === '||') {
    return containsClientFalsyGuard(node.left) || containsClientFalsyGuard(node.right)
  }
  return false
}

/** Composition-API hooks that never run during SSR. */
const CLIENT_ONLY_HOOKS = new Set([
  'onMounted',
  'onBeforeMount',
  'onUpdated',
  'onBeforeUpdate',
  'onUnmounted',
  'onBeforeUnmount',
  'onActivated',
  'onDeactivated',
  'onNuxtReady',
  'onBeforeRouteLeave',
  'useEventListener',
])

/** Options-API lifecycle hooks that never run during SSR. */
const CLIENT_ONLY_OPTION_HOOKS = new Set([
  'mounted',
  'beforeMount',
  'updated',
  'beforeUpdate',
  'unmounted',
  'beforeUnmount',
  'activated',
  'deactivated',
])

/** `nuxtApp.hook('app:mounted', () => …)` — the canonical client-only plugin idiom. */
const CLIENT_ONLY_NUXT_HOOKS = new Set([
  'app:mounted',
  'app:suspense:resolve',
  'page:finish',
  'page:transition:finish',
])

function isClientOnlyCallback(fn: any): boolean {
  const parent = fn?.parent
  if (!parent) return false

  if (parent.type === 'Property' && parent.value === fn) {
    const key = parent.key
    const name =
      key?.type === 'Identifier' ? key.name : key?.type === 'Literal' ? String(key.value) : null
    if (name && CLIENT_ONLY_OPTION_HOOKS.has(name)) return true
  }

  if (parent.type !== 'CallExpression' || !parent.arguments?.includes(fn)) return false

  const callee = parent.callee
  if (callee?.type === 'Identifier' && CLIENT_ONLY_HOOKS.has(callee.name)) return true

  if (
    callee?.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property?.type === 'Identifier' &&
    callee.property.name === 'hook'
  ) {
    const first = parent.arguments[0]
    if (first?.type === 'Literal' && CLIENT_ONLY_NUXT_HOOKS.has(String(first.value))) return true
  }

  return false
}

/**
 * Does a statement list contain an early `return`/`throw` guarded by a
 * server-only condition, *before* `stopAt`?
 */
function hasEarlyClientReturnBefore(block: any, stopAt: any): boolean {
  const body: any[] = block?.body ?? []
  for (const statement of body) {
    if (statement === stopAt) return false
    if (statement.type !== 'IfStatement') continue
    if (!containsClientFalsyGuard(statement.test)) continue
    const consequent = statement.consequent
    const exits =
      consequent?.type === 'ReturnStatement' ||
      consequent?.type === 'ThrowStatement' ||
      (consequent?.type === 'BlockStatement' &&
        consequent.body.some(
          (s: any) => s.type === 'ReturnStatement' || s.type === 'ThrowStatement',
        ))
    if (exits) return true
  }
  return false
}

/**
 * `true` when `node` can only execute in the browser.
 *
 * Recognises branch position (a guard's `consequent` vs its `alternate`),
 * `&&`/`||` operand position, early returns, client-only lifecycle callbacks and
 * `nuxtApp.hook('app:mounted')`. Deliberately does **not** accept
 * `if (x || import.meta.client)` or an `else` branch of `if (import.meta.client)`.
 */
export function isSsrGuarded(node: any): boolean {
  let child: any = node
  let parent: any = node?.parent

  while (parent) {
    switch (parent.type) {
      case 'IfStatement':
      case 'ConditionalExpression': {
        if (child === parent.consequent && containsClientTruthyGuard(parent.test)) return true
        if (child === parent.alternate && containsClientFalsyGuard(parent.test)) return true
        break
      }
      case 'LogicalExpression': {
        if (child === parent.right) {
          if (parent.operator === '&&' && containsClientTruthyGuard(parent.left)) return true
          if (parent.operator === '||' && containsClientFalsyGuard(parent.left)) return true
        }
        break
      }
      case 'BlockStatement': {
        if (hasEarlyClientReturnBefore(parent, child)) return true
        break
      }
      case 'ArrowFunctionExpression':
      case 'FunctionExpression':
      case 'FunctionDeclaration': {
        if (isClientOnlyCallback(parent)) return true
        break
      }
      default:
        break
    }
    child = parent
    parent = parent.parent
  }

  return false
}
