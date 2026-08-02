/**
 * Rule: no-supabase-client-in-global-scope
 *
 * A Supabase client created during module evaluation holds fetch handles, auth
 * tokens and per-request state that every request in the isolate then shares.
 * Create it inside the handler, or inject it through `event.context`.
 *
 * v1's scope resolution was the good part of this rule and is kept: the callee
 * is resolved back to the actual import binding, so a locally-shadowed
 * `createClient` is not flagged. What changed:
 *   - it runs on the rebuilt module-evaluation analyzer, so
 *     `regions.map(() => createClient(...))` is now caught;
 *   - `@supabase/ssr`'s `createServerClient` / `createBrowserClient` are
 *     covered, not just `@supabase/supabase-js`;
 *   - test and fixture files are excluded.
 *
 * Deliberately **not** gated on Worker-runtime detection: a module-scope
 * Supabase client is a cross-request leak in any SSR module, Worker or not.
 * File selection is the capability pack's job.
 *
 * No autofix — moving the client changes the module's exported shape.
 */

import type { Rule } from 'eslint'

import { createModuleEvaluationAnalyzer } from '../utils/cloudflare-runtime'
import { isTestOrFixturePath } from '../utils/path-scope'

const SUPABASE_FACTORIES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['@supabase/supabase-js', new Set(['createClient'])],
  ['@supabase/auth-js', new Set(['createClient'])],
  ['@supabase/ssr', new Set(['createServerClient', 'createBrowserClient'])],
])

export default {
  meta: {
    type: 'problem' as const,
    docs: {
      description: 'disallow creating Supabase clients during module evaluation (global scope)',
      recommended: true,
    },
    schema: [{ type: 'object', properties: {}, additionalProperties: false }],
    messages: {
      noGlobalScopeSupabaseClient:
        '`{{factory}}(...)` from {{source}} runs during module evaluation, so every request shares one client. Create it inside the request handler, or inject it through event.context — a module-scope client leaks auth tokens across requests and breaks Workers request isolation.',
    },
  },

  create(context: Rule.RuleContext): Rule.RuleListener {
    const filename = context.filename ?? (context as any).getFilename?.() ?? ''
    if (filename && isTestOrFixturePath(filename)) return {}

    const sourceCode = context.sourceCode
    const analyzer = createModuleEvaluationAnalyzer(sourceCode)

    /** Import-specifier node -> { source, factory }. Keyed by node so scope
     *  resolution can prove the call site really is that import. */
    const factorySpecifiers = new Map<any, { source: string; factory: string }>()
    const factoryLocalNames = new Map<string, { source: string; factory: string }>()
    const namespaceSpecifiers = new Map<any, string>()
    const namespaceLocalNames = new Map<string, string>()

    function resolve<T>(
      identifier: any,
      specifierNodes: Map<any, T>,
      localNames: Map<string, T>,
    ): T | undefined {
      let scope: any = sourceCode.getScope(identifier)
      while (scope) {
        const variable = scope.variables.find(
          (candidate: any) => candidate.name === identifier.name,
        )
        if (variable) {
          for (const definition of variable.defs ?? []) {
            if (definition.type === 'ImportBinding' && specifierNodes.has(definition.node)) {
              return specifierNodes.get(definition.node)
            }
          }
          // Resolves to some other (shadowing) binding — not our import.
          return undefined
        }
        scope = scope.upper
      }
      // Unresolved by the scope manager: fall back to the local import name.
      return localNames.get(identifier.name)
    }

    return {
      ImportDeclaration(node: any) {
        const source = node.source?.value
        if (typeof source !== 'string') return
        const factories = SUPABASE_FACTORIES.get(source)
        if (!factories) return

        for (const specifier of node.specifiers ?? []) {
          if (
            specifier.type === 'ImportSpecifier' &&
            specifier.imported?.type === 'Identifier' &&
            factories.has(specifier.imported.name)
          ) {
            const entry = { source, factory: specifier.imported.name }
            factorySpecifiers.set(specifier, entry)
            factoryLocalNames.set(specifier.local.name, entry)
          }
          if (specifier.type === 'ImportNamespaceSpecifier') {
            namespaceSpecifiers.set(specifier, source)
            namespaceLocalNames.set(specifier.local.name, source)
          }
        }
      },

      CallExpression(node: any) {
        if (!analyzer.isExecutedDuringModuleEvaluation(node)) return
        const callee = node.callee

        if (callee?.type === 'Identifier') {
          const entry = resolve(callee, factorySpecifiers, factoryLocalNames)
          if (entry) {
            context.report({
              node: callee,
              messageId: 'noGlobalScopeSupabaseClient',
              data: entry,
            })
          }
          return
        }

        if (
          callee?.type === 'MemberExpression' &&
          callee.object?.type === 'Identifier' &&
          callee.property?.type === 'Identifier'
        ) {
          const source = resolve(callee.object, namespaceSpecifiers, namespaceLocalNames)
          if (!source) return
          const factories = SUPABASE_FACTORIES.get(source)
          if (!factories?.has(callee.property.name)) return
          context.report({
            node: callee,
            messageId: 'noGlobalScopeSupabaseClient',
            data: { source, factory: callee.property.name },
          })
        }
      },
    }
  },
} satisfies Rule.RuleModule
