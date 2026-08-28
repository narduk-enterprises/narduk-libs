import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The callout component is mounted for real, so its SFC has to be compiled.
  plugins: [vue()],
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.test.ts'],
  },
})
