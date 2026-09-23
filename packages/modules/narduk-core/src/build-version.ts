/**
 * The commit a build stamps into `x-build-version`, first match wins.
 *
 * Each builder names the commit in its own variable. A Workers Build sets
 * `WORKERS_CI_COMMIT_SHA`, which narduk-app-tools also reads for the version
 * tag, so the two halves of one deploy learn the commit from the same place.
 * `git rev-parse` stays last, for local builds, because a builder's checkout is
 * not promised to carry `.git` (narduk-libs#584).
 */
export function resolveBuildVersion(
  env: Record<string, string | undefined>,
  readGitSha: () => string,
  appVersion: string,
): string {
  return (
    env.BUILD_VERSION ||
    env.GITHUB_SHA?.slice(0, 12) ||
    env.CF_PAGES_COMMIT_SHA?.slice(0, 12) ||
    env.WORKERS_CI_COMMIT_SHA?.slice(0, 12) ||
    readGitSha() ||
    appVersion
  )
}
