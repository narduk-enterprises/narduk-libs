# Persistent local development deployments — paused implementation

Status: **paused at Logan's request on 2026-09-22**. This is an in-progress
implementation checkpoint, not an operational release. Do not merge, publish,
enroll an application, or continue implementation until Logan resumes the work.

The authorized plan is company-hq#781. Estimated progress at pause is roughly
25% implemented and 0% rolled out. The public lifecycle commands are not wired.
Existing app behavior remains unchanged unless and until deliberately enrolled.

## Implemented in this branch

- Optional `deployment.development` capability in the existing Zod deployment
  contract; no separate app manifest and no permission granted by configuration.
- Private atomic host state, deterministic account/Worker locks shared across
  clones/worktrees, and hotfix participation without removing incident or clean
  commit requirements.
- Frozen filesystem source capture of tracked changes, deletions and unignored
  untracked source; private reusable build workspace and dependency fingerprint.
- Phase-isolated child environments, declared vault input resolution, production
  signing-input checks, literal argument arrays and bounded child processes.
- Additive exact `verify --live --expect-build-id` and overall proof deadline,
  retaining existing SHA-prefix behavior.
- Initial Cloudflare and GitHub management adapters, including workflow setting
  snapshots, scoped holds/restoration, trigger snapshots/retirement/restoration,
  explicit validation requests and candidate evidence checks. These adapters
  compile but still need behavioral tests and lifecycle integration.
- App-tools minor Changeset and the required generator patch Changeset entry.

## Provider acceptance and changed assumptions

### Cloudflare

The disposable API rejected `branch_excludes: ["*"]`; preview triggers also
rejected a nonmatching include. Logan explicitly approved **trigger retirement
and restoration** instead of the original no-delete/recreate rule.

Disposable production and preview triggers were saved, retired and recreated,
with the repository connection preserved and plain/protected build inputs
restored. Held pushes produced no new build IDs during the observation window;
restored production and preview builds completed successfully. Temporary
triggers and token registrations were removed and temporary tokens revoked. This
demonstrates the provider protocol, not the unintegrated TypeScript CLI.

Detailed evidence is in the company-hq acceptance record and private local
`~/.local/state/narduk-development-acceptance-20260922/retirement-proof.json`.
No credential values are stored in receipts or committed evidence.

### GitHub

Disabling the disposable automatic workflow stopped ordinary push/PR work; a
historical rerun returned HTTP 403 without allocating another job. A separate
control workflow remained available. The first-push Actions hold was also
exercised. Schedule quietness was observed, but positive delivery of a scheduled
event during the hold was not independently established.

**`workflow_dispatch` cannot supply required PR checks**, even with a successful
full run on the correct head. GitHub documents this event restriction. The
implementation now uses an explicitly pushed request ref:
`narduk-validation/<full-sha>/<request-id>`. Only that reserved ref triggers
full validation; ordinary application pushes remain quiet. Every checkout checks
the ref-encoded SHA, push event SHA and actual revision. The public
`development validate` command will own this occasional request.

Live proof on the disposable application:

- Dispatch full validation succeeded but left the PR blocked:
  https://github.com/narduk-enterprises/development-deploy-proof/actions/runs/35699952464
- A moved dispatch branch correctly failed candidate guards and `ci / Required`:
  https://github.com/narduk-enterprises/development-deploy-proof/actions/runs/35700663861
- Explicit request-ref validation passed the real full suite, including browser
  coverage, and PR #2 became `CLEAN` without changing branch protection:
  https://github.com/narduk-enterprises/development-deploy-proof/actions/runs/35701553553
- Exact tested application SHA: `52049b7afdc42aec7b3dbb19c81595e1cfe13884`.
- Required context stayed `ci / Required`, GitHub Actions app ID `15368`.
- Shared workflow implementation:
  https://github.com/narduk-enterprises/workflows/pull/141 at
  `dd26187ca6f9ae7dd7884b85951c77f7e55daea1`, now draft and unmerged.

The fixture was admitted to existing manifest-controlled CI and isolated browser
runner groups through merged fleet PRs #485 and #486. No hosts, capacity or
production routes were changed.

## Validation at pause

Foundation commit `9871679f66994cb6ae15af6ccfb936815134e102` passed package
build, typecheck, lint, package validation/pack dry-run, and 721 unit tests (one
skipped). Current checkpoint passes package typecheck, build and lint (zero
errors; three warnings). The new provider/GitHub adapters are **not behaviorally
tested** yet. Repository-wide quality, external packed-consumer installation and
release validation have not been completed. No package version was changed or
published.

## Resume order and outstanding work

1. Review this checkpoint and subsequent RFC comments. Incorporate the
   successful request-ref evidence and Cloudflare amendment into the final
   operating model.
2. Test the management adapters against realistic provider responses and failure
   boundaries. Verify the Worker version-detail shape on the disposable target.
   Refine per-trigger protected-variable selectors when the same variable name
   has different production/preview sources. Bound active-run inventory without
   assuming a short repository history, and prove interrupted transitions.
3. Wire lifecycle state/journals and CLI commands: entry, status, target
   ownership, ordered check/capture/build/schema/upload/promote/proof
   transaction, receipts, whole-set pinning, authorized operations, handoff and
   two-stage exit. No CLI operation should call the new provider helpers without
   durable intent and the same target lock. Do not claim the adapters alone
   implement a transaction.
4. Finish migration commit/checksum retention and guards, guarded
   secret-delivery lock integration, private-app proof, retention, unknown-state
   inspection, explicit recovery and multi-component partial-failure tests.
5. Complete disposable shipped-CLI lifecycle, first-push and return-to-normal
   acceptance before touching retained resources. Include failed live proof,
   interruption, dirty source, contributor integration and historical writers.
6. Complete normal shared-repository checks/review, release app-tools/workflows,
   update generator pins and verify the packed CLI from an external consumer.
7. Adopt and enroll Farm first: target-driven `prd` configuration,
   emitted-artifact assertion including wrong-environment regression, local
   gate, writer inventory, fresh read-only schema checks and real useful
   dirty/committed iterations. Preserve the observed `PROMOTE_ENABLED=false`
   normal setting.
8. Enroll Portal only after verifying its real Worker/Wrangler identities and
   coordinating immutable refresh-writer revision with the approved READ_MODEL
   contract. Keep data fresh; preserve durable rows and separate auth
   migrations.
9. Ship the shared operational runbook, generator onboarding, agent procedures
   and actual operational session handoff with released versions and live
   receipts.

No intentional failure injection against Farm's retained database. No automatic
background CI, arbitrary deployment-count validation, fabricated platform
provenance, fallback to hotfix, skipped-check success substitute or weakening of
required checks. No independent production path may be disabled.

## Preserved local work

- App-tools: `/Users/narduk/code-worktrees/narduk-libs/development-deploy`,
  branch `codex/development-deploy`.
- Workflows: `/Users/narduk/code-worktrees/workflows/development-validation`,
  branch `codex/development-validation`.
- RFC: `/Users/narduk/code-worktrees/company-hq/active-development-rfc`, branch
  `codex/active-development-rfc`; company-hq#781 remains draft.
- Disposable app:
  `/Users/narduk/code/narduk-enterprises/development-deploy-proof`; PR #2
  remains open and unmerged. Automatic workflow is held, explicit validation and
  the independent control remain enabled. No Cloudflare build triggers remain.
- Private provider evidence:
  `~/.local/state/narduk-development-acceptance-20260922`.
- Farm and Portal have not been modified or enrolled by this implementation.
- Preserve the unrelated MapKit generated map modification in the primary
  narduk-libs checkout. Keep all task worktrees and recovery evidence for
  resume.

<!-- enforcement: none yet; this file is a checkpoint, not an activation record -->
