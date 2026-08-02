// @ts-check
/**
 * `seo` capability pack — registered, contributes no rules in v2.
 *
 * v1's three SEO rules (`require-use-seo-on-pages`,
 * `prefer-use-seo-over-bare-meta`, `require-schema-on-pages`) all took a DROP
 * verdict in the deep review: each gated on `filename.includes('/app/pages/')`,
 * so every one of them was dead under the relative filenames `eslint .`
 * produces, and none had a maintained third-party equivalent worth wiring.
 *
 * The pack name stays registered so a consumer listing `'seo'` in
 * `capabilityPacks` keeps working across the v1 → v2 bump, exactly as v1's
 * `monorepo` pack did. `createAppLintConfig({ seoMode })` still accepts its
 * argument and is documented as a no-op in v2.
 */

/** @type {import('eslint').Linter.Config[]} */
const seoConfigs = []

export { seoConfigs }
export default seoConfigs
