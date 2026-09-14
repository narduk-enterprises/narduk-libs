/**
 * Rule: no-worker-global-scope-operations
 *
 * Cloudflare Workers forbid async I/O, timers, and random generation during
 * module evaluation. Those operations must happen lazily inside a handler.
 *
 * v1 flagged **any member call named `fetch` or `connect` on any receiver**, so
 * `cache.fetch(key)`, `stripe.fetch(id)` and `pool.connect()` were all reported
 * as global-scope network I/O. This rebuild is receiver-aware:
 *
 *   flagged   fetch(url)                    global fetch
 *             globalThis.fetch(url)         explicit global
 *             $fetch('/api/x')              ofetch — real network I/O
 *             connect({ hostname })         imported from cloudflare:sockets
 *             setTimeout(fn, 0)             timer
 *             crypto.randomUUID()           random during module eval
 *             Math.random()
 *
 *   allowed   cache.fetch(key)              a cache, not the network
 *             pool.connect()                a driver handle
 *             someObject.fetch(id)
 *
 * (Constructing a *client* at module scope is the sibling rule's job.)
 *
 * No autofix — the fix is to move the operation into a handler.
 */

import type { Rule } from 'eslint'

import {
  WORKER_HANDLERS_DOCS_URL,
  createModuleEvaluationAnalyzer,
  createWorkerRuntimeResolver,
  getPropertyName,
} from '../utils/cloudflare-runtime'

/** Modules whose `connect`/`fetch` export really is network I/O. */
const NETWORK_MODULES: ReadonlySet<string> = new Set([
  'cloudflare:sockets',
  'node:net',
  'net',
  'node-fetch',
  'undici',
  'ofetch',
])

const GLOBAL_OBJECTS: ReadonlySet<string> = new Set(['globalThis', 'self', 'window'])

export default {
  meta: {
    type: 'problem' as const,
    docs: {
      description:
        'disallow Cloudflare Worker global-scope network I/O, timers, and random generation',
      recommended: true,
      url: WORKER_HANDLERS_DOCS_URL,
    },
    schema: [
      {
        type: 'object',
        properties: {
          workerPathPrefixes: { type: 'array', items: { type: 'string' }, uniqueItems: true },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      disallowedGlobalScopeOperation:
        '{{operation}} is not allowed in Cloudflare Worker global scope. Move it into a handler or a lazily invoked helper. See: {{url}}',
    },
  },

  create(context: Rule.RuleContext): Rule.RuleListener {
    const options = (context.options[0] ?? {}) as { workerPathPrefixes?: string[] }
    const filename = context.filename ?? (context as any).getFilename?.() ?? ''

    const resolver = createWorkerRuntimeResolver({
      cwd: (context as any).cwd,
      workerPathPrefixes: options.workerPathPrefixes,
    })
    if (!resolver.isWorkerRuntime(filename)) return {}

    const analyzer = createModuleEvaluationAnalyzer(context.sourceCode)
    const sourceCode = context.sourceCode

    /** Local names bound to a network-module import (`connect`, `fetch`, `$fetch`). */
    const networkImportNames = new Set<string>()
    /** Namespace locals bound to a network module (`import * as net`). */
    const networkNamespaceNames = new Set<string>()

    /**
     * Is this identifier the ambient global, rather than a local binding?
     *
     * A `languageOptions.globals` entry produces a Variable with **no defs** —
     * still the global. Only a real declaration (`function fetch() {}`, an
     * import, a parameter) shadows it. Treating any resolved variable as a
     * shadow would silently disable this rule for every config that declares
     * worker/browser globals, which is most of them.
     */
    function isGlobalIdentifier(identifier: any): boolean {
      let scope: any = sourceCode.getScope(identifier)
      while (scope) {
        const variable = scope.variables.find(
          (candidate: any) => candidate.name === identifier.name,
        )
        if (variable) return (variable.defs?.length ?? 0) === 0
        scope = scope.upper
      }
      return true
    }

    function isGlobalObject(node: any): boolean {
      return node?.type === 'Identifier' && GLOBAL_OBJECTS.has(node.name)
    }

    function isRandomSource(node: any): boolean {
      if (node?.type === 'Identifier' && node.name === 'crypto') return true
      if (node?.type !== 'MemberExpression') return false
      return isGlobalObject(node.object) && getPropertyName(node.property) === 'crypto'
    }

    function timerName(node: any): string | null {
      const callee = node?.callee
      if (callee?.type === 'Identifier') {
        return callee.name === 'setTimeout' || callee.name === 'setInterval' ? callee.name : null
      }
      if (callee?.type !== 'MemberExpression') return null
      const property = getPropertyName(callee.property)
      if (property !== 'setTimeout' && property !== 'setInterval') return null
      return isGlobalObject(callee.object) ? property : null
    }

    function disallowedOperation(node: any): string | null {
      const callee = node?.callee
      if (!callee) return null

      const timer = timerName(node)
      if (timer) return `${timer}()`

      if (callee.type === 'Identifier') {
        if (callee.name === '$fetch') return '$fetch()'
        if (
          callee.name === 'fetch' &&
          (isGlobalIdentifier(callee) || networkImportNames.has('fetch'))
        ) {
          return 'fetch()'
        }
        if (callee.name === 'connect' && networkImportNames.has('connect')) return 'connect()'
        if (networkImportNames.has(callee.name) && callee.name !== 'fetch') {
          return `${callee.name}()`
        }
        return null
      }

      if (callee.type !== 'MemberExpression') return null
      const property = getPropertyName(callee.property)
      if (!property) return null

      // `globalThis.fetch(...)` / `self.fetch(...)`
      if ((property === 'fetch' || property === 'connect') && isGlobalObject(callee.object)) {
        return `${property}()`
      }
      // `net.connect(...)` where `net` is a network-module namespace.
      if (
        (property === 'fetch' || property === 'connect') &&
        callee.object?.type === 'Identifier' &&
        networkNamespaceNames.has(callee.object.name)
      ) {
        return `${callee.object.name}.${property}()`
      }
      // `$fetch.raw(...)`
      if (callee.object?.type === 'Identifier' && callee.object.name === '$fetch') {
        return `$fetch.${property}()`
      }

      if (property === 'randomUUID' && isRandomSource(callee.object)) return 'crypto.randomUUID()'
      if (property === 'getRandomValues' && isRandomSource(callee.object)) {
        return 'crypto.getRandomValues()'
      }
      if (
        property === 'random' &&
        callee.object?.type === 'Identifier' &&
        callee.object.name === 'Math'
      ) {
        return 'Math.random()'
      }

      return null
    }

    return {
      ImportDeclaration(node: any) {
        const source = node.source?.value
        if (typeof source !== 'string' || !NETWORK_MODULES.has(source)) return
        for (const specifier of node.specifiers ?? []) {
          if (specifier.type === 'ImportNamespaceSpecifier') {
            networkNamespaceNames.add(specifier.local.name)
            continue
          }
          if (specifier.type === 'ImportSpecifier' || specifier.type === 'ImportDefaultSpecifier') {
            networkImportNames.add(specifier.local.name)
          }
        }
      },

      CallExpression(node: any) {
        if (!analyzer.isExecutedDuringModuleEvaluation(node)) return
        const operation = disallowedOperation(node)
        if (!operation) return
        context.report({
          node: node.callee,
          messageId: 'disallowedGlobalScopeOperation',
          data: { operation, url: WORKER_HANDLERS_DOCS_URL },
        })
      },
    }
  },
} satisfies Rule.RuleModule
