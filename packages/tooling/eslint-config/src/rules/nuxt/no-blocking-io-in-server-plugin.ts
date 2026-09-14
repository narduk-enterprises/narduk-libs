/**
 * Rule: no-blocking-io-in-server-plugin
 *
 * A Nitro server plugin runs during worker startup. Awaiting I/O in its body
 * blocks *every* request behind that round trip on a cold start; the same work
 * belongs in a lazily-initialised singleton or in a `nitroApp.hook(…)` callback.
 *
 * Kept from v1 with the deep-review defect fixed: v1 recognised database I/O by
 * the literal identifier `db`, so `database.select()…`, an injected client, or a
 * handle under any other name was invisible — and it missed
 * `await Promise.all([$fetch(a), $fetch(b)])`, the canonical cold-start blocker
 * entirely. Detection is now by call shape (see `isIoExpression` in `_internal.ts`).
 */

import type { Rule } from 'eslint'

import {
  SCRIPT_EXTENSION_PATTERN,
  bareCalleeName,
  getFilename,
  inServerDir,
  isIoExpression,
  isTestOrFixturePath,
} from './_internal'

const PLUGIN_DEFINERS = new Set(['defineNitroPlugin', 'defineServerPlugin'])

function enclosingFunction(node: any): any {
  let current: any = node?.parent
  while (current) {
    if (
      current.type === 'FunctionDeclaration' ||
      current.type === 'FunctionExpression' ||
      current.type === 'ArrowFunctionExpression'
    ) {
      return current
    }
    current = current.parent
  }
  return null
}

/** The plugin's own entry function — `defineNitroPlugin(fn)` or `export default fn`. */
function isPluginEntryFunction(fn: any): boolean {
  const parent = fn?.parent
  if (!parent) return false
  if (parent.type === 'CallExpression') {
    const name = bareCalleeName(parent.callee)
    return !!name && PLUGIN_DEFINERS.has(name) && parent.arguments?.includes(fn)
  }
  return parent.type === 'ExportDefaultDeclaration'
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'disallow blocking I/O at the top level of a Nitro server plugin',
      recommended: true,
      url: 'https://nitro.build/guide/plugins',
    },
    schema: [],
    messages: {
      blockingStartupIo:
        'This await runs during worker startup and blocks every request on a cold start. Initialise lazily on first use, or move the work into a nitroApp.hook() callback.',
    },
  },
  create(context: Rule.RuleContext): Rule.RuleListener {
    const filename = getFilename(context)
    if (isTestOrFixturePath(filename)) return {}
    if (!inServerDir(filename, 'plugins') || !SCRIPT_EXTENSION_PATTERN.test(filename)) return {}

    return {
      AwaitExpression(node: any) {
        if (!isIoExpression(node.argument)) return

        const fn = enclosingFunction(node)
        // Module top-level await, or an await directly in the plugin entry body.
        if (fn && !isPluginEntryFunction(fn)) return

        context.report({ node, messageId: 'blockingStartupIo' })
      },
    }
  },
} satisfies Rule.RuleModule
