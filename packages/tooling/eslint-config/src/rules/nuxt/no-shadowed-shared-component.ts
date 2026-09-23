/**
 * Rule: no-shadowed-shared-component
 *
 * An app-local component whose name matches a component a shared
 * `@narduk-enterprises/*` package publishes is a local copy (narduk-libs#260).
 * For narduk-core and narduk-auth, which register their directories with
 * `pathPrefix: false`, the app's file silently replaces the shared one; for the
 * others it is a fork that stops receiving fixes. Either way the fix belongs
 * upstream (company-hq `docs/NARDUK-APP-COMPLIANCE.md` §3.9).
 *
 * Both names are checked: the file name, which is what an author copies, and
 * the name Nuxt registers from the path, so `components/ne/StatePanel.vue`
 * (`NeStatePanel`) is caught as well as `components/shared/AppTabs.vue`.
 */

import type { Rule } from 'eslint'

import {
  SHARED_COMPONENT_OWNER_BY_NAME,
  isSharedComponentSource,
  nuxtComponentName,
} from '../utils/shared-components'
import { getFilename, inDir, isTestOrFixturePath } from './_internal'

const COMPONENTS_SEGMENT = 'components/'

export default {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'disallow an app-local component that shadows a shared @narduk-enterprises component',
      recommended: true,
    },
    schema: [],
    messages: {
      shadowed:
        '`{{name}}` is a @narduk-enterprises/{{pkg}} component. Use the shared one, fix or extend it in narduk-libs, or give this product-specific component its own name.',
    },
  },
  create(context: Rule.RuleContext): Rule.RuleListener {
    const filename = getFilename(context)
    if (isTestOrFixturePath(filename)) return {}
    if (!filename.endsWith('.vue') || !inDir(filename, 'components')) return {}
    if (isSharedComponentSource(filename)) return {}

    const rootIndex = filename.lastIndexOf(COMPONENTS_SEGMENT)
    if (rootIndex < 0) return {}
    const relativePath = filename.slice(rootIndex + COMPONENTS_SEGMENT.length)
    const baseName = (relativePath.split('/').at(-1) ?? '').replace(/\.vue$/, '')

    const name = [baseName, nuxtComponentName(relativePath)].find((candidate) =>
      SHARED_COMPONENT_OWNER_BY_NAME.has(candidate),
    )
    if (!name) return {}
    const owner = SHARED_COMPONENT_OWNER_BY_NAME.get(name)

    return {
      Program(node: any) {
        context.report({ node, messageId: 'shadowed', data: { name, pkg: owner?.pkg ?? '' } })
      },
    }
  },
} satisfies Rule.RuleModule
