import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Several adapter tests boot a real host and serve a request. Alone they
    // take ~15 ms; under a whole-monorepo run they have timed out at the 5 s
    // default (narduk-libs#605). The budget only has to catch a hang, so it is
    // generous rather than tight. No retry: that would hide a real hang.
    testTimeout: 20_000,
  },
})
