---
'@narduk-enterprises/create-narduk-app': patch
---

Scaffold the estate E2E flake policy into new apps, so a flaky test cannot
report green from the first commit.

The generated `playwright.config.ts` now sets `retries` to 1 in CI (was 2) and
enables `failOnFlakyTests` for push/default-branch runs: a test that fails and
then passes on its retry FAILS the merge rather than being reported as
flaky-but-green. Pull requests keep the single retry as a cheap defence against
browser-pool noise — the merge to the default branch is where the suite has to
be believed. `trace: 'on-first-retry'` is unchanged and is now the trace on the
one retry that exists.

The tier is resolved from `GITHUB_EVENT_NAME`, a GitHub Actions default
environment variable exported into every step, so a reusable workflow does not
have to forward it. The branch is fail-closed: anything not recognisably a
pull-request event, including an unset variable, takes the strict path, so a
missing variable can only make the gate harsher, never green. The generated
config prints the policy it resolved (`[e2e] flake policy: ...`) once per run,
from the runner process only, so which policy a run used is readable in the log
instead of inferred.

The scaffolded `docs/e2e-testing.md` gains a matching **Flake policy** section
and a **Quarantine convention**:
`test.fixme(<condition>, '<repo>#<issue> -- <YYYY-MM-DD> -- <owner>')`, why it
is `fixme` rather than `skip`, and how a test leaves quarantine. A scaffold that
ships `failOnFlakyTests` without telling anyone how to quarantine a flake
teaches exactly the retry-hides-it habit the policy exists to end.

`@narduk-enterprises/narduk-testkit` exports fixtures, contracts and UI-quality
helpers but no Playwright config preset — there is no `defineConfig` in its
source and no `./playwright/config` export — so the generator's scaffold is the
only place in this repository that can own this policy today. Existing apps
carry it in their own `playwright.config.ts`.
