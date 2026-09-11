import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Registry SFCs need the Vue plugin so mount tests can compile them.
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
