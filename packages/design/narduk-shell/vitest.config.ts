import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  test: {
    // Default environment stays plain Node (the SSR test relies on this: no
    // `document`/`window`). Component mount tests opt into `happy-dom` with
    // a `// @vitest-environment happy-dom` file directive, matching
    // packages/design/narduk-charts.
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
