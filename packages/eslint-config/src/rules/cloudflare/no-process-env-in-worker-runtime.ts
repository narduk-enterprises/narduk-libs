/**
 * Rule: no-process-env-in-worker-runtime
 *
 * Worker runtime code must read `useRuntimeConfig()` or a binding, not Node's
 * `process.env` — which under `nodejs_compat` is populated inconsistently and
 * is empty in a plain Worker.
 *
 * v1 matched only the literal `process.env` member chain, so three common
 * spellings walked through:
 *
 *   globalThis.process.env.API_KEY        explicit global access
 *   const p = process; p.env.API_KEY      one-hop alias
 *   const { env } = process               destructured
 *   const { API_KEY } = process.env       destructured value
 *
 * All four are covered here. It also runs on the rebuilt Worker-runtime gate,
 * so a checkout under `~/workers/` no longer turns the whole project into
 * Worker code.
 *
 * Each *materialization* of `process.env` is reported exactly once — reporting
 * both the alias declaration and every later read would triple-count a single
 * mistake.
 *
 * No autofix — the replacement is `useRuntimeConfig()` or a binding, and which
 * one depends on the value.
 */

import type { Rule } from 'eslint'

import { createWorkerRuntimeResolver, getPropertyName } from '../utils/cloudflare-runtime'

interface Options {
  /** Files permitted to read process.env (the env-helper boundary). */
  allowedFiles?: string[]
  workerPathPrefixes?: string[]
}

const DEFAULT_ALLOWED_FILES = ['server/utils/worker-env']

const GLOBAL_OBJECTS: ReadonlySet<string> = new Set(['globalThis', 'self', 'window'])

export default {
  meta: {
    type: 'problem' as const,
    docs: {
      description: 'disallow process.env in Cloudflare Worker runtime files',
      recommended: true,
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowedFiles: { type: 'array', items: { type: 'string' }, uniqueItems: true },
          workerPathPrefixes: { type: 'array', items: { type: 'string' }, uniqueItems: true },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      noProcessEnv:
        'Use useRuntimeConfig(), a runtime binding, or the server env helper instead of process.env in Worker runtime code.',
    },
  },

  create(context: Rule.RuleContext): Rule.RuleListener {
    const options = (context.options[0] ?? {}) as Options
    const filename = context.filename ?? (context as any).getFilename?.() ?? ''

    const resolver = createWorkerRuntimeResolver({
      cwd: (context as any).cwd,
      workerPathPrefixes: options.workerPathPrefixes,
    })
    if (!resolver.isWorkerRuntime(filename)) return {}

    const normalized = String(filename).replaceAll('\\', '/')
    const allowedFiles = options.allowedFiles ?? DEFAULT_ALLOWED_FILES
    if (
      allowedFiles.some((allowed) => new RegExp(`(^|/)${allowed}\\.[cm]?[jt]s$`).test(normalized))
    ) {
      return {}
    }

    const sourceCode = context.sourceCode

    /**
     * Variables that alias the `process` object. Tracked as scope-manager
     * Variables, not names, so a local `const process = {...}` in one function
     * cannot be confused with the real global in another.
     */
    const processAliases = new Set<any>()
    const reported = new Set<any>()

    function report(node: any): void {
      if (reported.has(node)) return
      reported.add(node)
      context.report({ node, messageId: 'noProcessEnv' })
    }

    function resolveVariable(identifier: any): any | null {
      let scope: any = sourceCode.getScope(identifier)
      while (scope) {
        const variable = scope.variables.find(
          (candidate: any) => candidate.name === identifier.name,
        )
        if (variable) return variable
        scope = scope.upper
      }
      return null
    }

    /** Is this node the `process` global (directly or via globalThis)? */
    function isProcessObject(node: any): boolean {
      if (node?.type === 'Identifier') {
        const variable = resolveVariable(node)
        if (variable && processAliases.has(variable)) return true
        if (node.name !== 'process') return false
        // A declared local named `process` shadows the global. A `globals`
        // entry has no defs, so the real global still qualifies.
        return !variable || (variable.defs?.length ?? 0) === 0
      }
      if (node?.type !== 'MemberExpression') return false
      return (
        node.object?.type === 'Identifier' &&
        GLOBAL_OBJECTS.has(node.object.name) &&
        getPropertyName(node.property) === 'process'
      )
    }

    /** Is this member expression `<process>.env`? */
    function isProcessEnv(node: any): boolean {
      if (node?.type !== 'MemberExpression') return false
      if (getPropertyName(node.property) !== 'env') return false
      return isProcessObject(node.object)
    }

    return {
      // Pass 1 runs implicitly: declarators are visited in source order, and a
      // `const p = process` always precedes its `p.env` uses.
      VariableDeclarator(node: any) {
        if (node.id?.type === 'Identifier' && isProcessObject(node.init)) {
          // `const p = process` — an alias, harmless until `.env` is touched.
          const declared = sourceCode.getDeclaredVariables(node)[0]
          if (declared) processAliases.add(declared)
          return
        }

        // `const { env } = process` / `const { env } = globalThis.process`
        if (node.id?.type === 'ObjectPattern' && isProcessObject(node.init)) {
          for (const property of node.id.properties ?? []) {
            if (property.type !== 'Property') continue
            if (getPropertyName(property.key) === 'env') report(property)
          }
        }
      },

      MemberExpression(node: any) {
        if (!isProcessEnv(node)) return
        // Report the `process.env` node itself, not each key read on it.
        report(node)
      },

      // `const { API_KEY } = process.env` — the init is a MemberExpression and
      // is already reported by the visitor above; nothing extra needed. This
      // visitor covers `function f({ env } = process) {}`-style defaults.
      AssignmentPattern(node: any) {
        if (node.left?.type !== 'ObjectPattern' || !isProcessObject(node.right)) return
        for (const property of node.left.properties ?? []) {
          if (property.type !== 'Property') continue
          if (getPropertyName(property.key) === 'env') report(property)
        }
      },
    }
  },
} satisfies Rule.RuleModule
