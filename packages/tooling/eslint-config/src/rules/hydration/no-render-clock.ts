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
 * The fix is `useSsrNow(key)` from `@narduk-enterprises/narduk-core` (or,
 * where that is not available, `useState(key, () => Date.now())`): the server
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
 * `process.server`). A mounted flag guards its true side only: a ref from
 * `useMounted()`, or one set to `true` inside `onMounted`, as in
 * `if (mounted.value) return new Date()` or after
 * `if (!mounted.value) return null` (narduk-ui's NsFreshnessChip). Only `.vue` files are checked, and `.client.vue` /
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
  runsSynchronously,
  tagNameOf,
  CLIENT_ONLY_TAGS,
} from './_internal'

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

/** Composables whose ref is `false` during SSR and hydration, `true` after mount. */
const MOUNTED_COMPOSABLES = new Set(['useMounted'])

function walk(node: any, visit: (node: any) => void): void {
  if (!node || typeof node.type !== 'string') return
  visit(node)
  for (const key of Object.keys(node)) {
    if (key === 'parent' || key === 'range' || key === 'loc') continue
    const value = node[key]
    if (Array.isArray(value)) {
      for (const item of value) walk(item, visit)
    } else if (value && typeof value.type === 'string') {
      walk(value, visit)
    }
  }
}

/**
 * Refs that only become true after mount: `const mounted = useMounted()`, or
 * a ref set with `x.value = true` inside an `onMounted` callback. A branch
 * guarded by one never runs during SSR or the hydrating render.
 */
function collectMountedFlags(program: any): Set<string> {
  const flags = new Set<string>()
  walk(program, (node) => {
    if (
      node.type === 'VariableDeclarator' &&
      node.id?.type === 'Identifier' &&
      node.init?.type === 'CallExpression' &&
      MOUNTED_COMPOSABLES.has(calleeName(node.init) ?? '')
    ) {
      flags.add(node.id.name)
    }
    if (node.type !== 'CallExpression' || calleeName(node) !== 'onMounted') return
    walk(node.arguments?.[0], (inner) => {
      if (
        inner.type === 'AssignmentExpression' &&
        inner.operator === '=' &&
        inner.right?.type === 'Literal' &&
        inner.right.value === true &&
        inner.left?.type === 'MemberExpression' &&
        !inner.left.computed &&
        inner.left.object?.type === 'Identifier' &&
        inner.left.property?.name === 'value'
      ) {
        flags.add(inner.left.object.name)
      }
    })
  })
  return flags
}

/** `import.meta.client|server`, `process.client|server`. */
function isRuntimeFlag(node: any): boolean {
  if (node?.type !== 'MemberExpression' || node.computed) return false
  const property = node.property?.name
  if (property !== 'client' && property !== 'server') return false
  const object = node.object
  if (object?.type === 'MetaProperty') return true
  return object?.type === 'Identifier' && object.name === 'process'
}

/** `mounted.value` in script, or `mounted` in a template (refs are unwrapped). */
function isMountedFlag(node: any, mountedFlags: Set<string>): boolean {
  if (node?.type === 'Identifier') return mountedFlags.has(node.name)
  return (
    node?.type === 'MemberExpression' &&
    !node.computed &&
    node.object?.type === 'Identifier' &&
    node.property?.name === 'value' &&
    mountedFlags.has(node.object.name)
  )
}

/**
 * Does code that runs when `test` evaluates to `when` run only on one side of
 * hydration? A runtime flag (`import.meta.client`, …) guards both of its
 * branches: each branch runs on exactly one side. A mounted flag guards only
 * its true side: `!mounted.value` is exactly the SSR and hydrating render.
 */
function isGuard(test: any, when: boolean, mountedFlags: Set<string>): boolean {
  if (!test) return false
  if (test.type === 'UnaryExpression' && test.operator === '!') {
    return isGuard(test.argument, !when, mountedFlags)
  }
  if (test.type === 'LogicalExpression') {
    // `a && b` true ⇒ both true; `a || b` false ⇒ both false. Either operand
    // then pins the side. The other combinations pin nothing.
    if ((test.operator === '&&' && when) || (test.operator === '||' && !when)) {
      return isGuard(test.left, when, mountedFlags) || isGuard(test.right, when, mountedFlags)
    }
    // Runtime flags keep their original leniency: any operand counts.
    return containsRuntimeFlag(test)
  }
  if (isRuntimeFlag(test)) return true
  return when && isMountedFlag(test, mountedFlags)
}

function containsRuntimeFlag(test: any): boolean {
  if (isRuntimeFlag(test)) return true
  if (test?.type === 'UnaryExpression' && test.operator === '!') {
    return containsRuntimeFlag(test.argument)
  }
  if (test?.type === 'LogicalExpression') {
    return containsRuntimeFlag(test.left) || containsRuntimeFlag(test.right)
  }
  return false
}

/** Is `child` inside a guarded branch (not the test) of `parent`? */
function isGuardedBranch(parent: any, child: any, mountedFlags: Set<string>): boolean {
  if (parent.type === 'IfStatement' || parent.type === 'ConditionalExpression') {
    if (child === parent.test) return false
    return isGuard(parent.test, child === parent.consequent, mountedFlags)
  }
  if (parent.type === 'LogicalExpression' && child === parent.right) {
    if (parent.operator === '&&') return isGuard(parent.left, true, mountedFlags)
    if (parent.operator === '||') return isGuard(parent.left, false, mountedFlags)
  }
  return false
}

function endsInReturn(statement: any): boolean {
  if (statement?.type === 'ReturnStatement') return true
  return statement?.type === 'BlockStatement' && statement.body.at(-1)?.type === 'ReturnStatement'
}

/**
 * An early return on a guard: after `if (!mounted.value) return null`, every
 * later statement of the same block runs only when the test was false.
 */
function isAfterGuardedReturn(block: any, child: any, mountedFlags: Set<string>): boolean {
  if (block?.type !== 'BlockStatement') return false
  for (const statement of block.body) {
    if (statement === child) return false
    if (
      statement.type === 'IfStatement' &&
      !statement.alternate &&
      endsInReturn(statement.consequent) &&
      isGuard(statement.test, false, mountedFlags)
    ) {
      return true
    }
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
        '{{ read }} during render differs between server and client and causes a hydration mismatch. Read it once and hydrate it (`useSsrNow(key)` from @narduk-enterprises/narduk-core, or `useState(key, () => Date.now())`), or read it after mount (onMounted, an event handler, an `import.meta.client` guard, or a mounted flag).',
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

    let mountedFlagsCache: Set<string> | null = null
    const mountedFlags = (): Set<string> =>
      (mountedFlagsCache ??= collectMountedFlags(sourceCode.ast))

    function report(node: any, read: string): void {
      context.report({ node, messageId: 'renderClock', data: { read } })
    }

    /** Script side: walk out to the nearest function / the program. */
    function checkScriptRead(node: any, read: string): void {
      let child = node
      let current = node.parent
      while (current) {
        if (isGuardedBranch(current, child, mountedFlags())) return
        if (isAfterGuardedReturn(current, child, mountedFlags())) return
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
        if (isGuardedBranch(current, child, mountedFlags())) return
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
