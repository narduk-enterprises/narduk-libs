// @ts-check
/**
 * `monorepo` capability pack — registered, contributes no ESLint rules.
 *
 * The intended checks (`workspace:` protocol for internal dependencies, pnpm
 * catalog references for shared toolchain deps) target `package.json` files.
 * Linting JSON through flat config needs a JSON language plugin, which is a
 * non-trivial dependency for one niche check, so those checks do not ship as
 * ESLint rules.
 *
 * The pack name stays registered so a consumer listing `'monorepo'` in
 * `capabilityPacks` does not error.
 */

/** @type {import('eslint').Linter.Config[]} */
const monorepoConfigs = []

export { monorepoConfigs }
export default monorepoConfigs
