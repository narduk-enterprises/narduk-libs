/**
 * Bakes the workspace inventory into `#explorer-inventory` and refuses to
 * build while the coverage check reports a problem. It also lists the preview
 * frame routes for prerendering.
 */
import { addTemplate, addTypeTemplate, defineNuxtModule } from 'nuxt/kit'
import { resolve } from 'node:path'

import { frameRoutes } from '../demo/frame.mts'
import { loadInventory } from '../inventory/index.mts'

export default defineNuxtModule({
  meta: { name: 'explorer-inventory' },
  setup(_options, nuxt) {
    const explorerRoot = nuxt.options.rootDir
    const repoRoot = resolve(explorerRoot, '../../..')
    const { inventory, problems } = loadInventory(repoRoot, explorerRoot)
    if (problems.length > 0) {
      throw new Error(`Explorer coverage check failed:\n- ${problems.join('\n- ')}`)
    }

    // Preview frames are reached only through an iframe `src`, which the
    // prerender crawler does not follow.
    nuxt.hook('nitro:config', (config) => {
      config.prerender ??= {}
      config.prerender.routes = [
        ...(config.prerender.routes ?? []),
        ...frameRoutes(inventory.examples),
      ]
    })

    const template = addTemplate({
      filename: 'explorer-inventory.mjs',
      getContents: () => `export default ${JSON.stringify(inventory)}\n`,
    })
    nuxt.options.alias['#explorer-inventory'] = template.dst

    const typesPath = resolve(explorerRoot, 'inventory/index.mts')
    addTypeTemplate({
      filename: 'types/explorer-inventory.d.ts',
      getContents: () =>
        [
          "declare module '#explorer-inventory' {",
          `  const inventory: import('${typesPath}').ExplorerInventory`,
          '  export default inventory',
          '}',
          '',
        ].join('\n'),
    })
  },
})
