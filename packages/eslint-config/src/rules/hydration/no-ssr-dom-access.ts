/**
 * Rule: no-ssr-dom-access
 *
 * Unguarded `window`/`document`/`localStorage`/… access runs during SSR and
 * throws (or silently diverges) before hydration.
 *
 * Rebuilt from v1 (deep-review proof 11), which was unreliable three ways:
 *
 *  - its "skip template nodes" ancestor test was `current.type.startsWith('V')`,
 *    which matches `VariableDeclarator`, so `const width = window.innerWidth`
 *    was skipped in every `.vue` file. Script visitors never see the template
 *    body under `vue-eslint-parser`, so that test is deleted rather than fixed;
 *  - its guard detection accepted `if (import.meta.client) {} else { window… }`
 *    and `if (x || import.meta.client) { window… }` — no branch-position or
 *    operator check. {@link isSsrGuarded} checks both;
 *  - its whole Vue branch was untested (the suite ran under espree), so none of
 *    this executed in CI. The tests for this rule run under `vue-eslint-parser`.
 */

import type { Rule } from 'eslint'

import {
  DOM_GLOBALS,
  getFilename,
  isClientOnlyFile,
  isSsrGuarded,
  isTestOrFixturePath,
  isUnshadowedGlobal,
} from './_internal'

/** `globalThis.window.x` / `self.document.x` — the container is not itself DOM. */
const GLOBAL_CONTAINERS = new Set(['globalThis', 'self'])

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'disallow unguarded DOM access in code that runs during SSR',
      recommended: true,
      url: 'https://nuxt.com/docs/4.x/guide/concepts/rendering',
    },
    schema: [],
    messages: {
      unguardedDomAccess:
        'Unguarded `{{name}}` access runs during SSR. Move it into onMounted(), a .client file, or guard it with `import.meta.client`.',
    },
  },
  create(context: Rule.RuleContext): Rule.RuleListener {
    const filename = getFilename(context)
    if (isClientOnlyFile(filename) || isTestOrFixturePath(filename)) return {}

    /**
     * Returns the DOM global this member expression reads from, but only for the
     * innermost access (`window.a` in `window.a.b`), so a chained read reports once.
     */
    function domGlobalOf(node: any): string | null {
      const object = node.object

      if (object?.type === 'Identifier' && DOM_GLOBALS.has(object.name)) {
        return isUnshadowedGlobal(context, node, object.name) ? object.name : null
      }

      if (
        object?.type === 'MemberExpression' &&
        !object.computed &&
        object.object?.type === 'Identifier' &&
        GLOBAL_CONTAINERS.has(object.object.name) &&
        object.property?.type === 'Identifier' &&
        DOM_GLOBALS.has(object.property.name)
      ) {
        return isUnshadowedGlobal(context, node, object.object.name)
          ? `${object.object.name}.${object.property.name}`
          : null
      }

      return null
    }

    return {
      MemberExpression(node: any) {
        const name = domGlobalOf(node)
        if (!name) return
        if (isSsrGuarded(node)) return

        context.report({ node, messageId: 'unguardedDomAccess', data: { name } })
      },
    }
  },
} satisfies Rule.RuleModule
