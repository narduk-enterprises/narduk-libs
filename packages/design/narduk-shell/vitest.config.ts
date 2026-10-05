import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import vue from '@vitejs/plugin-vue'
import ui from '@nuxt/ui/vite'
import { defineConfig } from 'vitest/config'

/*
 * `ULink` outside Nuxt. Nuxt UI's Vite plugin swaps its Nuxt-only `Link.vue`
 * for the vue-router one, but only for imports made from inside Nuxt UI's own
 * runtime (`UButton`'s `./Link.vue`). `NeCollectionTable` imports
 * `@nuxt/ui/components/Link.vue` directly, which in a Nuxt app is the right
 * file and in this plain Vite graph is not, so the same swap is made here.
 */
const nuxtUiLink = createRequire(import.meta.url).resolve('@nuxt/ui/components/Link.vue')
const vueRouterLink = join(dirname(nuxtUiLink), '../vue/overrides/vue-router/Link.vue')
// Likewise `UIcon`: the Nuxt file renders `@nuxt/icon`, which needs Nuxt's
// `#imports`, and the Vue-mode file fetches glyphs from Iconify's API.
// `NeCommandPalette` imports it directly, so tests get a stub that renders the
// icon's name and touches no network.
const iconStub = join(dirname(fileURLToPath(import.meta.url)), 'test/support/IconStub.vue')

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@nuxt\/ui\/components\/Link\.vue$/, replacement: vueRouterLink },
      { find: /^@nuxt\/ui\/components\/Icon\.vue$/, replacement: iconStub },
    ],
  },
  define: {
    // Nuxt replaces this at build time. Tests are a plain Vite graph, so the
    // click path behind `import.meta.client` (NeCsvDownload) needs a value.
    'import.meta.client': 'true',
    'import.meta.server': 'false',
  },
  plugins: [
    {
      name: 'import-meta-client',
      enforce: 'post',
      transform(code: string, id: string) {
        if (id.includes('node_modules')) return
        if (!code.includes('import.meta.client') && !code.includes('import.meta.server')) return
        return {
          code: code
            .replaceAll('import.meta.client', 'true')
            .replaceAll('import.meta.server', 'false'),
          map: null,
        }
      },
    },
    vue(),
    // The suite's components import Nuxt UI's own single-file components
    // directly (`@nuxt/ui/components/Modal.vue`), and those files import the
    // build-time virtuals `#build/ui/<component>` and `#imports`. In a
    // consuming app Nuxt UI's Nuxt module supplies both; outside Nuxt its Vite
    // plugin does, which is why it is here. Without it a mount test cannot
    // render a real `UModal`, and an a11y assertion against a stub proves
    // nothing.
    //
    // `autoImport`/`components` are off deliberately: every import in this
    // package is explicit, and leaving them on makes the plugin write
    // `auto-imports.d.ts` / `components.d.ts` into the package on every test
    // run.
    //
    // The cast is a workspace resolution artefact, not a type error in the
    // plugin: `@nuxt/ui` resolves its own `vite` copy (keyed on a different
    // `@types/node` patch) from the one `vitest/config` types against, so the
    // two structurally identical `Plugin` types are nominally unrelated.
    ui({ autoImport: false, components: false }) as never,
  ],
  test: {
    // Node by default — the SSR proof has to run without a DOM. Mount tests
    // opt into happy-dom with a `// @vitest-environment happy-dom` directive,
    // the same way narduk-charts' suites do.
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Fails a test on any `[Vue warn]` and gives every mount a router
    // (narduk-libs#1403). The file says why.
    setupFiles: ['./test/support/setup.ts'],
  },
})
