/**
 * Rule: component-directory-structure
 *
 * Nuxt derives an auto-import name from a component's path, so a flat
 * `components/` root produces ambiguous names and a deep tree produces
 * unusable ones (`<AppDashboardWidgetsChartLegend>`).
 *
 * Kept from v1; the `includes('/app/components/')` gate — dead on relative
 * filenames and on the Nuxt 3 layout — is replaced by the shared, tested
 * `path-scope` util.
 */

import type { Rule } from 'eslint'

import { getFilename, inDir, isTestOrFixturePath } from './_internal'

const DEFAULT_MAX_DEPTH = 2
const COMPONENTS_SEGMENT = 'components/'

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'enforce feature-oriented component folders and shallow component trees',
      recommended: true,
      url: 'https://nuxt.com/docs/guide/directory-structure/components',
    },
    schema: [
      {
        type: 'object',
        properties: { maxDepth: { type: 'number', minimum: 1 } },
        additionalProperties: false,
      },
    ],
    messages: {
      rootLevelComponent:
        'Put this component in a feature folder (components/<feature>/, components/shared/, components/app/) so its auto-import name stays unambiguous.',
      componentTreeTooDeep:
        'Component folder depth {{actualDepth}} exceeds the configured maximum of {{maxDepth}}; the generated auto-import name becomes unwieldy. Flatten the tree.',
    },
  },
  create(context: Rule.RuleContext): Rule.RuleListener {
    const filename = getFilename(context)
    if (isTestOrFixturePath(filename)) return {}
    if (!filename.endsWith('.vue') || !inDir(filename, 'components')) return {}

    const rootIndex = filename.indexOf(COMPONENTS_SEGMENT)
    if (rootIndex < 0) return {}

    const relativePath = filename.slice(rootIndex + COMPONENTS_SEGMENT.length)
    const segments = relativePath.split('/').filter(Boolean)
    const folderDepth = Math.max(0, segments.length - 1)

    const maxDepth =
      ((context.options[0] ?? {}) as { maxDepth?: number }).maxDepth ?? DEFAULT_MAX_DEPTH

    return {
      Program(node: any) {
        if (folderDepth === 0) {
          context.report({ node, messageId: 'rootLevelComponent' })
          return
        }
        if (folderDepth > maxDepth) {
          context.report({
            node,
            messageId: 'componentTreeTooDeep',
            data: { actualDepth: String(folderDepth), maxDepth: String(maxDepth) },
          })
        }
      },
    }
  },
} satisfies Rule.RuleModule
