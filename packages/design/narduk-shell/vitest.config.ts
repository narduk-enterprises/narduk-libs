import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Design cards under src/design-cards are SFCs, so the suite compiles them.
  // Item 9's mount tests need the same plugin; keep this identical to those
  // lanes so the shared import and `plugins: [vue()]` line merge cleanly.
  plugins: [vue()],
  test: {
    // node is the default environment (SSR tests rely on it running with no
    // DOM); mount tests opt into happy-dom per file with a
    // `// @vitest-environment happy-dom` directive, the narduk-mapkit-nuxt
    // pattern.
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
