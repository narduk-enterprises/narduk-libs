import vue from '@vitejs/plugin-vue'
import ui from '@nuxt/ui/vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
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
  },
})
