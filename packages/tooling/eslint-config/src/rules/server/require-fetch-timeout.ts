/**
 * Rule: require-fetch-timeout
 *
 * An outbound request from a Nitro handler with no timeout holds the request
 * (and, on Workers, the isolate's wall-clock budget) for as long as the remote
 * end cares to stall. `fetch()` has no default timeout at all; `ofetch`/`$fetch`
 * have none either unless one is passed.
 *
 *   flagged   fetch(url)
 *             fetch(url, { headers })
 *             $fetch('https://api.example.com/x')
 *             ofetch(url, { method: 'POST' })
 *
 *   allowed   fetch(url, { signal: AbortSignal.timeout(5_000) })
 *             $fetch(url, { timeout: 5_000 })
 *             $fetch('/api/internal')              — Nitro calls its own
 *                                                    handler in-process
 *             fetch(url, init)                     — options not visible here
 *             fetch(url, { ...init })              — spread may carry a signal
 *
 * Scope: `server/**` sources, test trees exempt. Only the bare `fetch`,
 * `$fetch` and `ofetch` callees (and `globalThis.fetch`) are checked; an
 * options object the rule cannot see into is given the benefit of the doubt,
 * because a false positive here teaches people to ignore the rule.
 */

import type { Rule } from 'eslint'

import { getIdentifierName, isExemptTestPath, unwrapTsWrappers } from '../utils/mutation-route'
import { isServerSourcePath } from '../utils/path-scope'

const FETCH_CALLEES = new Set(['fetch', '$fetch', 'ofetch'])
const BOUNDING_KEYS = new Set(['signal', 'timeout'])

function fetchCalleeName(callee: any): string | null {
  const target = unwrapTsWrappers(callee)
  if (target?.type === 'Identifier') return FETCH_CALLEES.has(target.name) ? target.name : null
  if (
    target?.type === 'MemberExpression' &&
    !target.computed &&
    target.object?.type === 'Identifier' &&
    target.object.name === 'globalThis' &&
    getIdentifierName(target.property) === 'fetch'
  ) {
    return 'fetch'
  }
  return null
}

/** A same-origin path (`'/api/x'`, `` `/api/${id}` ``) that Nitro serves in-process. */
function isInternalPath(node: any): boolean {
  const target = unwrapTsWrappers(node)
  if (target?.type === 'Literal' && typeof target.value === 'string') {
    return target.value.startsWith('/') && !target.value.startsWith('//')
  }
  if (target?.type === 'TemplateLiteral') {
    const head = target.quasis?.[0]?.value?.cooked ?? ''
    return head.startsWith('/') && !head.startsWith('//')
  }
  return false
}

export default {
  meta: {
    type: 'suggestion' as const,
    docs: {
      description: 'require a timeout or abort signal on outbound fetch calls in server code',
      recommended: true,
    },
    schema: [],
    messages: {
      requireTimeout:
        '`{{ callee }}()` in server code has no timeout. Pass `signal: AbortSignal.timeout(ms)` (fetch) or `timeout: ms` ($fetch/ofetch) so a stalled upstream cannot hold the request open.',
    },
  },

  create(context: Rule.RuleContext): Rule.RuleListener {
    const filename = context.filename ?? ''
    if (!isServerSourcePath(filename) || isExemptTestPath(filename)) return {}

    return {
      CallExpression(node: any) {
        const callee = fetchCalleeName(node.callee)
        if (!callee) return
        const [target, options] = node.arguments ?? []
        if (!target) return
        if (callee !== 'fetch' && isInternalPath(target)) return

        const init = unwrapTsWrappers(options)
        if (init) {
          if (init.type !== 'ObjectExpression') return
          for (const property of init.properties ?? []) {
            if (property.type !== 'Property') return // spread: may carry a signal
            if (BOUNDING_KEYS.has(getIdentifierName(property.key) ?? '')) return
          }
        }
        context.report({ node, messageId: 'requireTimeout', data: { callee } })
      },
    }
  },
} satisfies Rule.RuleModule
