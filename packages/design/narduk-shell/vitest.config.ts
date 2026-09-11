import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // No component mounts yet (the registry is empty), so the suite runs in
    // plain Node. A later backlog item that adds an SFC adds the Vue plugin
    // and the SSR/mount pattern from packages/design/narduk-charts.
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
