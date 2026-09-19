---
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': patch
---

Add a reviewed D1 baseline process: immutable schema/ledger capture, full-schema
comparison, explicit metadata-only registration for untracked schemas, and a
shared disposable-local cutover proof. Preserve historical fixtures across
package upgrades and stop rechecking superseded legacy schema probes after
stable checksum adoption. Document app-owned review, data-proof limits and
migration-before-promotion onboarding.
