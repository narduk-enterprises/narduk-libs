/** Minimum publication age for the maintainer pin refresh. */
export const DEPENDENCY_COOLDOWN_DAYS = 14

/** A nonzero Dependabot cooldown also gates required transitive pins (#1707, #737). */
export const DEPENDABOT_COOLDOWN_DAYS = 0

/** Deliberate toolchain ceilings apply equally to Dependabot and pin refreshes. */
export const DEPENDENCY_UPDATE_LIMITS = {
  typescript: { version: '6.1.0', inclusive: false },
  '@types/node': { version: '25.0.0', inclusive: false },
  // Keep the browser runner and its installed browser image in step.
  '@playwright/test': { version: '1.61.1', inclusive: true },
} as const
