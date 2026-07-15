# Cloudflare account and domain cutover runbook

This procedure begins only after the application is independently owned and
proven in its source account. The preceding application migration, its evidence
manifest, and the Been Sober For exemplar are documented in
[`template-decoupling/`](template-decoupling/README.md).

This is the canonical procedure for moving a Narduk application between
Cloudflare accounts without creating a new fleet control plane. The app remains
independently owned, production deploys remain app-local, and this document is
the reusable operator contract. Each migration must keep a separate, filled
execution record in the application repository.

The procedure favors data integrity over a strict outage target. A move may be
advertised as low-downtime only after the target Worker, copied data, target
zone, and rollback path have all been rehearsed.

## 1. Required access and safety boundaries

Before changing remote state, record the source and target account names and IDs
and prove the selected credentials against both accounts. Use temporary,
least-privilege operator credentials for:

- Workers scripts, versions, Builds, Custom Domains, and secrets;
- D1, KV, R2, Queues, schedules, and analytics used by the application;
- zone DNS, SSL/TLS, WAF, redirects, caching, and rules;
- Registrar transfer initiation in the source account and acceptance in the
  target account.

Store credentials in the approved secret manager. Logs and evidence records
contain only secret names, never values. Revoke narrow phase credentials as soon
as their proof is complete, then perform a second credential review at the
retention gate. Confirm target-account email verification, billing, and the
operator's ability to accept the Registrar transfer before the maintenance
window.

Do not mutate the source deployment, DNS, or registration while building the
target foundation. Do not reuse staging resources as production resources.

## 2. Inventory and resource mapping

Create a source-to-target table before provisioning anything:

| Capability            | Source name and ID | Target name and ID | Transfer treatment                                            | Evidence |
| --------------------- | ------------------ | ------------------ | ------------------------------------------------------------- | -------- |
| Worker and versions   |                    |                    | Deploy the same reviewed commit                               |          |
| Workers Build         |                    |                    | Recreate repository, branch, root, variables, and secrets     |          |
| D1                    |                    |                    | Export and import into a fresh target database                |          |
| KV                    |                    |                    | Classify as cache or durable data; recreate or bulk-copy      |          |
| R2                    |                    |                    | Pre-copy, final delta, then manifest comparison               |          |
| Queues and DLQs       |                    |                    | Recreate paused; enable exactly one consumer after cutover    |          |
| Cron schedules        |                    |                    | Recreate disabled; enable exactly one scheduler after cutover |          |
| Rate limits           |                    |                    | Allocate new account-scoped namespace IDs                     |          |
| Worker secrets        |                    |                    | Recreate from the secret manager                              |          |
| Routes and domains    |                    |                    | Activate only after the target zone is active                 |          |
| DNS and zone settings |                    |                    | Export, manually reproduce, and review                        |          |
| Registrar             |                    |                    | Initiate in source and accept in target                       |          |

Also record the current deployed commit/build marker, production URLs, binding
names, non-secret variables, secret names, D1 schema and ledgers, D1 table
counts, KV key count, R2 object manifest, queue depth, schedules, DNS record
export, DNSSEC state, certificate state, and application-specific live proofs.

## 3. Application readiness

Ship infrastructure-independent application changes through the source account
first. The source production release must use immutable package versions, a
frozen lockfile, app-owned CI, app-owned Worker configuration, and the stable
package/app migration journal.

Every application must expose a reversible read-only maintenance control. In
read-only mode:

- health and public read routes remain available;
- mutation, upload, account-provisioning, session-creation, and destructive
  paths fail with HTTP `503` and `Retry-After`;
- health/status output reports maintenance state without exposing secrets.

Prove the maintenance release on the source production account before any
account or zone move.

## 4. Target foundation and rehearsal

1. Provision fresh production Worker dependencies in the target account.
2. Recreate non-secret variables, bindings, rate-limit IDs, and secret names.
3. Configure Workers Builds with the exact repository, production branch,
   project root, package-registry credential, and app-owned build/deploy
   commands.
4. Deploy the reviewed production candidate to a target `workers.dev` hostname
   without Custom Domains.
5. Export source D1 and import it into a disposable rehearsal database. Inspect
   actual tables, columns, indexes, and legacy ledgers before adopting entries.
6. Apply migrations twice and require an empty second run. Compare schemas,
   indexes, ledgers, and all relevant table counts.
7. Pre-copy R2 with separate source and target credentials. Compare every key,
   byte size, and a trustworthy checksum or ETag manifest.
8. Inventory KV. Recreate empty cache namespaces; bulk-copy durable keys and
   compare key counts and sampled values.
9. Recreate queues and schedules disabled. Rehearse delivery, retry, DLQ, and
   deduplication before enabling them.
10. Exercise health, public pages, authentication, callbacks, mutations,
    uploads, scheduled/manual operations, and application-specific clients
    against the target Worker.

The rehearsal must use production-shaped data without double-writing to either
production system. Remote databases are never reset. Corrective database work
uses forward migrations.

## 5. Zone preparation

Add the domain to the target account and select its plan. Export the source DNS
records and manually reproduce DNS plus SSL/TLS, WAF, redirects, caching, and
other zone rules. Review both the export and the target configuration. Keep
DNSSEC disabled until the inter-account move is complete.

Prepare certificates as far as Cloudflare permits, but do not assume a pending
zone can accept Worker Custom Domains. Certificate and zone activation time is
the largest unpredictable part of the maintenance window.

## 6. Pre-freeze go/no-go gate

The cutover operator signs off every item:

- [ ] Target Worker is deployed at the intended commit and passes live proof.
- [ ] Target production D1 is fresh and ready for the final import.
- [ ] D1 rehearsal, legacy adoption, and empty second run passed.
- [ ] R2 pre-copy and manifest comparison passed.
- [ ] KV treatment is recorded and verified.
- [ ] Queues and schedules, if any, are disabled in the target.
- [ ] Target secrets and Workers Build variables are present.
- [ ] DNS and zone settings have an independent review.
- [ ] Source production is healthy and maintenance mode is proven.
- [ ] Source and target Registrar sessions are open and acceptance is ready.
- [ ] Recovery state, evidence directory, operator, and rollback decision time
      are recorded.

## 7. Cutover sequence

1. Record the maintenance-window start and enable source read-only mode.
2. Prove writes are blocked and reads remain healthy.
3. Capture D1 recovery state, schema, ledgers, counts, and the final SQL export;
   hash the export.
4. Run the final R2 delta and compare manifests. Copy durable KV deltas if
   applicable.
5. Import into the untouched target D1, run adoption/migrations twice, and
   reconcile schema, indexes, ledgers, and counts.
6. Prove the target Worker on `workers.dev` against the final data.
7. Initiate the Registrar move from the source account and immediately accept it
   in the target account.
8. Wait for the target zone to become active, attach Custom Domains, and wait
   for valid HTTPS.
9. Prove the deployed commit, public routes, authentication, callbacks,
   mutations, data reads, uploads, assets, and every app-specific client.
10. Enable exactly one queue consumer and scheduler owner when applicable.
11. Disable maintenance mode and record the outage end.

### Proven activation refinement

BSF established a safer split between candidate upload and activation:

1. Upload the reviewed candidate as a non-activating Worker version. Record the
   build ID, trigger ID, commands, prior active version, and `activated: false`.
2. Prove the upload did not change target production D1 or live traffic. An
   expected schema-health failure is acceptable only when target D1 is
   intentionally empty and that condition is recorded.
3. After the final import, activate a read-only target version and prove data,
   routes, maintenance blocking, Custom Domains, and HTTPS.
4. Activate a distinct writes-enabled version at 100% traffic, then prove the
   final build marker and maintenance-off state.
5. Restore Workers Builds to the default branch and canonical production
   build/deploy commands. Remove temporary configs and scan functional files for
   source-account IDs and cutover commands.

The Workers Builds REST API requires a user-scoped API token; the build token
selected by the trigger is a separate credential. Record both by safe identifier
and permission class without recording either value.

Cloudflare's automatically created Worker upload token does not necessarily
include D1 edit. If the production deploy command runs remote migrations, use a
separate app-scoped target-account token with the required Worker and D1 access,
store it as a masked build variable, export it to Wrangler only for
migration/deploy, and fail closed when it is absent. Prove this token with a
safe D1 query and Worker read before selecting it.

Authentication, profile mutation, and upload/retrieval are separate gates. App
launch or user-attested login must not be represented as successful
profile/upload proof. Record each result as machine-captured, operator-attested,
or unproven.

## 8. Rollback boundaries

- Before the Registrar move, abort by leaving traffic and writes on the source
  account.
- After the Registrar move but before target writes open, repair or redeploy in
  the target account. Do not assume the source account can serve the moved zone.
- After target writes open, never route users to stale source data. Roll back
  code within the target account, or perform another controlled write freeze and
  data reconciliation.
- Database rollback is forward-only. Preserve the cutover export and recovery
  state.

Set a decision point before the advertised outage budget expires. Missing proof
is a no-go; it is not permission to skip reconciliation.

## 9. Retention and closeout

Keep source Worker versions, D1, KV, R2, deployment history, and backups intact
for 30 days. Disable source mutation paths, triggers, and credentials after
target proof, but do not delete data during the retention window.

The retention clock starts when target writes reopen. Record that timestamp,
source trigger/mutation disablement, and any immediately revoked phase token; do
not leave them implicit until day 30.

After 30 days, confirm there is no source traffic or write activity, capture
final checksums, revoke temporary credentials, remove retained source
infrastructure, and mark the fleet-ledger entry complete.

## Cloudflare references

- [D1 import and export](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
- [R2 migration strategies](https://developers.cloudflare.com/r2/data-migration/migration-strategies/)
- [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/)
- [Move a domain between Cloudflare accounts](https://developers.cloudflare.com/fundamentals/manage-domains/move-domain/)
- [Registrar inter-account transfer](https://developers.cloudflare.com/registrar/account-options/inter-account-transfer/)

## Execution evidence template

```text
Application:
Operator:
Source account ID:
Target account ID:
Source commit/build marker:
Target commit/build marker:
Migration PR and exact package pins:
Workers Build ID:
Workers Build trigger ID, branch, commands, and credential classes:
Candidate version, prior active version, and activated=false proof:
Source-to-target resource mapping:
Secret and build-variable names:
DNS export checksum and target review:
D1 recovery reference:
D1 export checksum:
D1 schema, index, ledger, and count comparison:
Empty second migration run:
KV inventory and treatment:
R2 manifest comparison:
Queue/schedule ownership proof:
Registrar transfer evidence:
Zone lifecycle, nameservers, DNSSEC/DS, certificate IDs, and Custom Domain evidence:
Read-only version and writes-enabled version/traffic evidence:
Web/API/client proof:
Machine proof vs operator attestation vs unproven product flows:
Maintenance start:
Maintenance end:
Go/no-go decision, basis, and timestamp-captured flag:
Rollback decision and boundary:
Retention start and source-trigger/mutation disablement:
30-day retention end:
Operator sign-off:
```
