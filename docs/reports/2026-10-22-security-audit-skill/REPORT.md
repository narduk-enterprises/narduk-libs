# Security audit report — narduk-libs

Written 2026-10-22 16:52 CT (21:52 UTC). Records live in `findings.json`. This
prose does not add a verdict.

## Run

| Item          | Value                                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------- |
| Profile       | `deep`, partial                                                                                                 |
| Source        | `212392aa61537e5fd7ccce842e5a17f2e832e3d6` on `main`, clean tree                                                |
| Target        | `narduk-enterprises/narduk-libs`, scope `packages`, `scripts`, `.github`                                        |
| Skill         | `cloudflare/security-audit-skill` commit `c1c8a8c`, `skills/security-audit`                                     |
| Budget        | none set. Hunt plan was 6 lanes. Validation added 3 phase-3 verifiers and 2 phase-5 verifiers. 11 agents spent. |
| Execution     | sandboxed source and local checks only. Local execution blocked. Target code was not run.                       |
| Prior ledgers | none                                                                                                            |
| Output        | `~/security-audit-skill/narduk-libs/run-1`                                                                      |
| Target tree   | unchanged                                                                                                       |

This is a partial deep pass. The deep profile asks for every material surface,
boundary, attack class, and lifecycle. A faithful expansion of this monorepo
meets the ledger's 5 MiB cap before the hunt starts. The run seeded 34 priority
units plus one `not_applicable` memory-safety unit. Wave 2 was not launched. A
green ledger is not complete coverage, and zero confirmed records are not a
clean bill of health.

The Mac session cannot prove one OS sandbox that denies external network, starts
from an empty allowlisted environment, mounts the target and toolchain
read-only, confines writes to the agent scratch directory, and enforces explicit
CPU, memory, process, file, disk, and wall-clock limits. `confirmed` needs a
bounded observed result, so it was unreachable. Candidates that need a runtime
fact stayed `needs_validation` or were rejected from source.

Hunters and verifiers were scoped Sonnet 5.5. They read the skill's schema and
companion files from disk at commit `c1c8a8c` instead of receiving every block
pasted into the prompt. That deviation is also in `skill-review.md`. The parent
wrote the shared ledger, findings, and this report. Hunters did not.

The phase-2 critic was the parent folding the six hunter returns. It was not a
distinct critic agent, and the deep profile's final-clean critic did not run as
a distinct agent. The phase-3 verifiers (`v3-csrf`, `v3-session`, `v3-ssrf`) did
not hunt. The phase-5 verifiers (`v5-session`, `v5-ssrf`) did not hunt and did
not perform phase 3. Both phase-5 verifiers returned `verified` for the retained
`needs_validation` records. `validate-findings.cjs` and
`validate-coverage-ledger.cjs` both PASS.

No same-source confirmation was carried. Nothing was revalidated from an earlier
run.

### Deferred and out of scope

- `out_of_scope`: `@cloudflare/workers-oauth-provider` registration and consent
  body. That package is not in this checkout and was not fetched.
- `out_of_scope`: called `nuxt-cloudflare.yml` on `pull_request`. The reusable
  workflow body is not in this checkout and was not fetched.
- `out_of_scope`: called `node-library.yml` and `red-main-listener.yml` at
  `8192a81c8f1b3de36f1141b60fcd8de1c539772e`. Those bodies are not in this
  checkout and were not fetched.
- `deferred`: admin system-prompt writes and tenant scope in `narduk-ai`.
  `defineAdminMutation` resolves an admin and does not add a tenant predicate.
  Whether those writes claim a tenant boundary was not a hunted unit. This is a
  coverage gap, not a finding.
- `not_applicable`: memory safety. The tree has no C, C++, unsafe Rust, kernel,
  JIT, or binary-loader source.

Folded into units that were already reviewed, so they were not opened again: the
auth package's CSRF trailing-slash note (same boundary as the rejected CSRF
candidate); the libs-explorer frame `postMessage` path (reviewed on the
status-runtime unit); `defineUserMutation` past call order
(`resolveUserWithScopes` is `requireAuth` then `requireAuthScopes`, and
`auth.ts` is on the request-trust unit); `requireOrgRole` before device
administration (reviewed on the tenancy unit, and narduk-devices documents it as
a consumer obligation).

## Security posture

The reviewed priority paths hold the anchors this repo claims: session and
API-key checks before user mutations, scope ceilings on key minting,
parameterized SQL and allowlisted identifiers, server-chosen object keys, and
fixed or same-origin browser sinks. Two source-grounded leads remain unresolved,
both in `narduk-core`, and neither has a severity. One proposed CSRF bypass was
rejected from the locked router and path decoder. External workflow bodies and
the OAuth provider body were not read.

## Confirmed findings

None. No confirmed-findings table.

## Needs validation

These are leads. They are not confirmed vulnerabilities and they have no
severity. Full trace, evidence, blockers, and plans are copied in
`NEEDS-VALIDATION.md`.

| Title                                                         | Repository trace                                 | Blocker                                                                                                                                                                                                                                                                          | Bounded local next step                                                                                                                                                                                                                                                           | Owner observation                                                                                                                                                                                     |
| ------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layer session Secure flag follows the request protocol header | `user-session.ts:163` → `:66` → `:168`           | No `Set-Cookie` was observed, and whether the deployed edge replaces `X-Forwarded-Proto` with the scheme it terminated is not in this repo. On the locked adapter only the exact header value `https` sets Secure, because `URL.protocol` does not set the socket encrypted bit. | Call `resolveSessionConfig` on the unencrypted stub and on in-process fixtures with `connection.encrypted` set or unset and `x-forwarded-proto` absent, `http`, or `https`. Compare the mock's protocol check with the Cloudflare handler's `protocol` argument. Send no traffic. | Inspect an already-accepted Worker request that writes a session, or the route's header policy, and record whether `X-Forwarded-Proto` equals the terminated scheme. Do not send a new request.       |
| Validated URL fetch skips IP pinning outside Node             | `urlValidator.ts:541` → `:603` → `:231` → `:699` | No in-repo caller passes a URL into the helper. Whether `nodejs_compat` sets `process.versions.node`, and whether workerd re-resolves after the public-host check, is not in this repo. The comment that platform fetch has no rebinding window is not a control.                | With no network I/O, record that a non-Node runtime and a non-empty address list return an undefined pin, and that the fetch is not refused before it uses the hostname and no dispatcher.                                                                                        | Record the deployed worker's compatibility flags, whether that workerd exposes `process.versions.node`, and whether the dial is bound to addresses already resolved. Do not issue a production fetch. |

Fingerprint `narduk-core.session.secure-follows-request-protocol`.
`setLayerUserSession` passes `resolveSessionConfig` to h3 `useSession`.
`cookie.secure` is true only when `getRequestProtocol` returns `https`. Locked
h3 1.15.11 returns `https` when `x-forwarded-proto` is exactly that string, and
otherwise only when `connection.encrypted` is set. Locked h3's default cookie is
`httpOnly` and `secure: true`; this config replaces Secure and leaves HttpOnly.
That HttpOnly default is the same cookie path, not a second record.
`createSession` sets `httpOnly` and derives Secure from a localhost `Host`
prefix; that is a different cookie. The in-repo test that expects
`secure: false` uses host `127.0.0.1:3011` and an empty connection. The test
that expects `secure: true` sets `x-forwarded-proto: https`. Phase 3 and phase 5
both kept this lead.

Fingerprint `narduk-core.ssrf.unpinned-non-node-fetch`.
`fetchWithValidatedRedirects` (`fetchUrlSafely`) is the helper the file
documents as the SSRF-protected fetch. No production or test caller in this
repository passes a URL into it. After a public-host check,
`createPinnedDispatcher` returns `undefined` when `process.versions.node` is not
a string. `undefined` is not the fail-closed `unavailable` result, so the later
`fetch` uses the hostname and no dispatcher. Private-literal checks and the
pre-fetch DNS classification still run. They do not bind the later dial to an
address already accepted. Phase 3 and phase 5 both kept this lead.

## Hardening

Defense in depth and same-principal notes from the hunters. None of these is a
finding.

- An empty API-key scope set can mint another empty set. The ceiling comment
  says only `*` may mint an unscoped key.
- `ensureLinkedLocalUser` adopts an existing local user by email and does not
  read `email_confirmed_at`.
- Local email throttling prefers `cf-connecting-ip`, then the first
  `X-Forwarded-For` value.
- `normalizePrivilegePath` does not percent-decode. This package does not show
  the privilege check and the router disagreeing.
- MCP registration checks redirect URIs only when `redirect_uris` is an array.
  The provider's handling of other shapes is the unread package above.
- A keychain update replaces the secret bytes and can leave a pre-existing
  item's accessibility unchanged. New items set ThisDeviceOnly.
- `createSupportGrant` does not call `requireRank`. Revoke of a support grant or
  invite allows any current org member.
- `placeholderTuplesWithCasts` splices a cast string with no type-name
  allowlist. The only in-repo caller passes `uuid` and `text` literals.
- `toNodePostgresOptions` interpolates `applicationName` into a libpq options
  string.
- A `|` in a timeseries path can share an in-flight resolution promise. The
  waiter then fails closed.
- Rollup series-id lists are not capped before they are bound. Output rows are
  capped.
- `queryTrack` has no required tier window. Raw and track reads are assigned to
  the consumer app.
- The Influx adapter substitutes dates into caller-owned flux and does not add a
  vessel predicate. The library documents that the caller owns the query.
- Image prefix matching is `startsWith` and does not require a trailing slash.
  An empty prefix is rejected at setup.
- `GET /images/**` allow-lists content type and sets `nosniff`. It does not
  re-sniff bytes.
- Recorded device approval without a device proof is a documented caller-verify
  mode.
- Recorded-approval failures are counted against the claim-token subject because
  `callerScopeMatches` is set true there on purpose.
- `issueChallenge` does not issue a session. Unauthenticated challenge minting
  was outside the assigned class.
- Device `idempotency_key` uniqueness is global.
- `isPrivateIPv4` returns not-private for `192.0.0.9` and `192.0.0.10` before
  the `192.0.0.0/24` reject. Those two addresses are globally reachable
  assignments.
- `getClientIp` trusts `cf-connecting-ip` by default. No reviewed path
  authorizes from that address.
- CORS does not set `Access-Control-Allow-Credentials`. CSRF requires some
  non-empty `X-Requested-With`, which is a custom-header barrier rather than a
  session-bound token.
- Legacy security-header mode `off` sends `script-src` `unsafe-inline` and
  `unsafe-eval`. The module documents that as the existing fleet policy.
- `readWorkerRuntimeEnv` merges `process.env` under worker bindings. Binding
  names are not request-controlled. `__proto__` is skipped on the value read.
- `narduk-app` `setAppCookie` omits HttpOnly, Secure, and SameSite unless the
  caller passes them, and it does not reject CR or LF. No in-package caller
  feeds request data into that cookie.
- `principalFromRequest` accepts a caller-chosen header name. The realtime
  router strips only the `x-narduk-` prefix. The default header is covered by
  that strip.
- An unsigned list cursor is safe only when the route re-authorizes. The parser
  documents that as an app obligation.
- `requireSharedSecret` passes an unset secret only when `import.meta.dev` is
  true.
- Map point `href` is an app prop with no scheme allowlist.
- The command palette assigns `location` for an absolute command `to` with no
  scheme allowlist. The value is an app command.
- Schemeless prose hrefs stay links. `https` links are already on the allowlist.
- `createMapKitHtmlSlotRenderer` writes caller-supplied HTML. The cluster markup
  interpolates a count.
- `public.mapkitToken` still reaches the browser when set. The composable
  documents it as a deprecated origin-unrestricted JWT. The default is empty.
- An empty MapKit `allowedHosts` list means every routed host, which the handler
  documents.
- Sensitive-query detection misses camelCase keys such as `resetToken`.
- `notifyIndexNow` can post without repeating the host assert. The public submit
  route performs that assert.
- SEO uses `X-Forwarded-Host` only to set `X-Robots-Tag` on a host mismatch. OG
  image `src` is a caller prop.
- `ci.yml` skips `release-plan:check` when `head_ref` is exactly
  `changeset-release/main`. That skip does not admit the ref to publish.
- `release-proof.yml` checks out a `workflow_dispatch` SHA with `actions: write`
  before the ancestor-of-main check. The dispatcher is a write principal.
- `refresh-generator-pins.yml` checks out `narduk-enterprises/workflows` at
  `main` and opens a pull request limited to pin files.
- The Swift Linux installer trusts `swift.org` `all-keys.asc` at download time,
  then verifies the tarball from the same vendor.
- Foundation item 6.2 scans a fixed set of env paths. Item 6.3 is not applicable
  while nvault adoption is paused. Items 12.5 and 12.9 can pass while a file is
  unread. Item 15 is advisory and does not fail.
- The public-runtime secret lint skips a key that is not a string literal.
- `ship-support` skips unset `NUXT_OG_IMAGE_SECRET` and `NUXT_SESSION_PASSWORD`.
  When set, it rejects a short value.
- The generated D1 bundle job template grants `id-token: write` on a same-repo
  pull-request head. Generation does not install that workflow.
- AI cache keys are not bound to `tenantId` or `userId`.
- AI context marked trusted is left unescaped by contract. Reference and
  untrusted text are XML-escaped.
- Logging does not scan free-text messages. The docs state that limit.
- The Python oversized-record path copies error name and message from
  `sanitize_fields` rather than `sanitize_error`.
- `isSharedCacheable` consults `Cache-Control` only.
- The platform README says unknown list-query keys are rejected. The schema
  defaults `strict` to false and reports them on `unknownKeys` without merging
  them into filters.
- The libs-explorer README names a public host the source says is not deployed.
  The preview server binds `127.0.0.1`.

## Positive source patterns

From covered units, source only:

- API-key minting refuses scopes the caller does not hold, caps a `*` key at 90
  days, and clamps a child expiry to its parent.
- Local email tokens are single-use SHA-256, setup hosts are allowlisted, and
  the redirect stays same-origin.
- WebAuthn consumes a challenge once, checks RP ID, user verification, and the
  signature counter.
- Apple sign-in checks RS256 against JWKS, a nonce, and single-use state.
- The MCP resource guard requires a bearer on mutating methods, and an
  authorization code is claimed once with `INSERT ON CONFLICT`.
- New Swift keychain items are ThisDeviceOnly and non-syncing. A failed keychain
  write revokes the refresh token.
- Tenancy enforces a rank ceiling and a last-owner check. A support grant is not
  a role. Invite tokens are stored as a single-use hash.
- Device session open requires the signed request to match the device,
  credential, installation, resource, class, and version. Replay insert uses
  conflict-do-nothing. Claim copies org and resource from the token row.
- Postgres placeholders, a role allowlist, snake_case identifier quoting, and a
  migration file-name gate are in the reviewed path.
- Timeseries binds `vessel_id`, takes rollup tables from a frozen map, and
  clamps the clock so a past `now` cannot lower the rollup floor.
- Upload `POST` is a user mutation. The object key is a server UUID. The client
  file name is not the key.
- Realtime strips inbound `x-narduk-*` before authorize, rejects that prefix at
  config time, and throws at compile time when a route has neither `authorize`
  nor `allowUnauthenticated`.
- Chart, shell, and UI packages render labels as text. Analytics script hosts
  are fixed. The private MapKit key stays on private runtime config. SEO
  canonicals stay same-origin.
- This repo's workflows have no `pull_request_target`. Release verification
  requires a 40-hex SHA on this repo's `main`.
- The design-system export rejects `script`, `iframe`, `on*` attributes, and
  external URLs. Explorer frame messages require the page origin and a known
  source. Logging sanitizes keys before the sinks that were reviewed. Geogrid
  caps plane and value allocations and does not put header text in GLSL.

## Coverage

| Status         | Count |
| -------------- | ----- |
| covered        | 33    |
| candidate      | 1     |
| deferred       | 1     |
| out_of_scope   | 3     |
| not_applicable | 1     |
| Total          | 39    |

The candidate unit is narduk-core request trust and binding selection. It holds
three fingerprints: the rejected CSRF claim and the two open leads.

Critic result: parent synthesis of wave 1, recorded in `coverage-critic.md`. No
distinct final-clean critic ran. No clean-coverage claim.

`packages/modules/narduk-core/runtime/server/middleware/csrf.ts` returns before
`isCsrfExemptPath` for five built-in prefixes and exact `/api/owner-tag`.
Declared exemptions refuse percent signs, backslashes, empty segments, and dot
segments. Phase-3 verifier `v3-csrf` rejected fingerprint
`narduk-core.csrf.builtin-prefix-skips-normalizer`. Locked h3 1.15.11 decodes
the path once before middleware, locked ufo leaves `%2F` encoded and leaves dot
segments in place, and locked radix3 1.1.2 matches those segments literally. The
early return does not select a different route from the router. The stricter
matcher on declared paths is inconsistent hardening. The fingerprint is named
here because it is why that candidate unit is not only the two open leads.

## Validators

- `node validate-findings.cjs findings.json`: PASS, 3 findings (1 rejected, 2
  needs_validation)
- `node validate-coverage-ledger.cjs coverage-ledger.json`: PASS, 39 units
