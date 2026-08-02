/**
 * Rule: no-non-serializable-store-state
 *
 * Pinia state is serialized into the SSR payload and revived with
 * `devalue`-style structured cloning. A `Map`, `Set`, `Date` or class instance
 * survives as a plain object, so the client store silently differs from the
 * server's.
 *
 * Two deep-review defects are fixed:
 *
 *  - the matcher only recognised `Map`/`Set` while the message promised
 *    "Map, Set, Date, or class instances" — every constructor is now matched and
 *    the reported name comes from the actual constructor, so the report matches
 *    the message;
 *  - v1 flagged *any* `new Map()` in the file, including module-level lookup
 *    constants that are never state. Only state positions inside `defineStore`
 *    are inspected now.
 */

import type { Rule } from 'eslint'

import { SCRIPT_EXTENSION_PATTERN, getFilename, inDir } from './_internal'

/** Constructors whose instances survive SSR serialization unchanged. */
const SERIALIZABLE_CONSTRUCTORS = new Set(['Array', 'Object'])

/** Types that cannot survive `ref<T>()` state serialization. */
const NON_SERIALIZABLE_TYPES = new Set(['Map', 'Set', 'Date', 'WeakMap', 'WeakSet', 'RegExp'])

const STATE_WRAPPERS = new Set(['ref', 'shallowRef', 'reactive', 'shallowReactive'])

function typeArgumentsOf(node: any): any[] {
  return node?.typeArguments?.params ?? node?.typeParameters?.params ?? []
}

function nonSerializableTypeName(typeNode: any): string | null {
  if (typeNode?.type !== 'TSTypeReference') return null
  const name = typeNode.typeName?.type === 'Identifier' ? typeNode.typeName.name : null
  return name && NON_SERIALIZABLE_TYPES.has(name) ? name : null
}

/** The object literal a `() => ({ … })` / `() => { return { … } }` factory returns. */
function returnedObject(fn: any): any | null {
  if (!fn) return null
  if (fn.body?.type === 'ObjectExpression') return fn.body
  if (fn.body?.type !== 'BlockStatement') return null
  for (const statement of fn.body.body ?? []) {
    if (statement.type === 'ReturnStatement' && statement.argument?.type === 'ObjectExpression') {
      return statement.argument
    }
  }
  return null
}

function isFunctionLike(node: any): boolean {
  return node?.type === 'ArrowFunctionExpression' || node?.type === 'FunctionExpression'
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'disallow non-serializable values (Map, Set, Date, class instances) in store state',
      recommended: true,
    },
    schema: [],
    messages: {
      nonSerializable:
        'Store state must survive SSR serialization — `{{name}}` does not. Use a plain object/array, or keep it out of state (e.g. build it in a getter, or shallowRef + skipHydrate).',
      nonSerializableType:
        'Store state typed as `{{name}}` cannot survive SSR serialization. Use a plain object/array shape instead.',
    },
  },
  create(context: Rule.RuleContext): Rule.RuleListener {
    const filename = getFilename(context)
    if (!inDir(filename, 'stores') || !SCRIPT_EXTENSION_PATTERN.test(filename)) return {}

    const reported = new Set<any>()

    /**
     * Reports constructor calls in a state value, descending through object and
     * array literals (`state: () => ({ meta: { at: new Date() } })`) but never
     * into a function body, where a transient instance is fine.
     */
    function reportValue(node: any, depth = 0) {
      if (!node || depth > 10) return

      if (node.type === 'NewExpression') {
        const name = node.callee?.type === 'Identifier' ? node.callee.name : null
        if (!name || SERIALIZABLE_CONSTRUCTORS.has(name)) return
        if (reported.has(node)) return
        reported.add(node)
        context.report({ node, messageId: 'nonSerializable', data: { name } })
        return
      }

      if (node.type === 'ObjectExpression') {
        for (const property of node.properties ?? []) {
          if (property.type === 'Property') reportValue(property.value, depth + 1)
        }
        return
      }

      if (node.type === 'ArrayExpression') {
        for (const element of node.elements ?? []) reportValue(element, depth + 1)
      }
    }

    /** Inspects the arguments and type arguments of `ref()`/`reactive()` state wrappers. */
    function checkStateWrapper(call: any) {
      const name = call.callee?.type === 'Identifier' ? call.callee.name : null
      if (!name || !STATE_WRAPPERS.has(name)) return

      for (const argument of call.arguments ?? []) reportValue(argument)

      for (const typeArgument of typeArgumentsOf(call)) {
        const typeName = nonSerializableTypeName(typeArgument)
        if (typeName) {
          context.report({ node: call, messageId: 'nonSerializableType', data: { name: typeName } })
          return
        }
      }
    }

    /** Walks a setup-store body for state wrappers, without descending into nested stores. */
    function walkSetupBody(node: any, depth: number): void {
      if (!node || typeof node !== 'object' || depth > 40) return

      if (node.type === 'CallExpression') checkStateWrapper(node)

      for (const key of Object.keys(node)) {
        if (key === 'parent' || key === 'loc' || key === 'range') continue
        const child = (node as any)[key]
        if (Array.isArray(child)) {
          for (const entry of child) {
            if (entry && typeof entry === 'object' && typeof entry.type === 'string')
              walkSetupBody(entry, depth + 1)
          }
        } else if (child && typeof child === 'object' && typeof child.type === 'string') {
          walkSetupBody(child, depth + 1)
        }
      }
    }

    return {
      CallExpression(node: any) {
        if (node.callee?.type !== 'Identifier' || node.callee.name !== 'defineStore') return

        for (const argument of node.arguments ?? []) {
          if (isFunctionLike(argument)) {
            // Setup store: state lives in ref()/reactive() calls and in the
            // object the setup function returns.
            walkSetupBody(argument.body, 0)
            const returned = returnedObject(argument)
            for (const property of returned?.properties ?? []) {
              if (property.type === 'Property') reportValue(property.value)
            }
            continue
          }

          if (argument?.type !== 'ObjectExpression') continue

          // Options store: `{ state: () => ({ … }) }`.
          for (const property of argument.properties ?? []) {
            if (
              property.type !== 'Property' ||
              property.computed ||
              property.key?.type !== 'Identifier' ||
              property.key.name !== 'state'
            ) {
              continue
            }
            const returned = returnedObject(property.value)
            for (const stateProperty of returned?.properties ?? []) {
              if (stateProperty.type === 'Property') reportValue(stateProperty.value)
            }
          }
        }
      },
    }
  },
} satisfies Rule.RuleModule
