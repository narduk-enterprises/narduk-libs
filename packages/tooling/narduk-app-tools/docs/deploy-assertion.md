# Post-merge deploy assertion

A merge is not a deploy. When the deploy runs somewhere CI does not watch, a
merged commit can fail to ship and nothing turns red. riverstatus#182 is the
worked case (narduk-libs#597):

- CI was green, and the PR merged.
- The production Workers Build then failed in its deploy command, and production
  kept serving the previous commit.
- Nothing reported the failure. It was found by reading the served bundle.

The assertion is one fact: **the commit just merged is the commit production
serves**, read from the live `x-build-version` header, within a bounded wait.
The build having _started_ does not count.

## Which apps need it

**narduk-v1 apps already have it.** GitHub promotes there, after CI:

- `narduk-app deploy versions-promote --sha "$VERIFIED_SHA"` exits `3`
  (`versionNotFound`) when no uploaded version carries that commit, so a failed
  Workers Build turns the promote run red.
- The promote job's live proof, `narduk-app verify --live ... --expect-sha`,
  then reads the served build. See the generated `docs/deployment.md`,
  "Promotion, live proof and rollback".

**Apps whose Workers Build deploys directly** (a `deploy` command in the Workers
Builds connection, with no promote workflow) have no such run. riverstatus is
one. Those apps add the job below. Moving to narduk-v1 removes the need for it.

## The job

Copy it to `.github/workflows/deploy-assertion.yml` and change the three marked
values. It holds no Cloudflare credential. It reads the public origin and this
repository's check runs.

```yaml
name: Deploy assertion
on:
  push:
    branches: [main] # CHANGE: the production branch
# A newer merge supersedes this one: its own assertion covers this commit too,
# and reading this SHA after it deploys would fail for the wrong reason.
concurrency:
  group: deploy-assertion
  cancel-in-progress: true
permissions:
  contents: read
  checks: read
jobs:
  shipped:
    runs-on: ubuntu-24.04 # CHANGE: the app's manifest-routed class; a private repo is self-hosted
    timeout-minutes: 25
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      # ... the app's existing pnpm/node setup and frozen install ...
      - name: The merged commit is the one serving production
        # Retries the whole proof (build header, /api/health, smoke route) every
        # 15 s for up to 20 minutes, which covers a Workers Build. A build that
        # never deploys ends in exit 3, build version mismatch.
        run: >-
          pnpm exec narduk-app verify --live https://example.com --expect-sha
          "$GITHUB_SHA" --attempts 80 --interval-seconds 15 --deadline-ms
          1200000
        # CHANGE: https://example.com is the app's primary domain
      - name: Name the Workers Build behind a failure
        if: failure()
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          gh api "repos/$GITHUB_REPOSITORY/commits/$GITHUB_SHA/check-runs" \
            --jq '.check_runs[] | select((.external_id // "") != "")
              | "\(.name): \(.conclusion // .status) build=\(.external_id) \(.details_url)"'
```

On failure, the log names the Workers Build UUID (a Workers Builds check run's
`external_id`), so the build log is one command away.

## Reading the result

| exit | meaning                                                                                                                      |
| ---- | ---------------------------------------------------------------------------------------------------------------------------- |
| 0    | production serves this commit, with a healthy `/api/health` and a 2xx smoke route                                            |
| 2    | the origin could not be read at all                                                                                          |
| 3    | production still serves a different build after the whole wait. The deploy failed or never ran: read the named Workers Build |
| 4, 5 | the commit shipped, and its health check or smoke route is failing                                                           |
| 6    | a different origin answered. See `verify --live` in the README                                                               |

The whole wait is bounded and every attempt is logged. A run cancelled by a
newer merge is not a failure: the newer run carries the assertion.
