/**
 * Rule: no-fetch-create-bypass
 *
 * `$fetch.create()` returns a fresh ofetch instance that has none of the app's
 * interceptors — most importantly the CSRF header the fetch plugin installs on
 * the global `$fetch`. Requests made through it are rejected (or, worse,
 * accepted without the protection).
 *
 * Kept from v1 with the `testMode` bypass removed and the allowlist branch
 * covered by real tests through real filenames — the deep review found it
 * unreachable in v1's suite.
 */

import type { Rule } from 'eslint'

import { getFilename, isTestOrFixturePath, unwrapCalleeWrappers } from './_internal'
import { isAppRuntimeFile } from '../hydration/_internal'

/** Files whose job is to build the wrapped instance. */
const ALLOWED_FILE_PATTERNS = [
  /plugins\/fetch\.client\./,
  /composables\/useCsrfFetch\./,
  /composables\/useAppFetch\./,
]

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        '$fetch.create() bypasses the app fetch interceptors — use the injected fetch instead',
      recommended: true,
    },
    schema: [],
    messages: {
      fetchCreateBypass:
        '`$fetch.create()` returns an instance without the app CSRF/auth interceptors. Use the injected `$csrfFetch` (useNuxtApp()) or the globally patched `$fetch`.',
    },
  },
  create(context: Rule.RuleContext): Rule.RuleListener {
    const filename = getFilename(context)
    if (isTestOrFixturePath(filename)) return {}
    if (!isAppRuntimeFile(filename)) return {}
    if (ALLOWED_FILE_PATTERNS.some((pattern) => pattern.test(filename))) return {}

    return {
      CallExpression(node: any) {
        const callee = unwrapCalleeWrappers(node.callee)
        if (callee?.type !== 'MemberExpression' || callee.computed) return
        if (callee.property?.type !== 'Identifier' || callee.property.name !== 'create') return

        const receiver = unwrapCalleeWrappers(callee.object)
        const receiverName =
          receiver?.type === 'Identifier'
            ? receiver.name
            : receiver?.type === 'MemberExpression' &&
                !receiver.computed &&
                receiver.property?.type === 'Identifier'
              ? receiver.property.name
              : null

        if (receiverName !== '$fetch') return

        context.report({ node: callee, messageId: 'fetchCreateBypass' })
      },
    }
  },
} satisfies Rule.RuleModule
