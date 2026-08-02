/**
 * Rule: no-locale-date-format-in-ssr-text
 *
 * `toLocaleDateString()`/`toLocaleTimeString()`/`Intl.DateTimeFormat` resolve
 * against the *runtime's* locale and time zone. The Node server and the visitor's
 * browser rarely agree, so a date formatted during render hydrates to different
 * text and Vue logs a hydration-text mismatch.
 *
 * Kept from v1 (the best-tested rule in the package) with three deep-review
 * defects closed:
 *
 *  - `isInsideTemplateAttribute` exempted **every** `VAttribute`, including
 *    `v-bind`, so `:title="d.toLocaleDateString()"` was missed. Template
 *    directives are no longer exempt.
 *  - Guards understood only `import.meta.client`/`server`; `process.client` and
 *    the client-only lifecycle idiom false-positived. Guard detection is now
 *    shared with `no-ssr-dom-access` (see `_internal.ts`).
 *  - The tainted-name set was flat and scope-free, so an unrelated
 *    `Intl.NumberFormat` bound to a name like `formatter` was flagged. Formatter
 *    identifiers are now resolved through scope to their actual initializer.
 */

import type { Rule } from 'eslint'

import {
  getFilename,
  isAppRuntimeFile,
  isClientOnlyFile,
  isInsideClientOnly,
  isServerOnlyFile,
  isSsrGuarded,
  isTestOrFixturePath,
  resolveBindingInit,
  templateBodyVisitor,
} from './_internal'

/** Unambiguously date/time formatting, whatever the receiver. */
const DATE_ONLY_METHODS = new Set(['toLocaleDateString', 'toLocaleTimeString'])

/** Ambiguous — only a date receiver makes this a hydration hazard. */
const AMBIGUOUS_METHOD = 'toLocaleString'

function isNewDate(node: any): boolean {
  return (
    node?.type === 'NewExpression' &&
    node.callee?.type === 'Identifier' &&
    node.callee.name === 'Date'
  )
}

/** `new Intl.DateTimeFormat(…)` or `Intl.DateTimeFormat(…)` — but never `Intl.NumberFormat`. */
function isDateTimeFormatFactory(node: any): boolean {
  if (node?.type !== 'NewExpression' && node?.type !== 'CallExpression') return false
  const callee = node.callee
  return (
    callee?.type === 'MemberExpression' &&
    !callee.computed &&
    callee.object?.type === 'Identifier' &&
    callee.object.name === 'Intl' &&
    callee.property?.type === 'Identifier' &&
    callee.property.name === 'DateTimeFormat'
  )
}

/**
 * Is this node evaluated while the page is being rendered (so its output ends up
 * in the SSR payload), as opposed to inside an event handler or a client-only
 * lifecycle callback that only runs after hydration?
 */
function isRenderEvaluated(node: any): boolean {
  let parent: any = node?.parent

  while (parent) {
    if (
      parent.type === 'ArrowFunctionExpression' ||
      parent.type === 'FunctionExpression' ||
      parent.type === 'FunctionDeclaration'
    ) {
      const call = parent.parent
      const calleeName =
        call?.type === 'CallExpression' && call.callee?.type === 'Identifier'
          ? call.callee.name
          : null
      // A computed() getter is evaluated during server render; an event handler
      // or a client-only lifecycle callback is not.
      if (!(calleeName === 'computed' && call.arguments?.includes(parent))) return false
    }
    parent = parent.parent
  }

  return true
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'disallow locale-dependent date formatting in server-rendered output',
      recommended: true,
      url: 'https://nuxt.com/docs/4.x/guide/concepts/rendering',
    },
    schema: [],
    messages: {
      localeDateFormat:
        '`{{name}}` formats against the runtime locale/time zone, so the server and browser render different text and hydration mismatches. Format inside a client guard (import.meta.client / onMounted), or send a stable ISO string and format it client-side.',
    },
  },
  create(context: Rule.RuleContext): Rule.RuleListener {
    const filename = getFilename(context)
    if (isTestOrFixturePath(filename)) return {}
    if (isClientOnlyFile(filename) || isServerOnlyFile(filename)) return {}
    if (!filename.endsWith('.vue') && !isAppRuntimeFile(filename)) return {}

    /** Resolves `fmt.format(x)` to whether `fmt` really holds an `Intl.DateTimeFormat`. */
    function isDateTimeFormatterRef(node: any): boolean {
      if (isDateTimeFormatFactory(node)) return true
      if (node?.type !== 'Identifier') return false
      return isDateTimeFormatFactory(resolveBindingInit(context, node, node.name))
    }

    function isDateReceiver(node: any): boolean {
      if (isNewDate(node)) return true
      if (node?.type !== 'Identifier') return false
      return isNewDate(resolveBindingInit(context, node, node.name))
    }

    /** Returns the reportable name when this call is locale-dependent date formatting. */
    function localeFormatNameOf(node: any): string | null {
      const callee = node.callee
      if (callee?.type !== 'MemberExpression' || callee.computed) return null
      if (callee.property?.type !== 'Identifier') return null

      const method = callee.property.name

      if (DATE_ONLY_METHODS.has(method)) return method
      if (method === AMBIGUOUS_METHOD && isDateReceiver(callee.object)) return method
      if (method === 'format' && isDateTimeFormatterRef(callee.object))
        return 'Intl.DateTimeFormat.format'

      return null
    }

    function checkScriptCall(node: any) {
      const name = localeFormatNameOf(node)
      if (!name) return
      if (!isRenderEvaluated(node)) return
      if (isSsrGuarded(node)) return
      context.report({ node, messageId: 'localeDateFormat', data: { name } })
    }

    function checkTemplateCall(node: any) {
      const name = localeFormatNameOf(node)
      if (!name) return
      if (isInsideClientOnly(node)) return
      context.report({ node, messageId: 'localeDateFormat', data: { name } })
    }

    return templateBodyVisitor(
      context,
      { CallExpression: checkTemplateCall },
      { CallExpression: checkScriptCall },
    )
  },
} satisfies Rule.RuleModule
