# Coverage critic — wave 1

Parent synthesis after all six hunters returned. This is not a distinct critic
agent, and the deep profile's final-clean critic was not a distinct agent. No
wave 2 was launched. The deep profile's full surface × boundary × class ×
lifecycle expansion was not seeded; the hunt covered the 34 priority units
assigned at the start. A green ledger is not complete deep coverage.

## Folded, not new units

- h1's CSRF trailing-slash and encoded-slash note is the same boundary as the
  narduk-core request-trust candidate
  `narduk-core.csrf.builtin-prefix-skips-normalizer`. It stays on that unit.
- h4's libs-explorer gallery `postMessage` note was already reviewed inside h6's
  status-runtime unit, on `packages/design/libs-explorer/scripts/serve.mts`,
  `demo/frame.mts`, and the component and frame pages. Origin and source are
  checked there. The unit label is status-runtime because that was h6's assigned
  bucket; the paths were still read.
- h2's `defineUserMutation` note stopped at call order. `resolveUserWithScopes`
  is `requireAuth` then `requireAuthScopes` in
  `packages/modules/narduk-core/runtime/server/utils/mutation.ts`. `auth.ts` is
  on the request-trust unit h3 reviewed. No second unit.
- h2's `requireOrgRole` note is the consumer obligation documented by
  narduk-devices. h1 reviewed `requireOrgRole` on the tenancy unit. No second
  unit.

## Added after the wave

- `out_of_scope`: workers-oauth-provider registration and consent body. The
  package source is not in this checkout and was not fetched.
- `out_of_scope`: called `nuxt-cloudflare.yml` permissions on `pull_request`.
  The reusable workflow body is not in this checkout and was not fetched.
- `out_of_scope`: called `node-library.yml` and `red-main-listener.yml` at
  `8192a81c8f1b3de36f1141b60fcd8de1c539772e`. Those bodies are not in this
  checkout and were not fetched.
- `deferred`: admin system-prompt writes and tenant scope. `defineAdminMutation`
  resolves an admin and does not add a tenant predicate. Whether those writes
  claim a tenant boundary was not a hunted unit. This is a coverage gap, not a
  finding.

## Ledger after the fold

39 units: 33 covered, 1 candidate, 1 deferred, 3 out_of_scope, 1 not_applicable.
`validate-coverage-ledger.cjs` PASS. The candidate unit keeps the three hunter
fingerprints until phase-3 verifiers return a disposition.

## Phase 3 and phase 5

Fresh scoped verifiers, not the parent:

- `v3-csrf` rejected `narduk-core.csrf.builtin-prefix-skips-normalizer`. Locked
  h3 decodes once, and locked radix3 matches segments literally, so the built-in
  prefix return does not select a different route.
- `v3-session` kept `narduk-core.session.secure-follows-request-protocol`.
  `v5-session` returned `verified`.
- `v3-ssrf` kept `narduk-core.ssrf.unpinned-non-node-fetch`. `v5-ssrf` returned
  `verified`.

No phase-5 replacement was applied. Both validators PASS after the verifier
checks were added to the candidate unit.
