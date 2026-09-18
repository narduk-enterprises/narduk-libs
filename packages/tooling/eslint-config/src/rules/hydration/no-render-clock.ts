/**
 * Rule: no-render-clock
 *
 * Reading the wall clock while a component renders gives the server one value
 * and the client another, a few hundred milliseconds later. Anything derived
 * from it ("updated 3 minutes ago", a stale/fresh badge, a countdown) renders
 * differently on the two sides and Vue reports
 * "Hydration completed but contains mismatches".
 *
 * Evidence: buoys PR #202 (merge 28726b94). `Date.now()` was read separately on
 * server and client in `StationHero.vue`, `StationNearby.vue` and
 * `pages/stations/[stationId].vue`; every station page hydrated with
 * mismatches until the reads went through one SSR-serialized timestamp.
 *
 * The fix is `useSsrNow(key)` from `@narduk-enterprises/narduk-core`: the server
 * reads the clock once, the value is serialized into the payload, and the
 * client hydrates with the same number.
 *
 * ## What counts as a clock read
 *
 * `Date.now()`, `new Date()` with no arguments, and `performance.now()`.
 * `new Date(value)` is a conversion, not a clock read.
 *
 * ## Where it is reported (render paths only)
 *
 * - a template expression, except `v-on` handlers and `<ClientOnly>` content;
 * - a `computed()` getter (function form or `{ get }` form), including
 *   callbacks it runs synchronously (`items.filter(i => i.at < Date.now())`);
 * - a top-level statement of `<script setup>`.
 *
 * ## Where it is allowed
 *
 * Any other function body — lifecycle hooks (`onMounted`, `onBeforeMount`,
 * `onUpdated`, …), `watch`/`watchEffect` callbacks, event handlers, timers,
 * `useState`/`useAsyncData` factories — and any branch guarded by
 * `import.meta.client` / `import.meta.server` (or `process.client` /
 * `process.server`). Only `.vue` files are checked, and `.client.vue` /
 * `.server.vue` components never hydrate against the other side.
 *
 * Precision over recall, deliberately: a composable's function that happens to
 * be invoked during render is out of scope, because following calls across
 * functions is where false positives come from, and this rule is an error.
 */

import type { Rule } from 'eslint'

import {
  getFilename,
  isClientOnlyFile,
  isServerOnlyFile,
  tagNameOf,
  CLIENT_ONLY_TAGS,
} from './_internal'

/** Array callbacks run synchronously in the caller's context. */
const SYNCHRONOUS_CALLBACK_METHODS = new Set([
  'map',
  'filter',
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'some',
  'every',
  'reduce',
  'reduceRight',
  'flatMap',
  'forEach',
  'sort',
  'toSorted',
])

const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
])

function isMemberCall(node: any, objectName: string, propertyName: string): boolean {
  if (node?.type !== 'CallExpression') return false
  const callee = node.callee
  return (
    callee?.type === 'MemberExpression' &&
    !callee.computed &&
    callee.object?.type === 'Identifier' &&
    callee.object.name === objectName &&
    callee.property?.type === 'Identifier' &&
    callee.property.name === propertyName
  )
}

/** `Date.now()`, `performance.now()`, `new Date()`. Returns a label or null. */
function clockReadLabel(node: any): string | null {
  if (isMemberCall(node, 'Date', 'now')) return 'Date.now()'
  if (isMemberCall(node, 'performance', 'now')) return 'performance.now()'
  if (
    node?.type === 'NewExpression' &&
    node.callee?.type === 'Identifier' &&
    node.callee.name === 'Date' &&
    (node.arguments?.length ?? 0) === 0
  ) {
    return 'new Date()'
  }
  return null
}

/** `import.meta.client`, `import.meta.server`, `process.client`, `process.server`. */
function isEnvironmentGuard(test: any): boolean {
  if (!test) return false
  if (test.type === 'UnaryExpression' && test.operator === '!')
    return isEnvironmentGuard(test.argument)
  if (test.type === 'LogicalExpression') {
    return isEnvironmentGuard(test.left) || isEnvironmentGuard(test.right)
  }
  if (test.type !== 'MemberExpression' || test.computed) return false
  const property = test.property?.name
  if (property !== 'client' && property !== 'server') return false
  const object = test.object
  if (object?.type === 'MetaProperty') return true
  return object?.type === 'Identifier' && object.name === 'process'
}

/** Is `child` inside a branch (not the test) of an environment-guarded construct? */
function isGuardedBranch(parent: any, child: any): boolean {
  if (parent.type === 'IfStatement' || parent.type === 'ConditionalExpression') {
    return child !== parent.test && isEnvironmentGuard(parent.test)
  }
  if (parent.type === 'LogicalExpression' && parent.operator === '&&') {
    return child === parent.right && isEnvironmentGuard(parent.left)
  }
  return false
}

function calleeName(call: any): string | null {
  const callee = call?.callee
  if (callee?.type === 'Identifier') return callee.name
  if (callee?.type === 'MemberExpression' && !callee.computed) return callee.property?.name ?? null
  return null
}

/** Is `fn` the getter of a `computed(...)` call? */
function isComputedGetter(fn: any): boolean {
  const parent = fn.parent
  if (parent?.type === 'CallExpression' && parent.arguments?.[0] === fn) {
    return calleeName(parent) === 'computed'
  }
  // computed({ get() { … }, set() { … } })
  if (parent?.type === 'Property' && parent.value === fn) {
    const key = parent.key?.name ?? parent.key?.value
    const object = parent.parent
    const call = object?.parent
    return (
      key === 'get' &&
      object?.type === 'ObjectExpression' &&
      call?.type === 'CallExpression' &&
      call.arguments?.[0] === object &&
      calleeName(call) === 'computed'
    )
  }
  return false
}

/** An inline callback that runs synchronously where it is written. */
function runsSynchronously(fn: any): boolean {
  const parent = fn.parent
  if (parent?.type !== 'CallExpression') return false
  // IIFE
  if (parent.callee === fn) return true
  if (!parent.arguments?.includes(fn)) return false
  const callee = parent.callee
  return (
    callee?.type === 'MemberExpression' &&
    !callee.computed &&
    SYNCHRONOUS_CALLBACK_METHODS.has(callee.property?.name)
  )
}

export default {
  meta: {
    type: 'problem' as const,
    docs: {
      description:
        'disallow reading the wall clock during SSR render in Vue SFCs (hydration mismatch); use useSsrNow(key)',
      recommended: true,
    },
    schema: [],
    messages: {
      renderClock:
        '{{ read }} during render differs between server and client and causes a hydration mismatch. Use `useSsrNow(key)` from @narduk-enterprises/narduk-core, or read the clock in onMounted, an event handler, or an `import.meta.client` guard.',
    },
  },

  create(context: Rule.RuleContext): Rule.RuleListener {
    const filename = getFilename(context)
    if (!filename.endsWith('.vue')) return {}
    if (isClientOnlyFile(filename) || isServerOnlyFile(filename)) return {}

    const sourceCode = context.sourceCode as any
    const services = sourceCode?.parserServices ?? (context as any).parserServices
    if (typeof services?.defineTemplateBodyVisitor !== 'function') return {}

    /** Ranges of `<script setup>` blocks, from the SFC document fragment. */
    const setupRanges: Array<[number, number]> = []
    const fragment = services.getDocumentFragment?.()
    for (const child of fragment?.children ?? []) {
      if (child?.type !== 'VElement' || child.name !== 'script') continue
      const attributes = child.startTag?.attributes ?? []
      if (
        attributes.some((attribute: any) => !attribute.directive && attribute.key?.name === 'setup')
      ) {
        setupRanges.push(child.range)
      }
    }
    const inScriptSetup = (node: any) =>
      setupRanges.some(([start, end]) => node.range[0] >= start && node.range[1] <= end)

    function report(node: any, read: string): void {
      context.report({ node, messageId: 'renderClock', data: { read } })
    }

    /** Script side: walk out to the nearest function / the program. */
    function checkScriptRead(node: any, read: string): void {
      let child = node
      let current = node.parent
      while (current) {
        if (isGuardedBranch(current, child)) return
        if (FUNCTION_TYPES.has(current.type)) {
          if (isComputedGetter(current)) {
            report(node, read)
            return
          }
          if (runsSynchronously(current)) {
            child = current
            current = current.parent
            continue
          }
          // Any other function body is not render code (hooks, handlers,
          // watchers, timers, state factories) — or is out of scope.
          return
        }
        if (current.type === 'Program') {
          if (inScriptSetup(node)) report(node, read)
          return
        }
        child = current
        current = current.parent
      }
    }

    /** Template side: everything but v-on handlers and <ClientOnly> content. */
    function checkTemplateRead(node: any, read: string): void {
      let child = node
      let current = node.parent
      while (current) {
        if (isGuardedBranch(current, child)) return
        if (
          current.type === 'VAttribute' &&
          current.directive &&
          current.key?.name?.name === 'on'
        ) {
          return
        }
        if (current.type === 'VElement' && CLIENT_ONLY_TAGS.has(tagNameOf(current))) return
        child = current
        current = current.parent
      }
      report(node, read)
    }

    const visit =
      (check: (node: any, read: string) => void) =>
      (node: any): void => {
        const read = clockReadLabel(node)
        if (read) check(node, read)
      }

    return services.defineTemplateBodyVisitor(
      {
        CallExpression: visit(checkTemplateRead),
        NewExpression: visit(checkTemplateRead),
      },
      {
        CallExpression: visit(checkScriptRead),
        NewExpression: visit(checkScriptRead),
      },
    )
  },
} satisfies Rule.RuleModule
