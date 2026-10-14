/** Minimum publication age for the maintainer pin refresh. */
export const DEPENDENCY_COOLDOWN_DAYS = 14

/**
 * One day, matching the generated `minimumReleaseAge: 1440`: Dependabot must not propose a
 * version pnpm then refuses (ERR_PNPM_NO_MATURE_MATCHING_VERSION). A longer window also gates
 * required transitive pins (#1707, #737).
 */
export const DEPENDABOT_COOLDOWN_DAYS = 1

/** Deliberate toolchain ceilings apply equally to Dependabot and pin refreshes. */
export const DEPENDENCY_UPDATE_LIMITS = {
  typescript: { version: '6.1.0', inclusive: false },
  '@types/node': { version: '25.0.0', inclusive: false },
  // Keep the browser runner and its installed browser image in step.
  '@playwright/test': { version: '1.61.1', inclusive: true },
} as const
