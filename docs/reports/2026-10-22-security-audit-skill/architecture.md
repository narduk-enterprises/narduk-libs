# Architecture

Reviewed commit `212392aa61537e5fd7ccce842e5a17f2e832e3d6` on clean `main`. No
prior `coverage-ledger.json` or `findings.json` exists for this repo. Profile is
`deep`. Local execution is blocked: the host cannot prove the skill's OS
sandbox, so hunters stay on source and any candidate that needs a runtime result
is `needs_validation`.

## Product and principals

`narduk-libs` publishes reusable libraries consumed by Narduk Nuxt and
Cloudflare apps. It is not itself a deployed app, a fleet control plane, or a
template that keeps managing generated repos. Ordinary callers are application
code (a lower-trust principal relative to a security helper) and, inside
`narduk-auth`, an HTTP client, a native Swift client, or an MCP OAuth client.
Operators are the maintainers who publish packages and the apps that configure
modules. Protected resources are session grants, API-key scopes, OAuth grants,
tenant rows, uploaded objects, device identities, MapKit tokens, release tokens,
and generated-app defaults that later run in production.

Comparable baseline, source-grounded: the auth package sits on
`nuxt-auth-utils`, Supabase Auth, SimpleWebAuthn, and Drizzle, and the edge
packages sit on Nitro and Cloudflare Workers. Those stacks treat the session
cookie, the verified token, and the binding (D1, KV, R2, Hyperdrive) as the
trust anchors, and they treat the browser and the app caller as untrusted. A
missing second control is hardening when the anchor holds. A helper that apps
rely on as the anchor is in scope even though the live Worker config is not in
this repo.

## Stack and local limits

TypeScript, Vue, Nuxt modules, Nitro server routes, Drizzle SQL, one Swift
package (`NardukAuthKit`), pnpm workspaces, Changesets, and GitHub Actions.
Families are `packages/modules`, `packages/tooling`, `packages/design`, and
`packages/contracts` (`pnpm-workspace.yaml`). Offline tests exist per package
(`vitest`, some Playwright) but are not run in this pass. Commands that publish,
install from a registry, or call Cloudflare, GitHub, or npm are prohibited.
Deployment facts that source cannot establish (live WAF, cookie flags set only
in an app, binding names, Doppler or nvault contents) stay `needs_validation`
when they decide a claim.

## Entry surfaces

HTTP and browser: `narduk-auth` server routes under `server/api/auth`,
`server/api/admin`, `server/mcp-oauth`, and the Vue login, OAuth, and passkey
pages. The request principal is `server/utils/request-principal.ts`, with the
session grant validator plugin and `session-privilege.ts`. Account transition
lives in `server/lib/app-auth`. WebAuthn verification and challenge storage are
separate from login. API keys have a scope ceiling and lifetime in
`shared/utils`. MCP OAuth has `resource-guard.ts` and redirect URI checks.

Native: `swift/Sources/NardukAuthKit/CredentialStore.swift` stores device
credentials.

Data: `narduk-postgres` builds queries and schema; `narduk-uploads` names
objects; `narduk-timeseries` reads series; `narduk-devices` binds device
identity; `narduk-tenancy` is the tenant-scope helper other packages are
expected to call.

Edge and app shell: `narduk-core` selects Cloudflare bindings and parses list
queries; `narduk-realtime` binds a socket principal; `narduk-app` sets module
defaults other packages inherit.

Client: `narduk-shell`, `narduk-ui`, `narduk-maps`, and `narduk-charts` render
HTML. `narduk-mapkit` and `narduk-mapkit-nuxt` handle tokens and runtime config.
`narduk-seo` builds redirects and canonicals. `narduk-analytics` inserts a sink.

Supply chain: `.github/workflows` and `scripts/` publish and smoke-test
packages. `create-narduk-app` writes a new app once. `narduk-app-tools` is the
foundation checker apps trust. Lint and test packages (`eslint-config`,
`stylelint-config`, `journeys`, `narduk-testkit`) are reviewed for obvious code
execution, not as product auth.

AI, logs, contracts: `narduk-ai` assembles prompts and tools. `narduk-logging`
is the redaction boundary before a sink. `narduk-platform` is the shared
contract callers trust. `geogrid-web` takes grid input. `status-runtime`,
`libs-explorer`, and `design-system-build` are workspace tools with disclosure
and dependency surfaces.

## Trust boundaries

The strongest source-visible controls are the auth request principal and
session-grant validator, the API-key scope ceiling, the OAuth resource guard,
WebAuthn verification, the tenancy helper, and whatever query parameterization
postgres and core actually implement. Client packages have no session authority
of their own. Release authority is the workflow `permissions` block and the
scripts those workflows run. Logging is a control only where redaction runs
before the sink. Cloud IAM, TLS, cookie `Secure`/`HttpOnly`, and WAF are not
established by this repo when an app configures them.

## Starting paths

See each unit's `starting_paths` in `coverage-ledger.json`. Wave 1 assigns 34
units to six hunters. One unit is `not_applicable`: native memory-safety
classes, because the tree has no C, C++, unsafe Rust, kernel, JIT, or
binary-loader source.

## Prior coverage

None. `prior_status` is `none` on every unit. Nothing is excluded as a carried
confirmed finding.

## Companion selection

Selected because the boundary is source-visible: HTTP and account classes for
auth; data-isolation for tenancy, postgres, uploads, timeseries, and devices;
cloud storage for uploads; cloud ingress and workload identity for core and app;
protocols for realtime, postgres framing, and platform contracts; client DOM and
navigation for shell, UI, maps, charts, seo, and analytics; secret lifecycle for
mapkit, scripts, and workflows; supply-chain for workflows, the generator,
app-tools, and lint packages; desktop credential storage for the Swift store; AI
prompt, tool, MCP, and output classes for auth's MCP OAuth server, `narduk-ai`,
and logging. Memory-safety companions are excluded with the ledger reason above.
Other exclusions are per unit: the subsystem does not implement that boundary.
