import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The suite's components are mounted and server-rendered for real, so their
  // single-file components have to be compiled.
  plugins: [vue()],
  test: {
    // `node` is the default on purpose: the SSR suites prove the components
    // render in a runtime with no `document` (the Workers preset has none).
    // A mount suite opts INTO happy-dom with a `@vitest-environment` directive
    // at the top of its own file.
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
