/**
 * Rule: prefer-shared-collection
 *
 * A bare `<UTable>` rebuilds what narduk-shell's `<NeDataTable>` already owns:
 * the estate's table preset, sort headers and state panels (narduk-libs#260,
 * components-library-plan.md §2 item 13). `NeDataTable.vue` itself is the one
 * place a `<UTable>` belongs. A native `<table>` is reported by the pack's
 * `vue/no-restricted-html-elements` entry, whose message points here too.
 */

import type { Rule } from 'eslint'

import { tagNameOf, templateBodyVisitor } from '../hydration/_internal'
import { getFilename } from './_internal'

const TABLE_TAGS = new Set(['utable'])
const SHARED_TABLE_FILE = /(?:^|\/)NeDataTable\.vue$/

export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'prefer narduk-shell <NeDataTable> over a bare <UTable>',
      recommended: true,
    },
    schema: [],
    messages: {
      preferShared:
        'Use <NeDataTable> from @narduk-enterprises/narduk-shell instead of a bare <{{name}}>. If it cannot do what this table needs, extend it in narduk-libs.',
    },
  },
  create(context: Rule.RuleContext): Rule.RuleListener {
    const filename = getFilename(context)
    if (!filename.endsWith('.vue') || SHARED_TABLE_FILE.test(filename)) return {}

    return templateBodyVisitor(context, {
      VElement(node: any) {
        if (!TABLE_TAGS.has(tagNameOf(node))) return
        context.report({
          node: node.startTag ?? node,
          messageId: 'preferShared',
          data: { name: String(node.rawName ?? node.name) },
        })
      },
    })
  },
} satisfies Rule.RuleModule
