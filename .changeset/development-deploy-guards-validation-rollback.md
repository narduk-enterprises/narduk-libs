---
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': patch
---

development deploy: receipts carry per-step timings (`steps`, `totalSeconds`)
and print the slowest steps. Every verified deploy queues full validation of the
deployed commit (a capture commit for a dirty tree) to a detached worker that
pushes `narduk-validation/<sha>/<uuid>`; one worker per repository, the newest
SHA wins, superseded automatic runs are cancelled and their branches deleted,
and a push that fails twice shows as `NOT PUSHED` in `development status`.
deploy:dev refuses a capture that changes protected paths
(`deployment.development.protectedPaths`, migration directories, Wrangler
binding or Durable Object changes) unless run with `--gated`, and refuses after
a `red-main` issue has been open for 24 h unless `--red-main-fix <issue>` names
it. New `development rollback --to <known-good build>`; automatic rollback on
failed proof is off unless `deployment.development.rollback` declares
`automatic: true` with a `rehearsalRef`, and it pages instead of crossing a
Durable Object, binding or non-expand-only migration change.
`exec --operation migration` applies the expand-only rule (12.9): a drop or
rename refuses unless it is a declared contract migration already landed on the
production branch. Files already on the production branch before the hold took
effect (recorded as `migrationBaseline`; `enter --refresh` recovers it for an
existing enrollment from the checkout's reflog, never from the current ref) are
not re-judged; files that landed during the hold always are.
