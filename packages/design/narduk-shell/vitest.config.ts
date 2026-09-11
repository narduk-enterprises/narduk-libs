import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The design cards under src/design-cards are single-file components, so the
  // suite compiles SFCs. A component item that adds a mount test under
  // happy-dom opts in with a per-file environment directive; see
  // packages/design/narduk-charts for that pattern.
  plugins: [vue()],
  test: {
    // Cards are proven by a SERVER render (no document, no window), which is
    // how design-system-build's `nuxt generate` consumes them.
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
