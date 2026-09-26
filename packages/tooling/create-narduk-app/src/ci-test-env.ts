/**
 * Committed, test-only Nuxt values. CI and Playwright need a non-empty
 * `NUXT_OG_IMAGE_SECRET` for a real `nuxt build` when runtime OG is on
 * (narduk-seo fails closed). These are not production secrets and must
 * never be referenced as `${{ secrets.* }}` — a fresh repo has none.
 */
export const CI_TEST_ONLY_NUXT_OG_IMAGE_SECRET = 'narduk-test-only-og-image-secret-000000'
export const CI_TEST_ONLY_NUXT_SESSION_PASSWORD = 'narduk-test-only-session-password-000000'

/**
 * Prefix of the generated `build:ci` script. Workers Builds (`WORKERS_CI` /
 * `WORKERS_CI_BRANCH`) and a local `wrangler deploy`
 * (`NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY`) are the two ways a build reaches a
 * live Worker. `build:ci` injects the public placeholders above and must
 * refuse those contexts. `NARDUK_CLOUDFLARE_BUILD` and `NARDUK_DEPLOY_TARGET`
 * are not signals: generated `nuxt.config.ts` sets the target itself, and
 * GitHub Actions `build:ci` is not a deploy.
 *
 * Pasted into manifest.ts as a literal. That file cannot import this module.
 */
export const BUILD_CI_REFUSES_DEPLOYED_BUILD =
  "node --eval 'if((process.env.WORKERS_CI||``).trim()||(process.env.WORKERS_CI_BRANCH||``).trim()||(process.env.NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY||``).trim()){console.error(`build:ci injects public test-only secrets and cannot run for a deployed build`);process.exit(1)}'"

/**
 * Filename `build:ci` writes into the Nitro output directory. narduk-app-tools
 * refuses to publish an `.output` that contains this file. A later `cf:build`
 * replaces the directory and drops it.
 */
export const BUILD_CI_OUTPUT_MARKER = '.narduk-build-ci'

/**
 * Suffix of `build:ci`, after a successful `pnpm run build`. `layout` is the
 * one `upgrade` already infers: scaffolds are always `apps-web`. The apps-web
 * string is pasted into manifest.ts, which cannot import this module.
 */
export function buildCiMarksOutput(layout: 'apps-web' | 'root'): string {
  const dir = layout === 'root' ? '`.output`' : 'path.join(`apps`,`web`,`.output`)'
  return (
    "node --eval 'const fs=require(`node:fs`);const path=require(`node:path`);const dir=" +
    dir +
    ';fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,`' +
    BUILD_CI_OUTPUT_MARKER +
    "`),`build:ci\\n`)'"
  )
}

/** apps/web scaffolds and upgrades. Root checkouts rewrite this in checkout-facts.ts. */
export const BUILD_CI_MARKS_OUTPUT = buildCiMarksOutput('apps-web')
