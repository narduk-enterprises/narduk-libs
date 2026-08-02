/**
 * Rule: no-worker-global-scope-db-clients
 *
 * Workers cannot safely reuse request-scoped I/O objects across requests, and
 * a client constructed during module evaluation is shared by every request the
 * isolate serves. Create clients inside the handler and let Hyperdrive or the
 * driver pool.
 *
 * Rebuilt on the new shared util, which fixes two things v1 got wrong:
 *   - the Worker-runtime gate no longer classifies an entire checkout as
 *     Worker code because an ancestor directory is called `workers`;
 *   - `const pools = shards.map(() => new Pool(...))` is now detected — v1's
 *     module-evaluation analyzer never looked at eagerly-invoked callbacks.
 *
 * The driver map is extended per the review: `@neondatabase/serverless`,
 * `@libsql/client`, `mongodb` and `ioredis` were all missing.
 *
 * No autofix — moving a client into a handler changes the module's lifetime
 * semantics and often its signature.
 */

import type { Rule } from 'eslint'

import {
  HYPERDRIVE_TROUBLESHOOTING_DOCS_URL,
  createModuleEvaluationAnalyzer,
  createWorkerRuntimeResolver,
  getPropertyName,
} from '../utils/cloudflare-runtime'

/** `new X()` from these modules opens a connection. */
const CONSTRUCTOR_IMPORTS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['pg', new Set(['Client', 'Pool'])],
  ['@neondatabase/serverless', new Set(['Client', 'Pool'])],
  ['mongodb', new Set(['MongoClient'])],
  ['ioredis', new Set(['Redis', 'Cluster'])],
  ['@upstash/redis', new Set(['Redis'])],
  ['@planetscale/database', new Set([])],
])

/** `x()` from these modules opens a connection. */
const FACTORY_IMPORTS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['mysql', new Set(['createConnection', 'createPool'])],
  ['mysql2', new Set(['createConnection', 'createPool'])],
  ['mysql2/promise', new Set(['createConnection', 'createPool'])],
  ['@neondatabase/serverless', new Set(['neon', 'neonConfig'])],
  ['@libsql/client', new Set(['createClient'])],
  ['@libsql/client/web', new Set(['createClient'])],
  ['@planetscale/database', new Set(['connect'])],
  ['@upstash/redis', new Set(['fromEnv'])],
])

/** Modules whose DEFAULT export is a connection factory. */
const DEFAULT_FACTORY_SOURCES: ReadonlySet<string> = new Set(['postgres', 'mysql2/promise'])

/** Modules whose DEFAULT export is a connection CONSTRUCTOR (`new Redis()`). */
const DEFAULT_CONSTRUCTOR_SOURCES: ReadonlySet<string> = new Set(['ioredis'])

export default {
  meta: {
    type: 'problem' as const,
    docs: {
      description: 'disallow creating database or cache clients in Cloudflare Worker global scope',
      recommended: true,
      url: HYPERDRIVE_TROUBLESHOOTING_DOCS_URL,
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
      noGlobalScopeDbClient:
        '{{operation}} runs during module evaluation, so every request in this isolate shares it. Create the client inside the handler and let Hyperdrive or the driver manage pooling. See: {{url}}',
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

    const constructorNames = new Set<string>()
    const factoryNames = new Set<string>()
    const namespaceConstructors = new Map<string, Set<string>>()
    const namespaceFactories = new Map<string, Set<string>>()

    function addNamespaceEntry(
      target: Map<string, Set<string>>,
      namespace: string,
      members: Iterable<string>,
    ): void {
      const existing = target.get(namespace) ?? new Set<string>()
      for (const member of members) existing.add(member)
      target.set(namespace, existing)
    }

    function report(node: any, operation: string): void {
      context.report({
        node,
        messageId: 'noGlobalScopeDbClient',
        data: { operation, url: HYPERDRIVE_TROUBLESHOOTING_DOCS_URL },
      })
    }

    return {
      ImportDeclaration(node: any) {
        const source = node.source?.value
        if (typeof source !== 'string') return

        const constructorImports = CONSTRUCTOR_IMPORTS.get(source)
        const factoryImports = FACTORY_IMPORTS.get(source)

        for (const specifier of node.specifiers ?? []) {
          if (specifier.type === 'ImportSpecifier') {
            const importedName = getPropertyName(specifier.imported)
            if (!importedName) continue
            if (constructorImports?.has(importedName)) constructorNames.add(specifier.local.name)
            if (factoryImports?.has(importedName)) factoryNames.add(specifier.local.name)
            continue
          }

          if (specifier.type === 'ImportDefaultSpecifier') {
            if (DEFAULT_FACTORY_SOURCES.has(source)) factoryNames.add(specifier.local.name)
            if (DEFAULT_CONSTRUCTOR_SOURCES.has(source)) constructorNames.add(specifier.local.name)
            // A CJS default import also exposes the named members.
            if (constructorImports) {
              addNamespaceEntry(namespaceConstructors, specifier.local.name, constructorImports)
            }
            if (factoryImports) {
              addNamespaceEntry(namespaceFactories, specifier.local.name, factoryImports)
            }
            continue
          }

          if (specifier.type === 'ImportNamespaceSpecifier') {
            if (constructorImports) {
              addNamespaceEntry(namespaceConstructors, specifier.local.name, constructorImports)
            }
            if (factoryImports) {
              addNamespaceEntry(namespaceFactories, specifier.local.name, factoryImports)
            }
          }
        }
      },

      NewExpression(node: any) {
        if (!analyzer.isExecutedDuringModuleEvaluation(node)) return
        const callee = node.callee

        if (callee?.type === 'Identifier' && constructorNames.has(callee.name)) {
          report(callee, `new ${callee.name}()`)
          return
        }
        if (callee?.type !== 'MemberExpression' || callee.object?.type !== 'Identifier') return

        const members = namespaceConstructors.get(callee.object.name)
        const propertyName = getPropertyName(callee.property)
        if (propertyName && members?.has(propertyName)) {
          report(callee, `new ${callee.object.name}.${propertyName}()`)
        }
      },

      CallExpression(node: any) {
        if (!analyzer.isExecutedDuringModuleEvaluation(node)) return
        const callee = node.callee

        if (callee?.type === 'Identifier' && factoryNames.has(callee.name)) {
          report(callee, `${callee.name}()`)
          return
        }
        if (callee?.type !== 'MemberExpression' || callee.object?.type !== 'Identifier') return

        const members = namespaceFactories.get(callee.object.name)
        const propertyName = getPropertyName(callee.property)
        if (propertyName && members?.has(propertyName)) {
          report(callee, `${callee.object.name}.${propertyName}()`)
        }
      },
    }
  },
} satisfies Rule.RuleModule
