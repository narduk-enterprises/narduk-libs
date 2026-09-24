# @narduk-enterprises/eslint-config v2 — design record

Migration of the estate lint config into narduk-libs per the recorded
HB-10/D-DEMOTE-1 direction and narduk-libs#50, executed 2026-08-01. Source of
truth for what changed and why: the executed rule-by-rule deep review embedded
in narduk-libs#50 (103 rules: 31 DROP / 34 REPLACE / 38 KEEP+harden; proofs of
inverted rules, dead security gates, and code-corrupting fixers).

## Goals

- Same published name, **new major (2.0.0)**, released through this monorepo's
  changesets flow (which retires the old repo's unconditional auto-bump,
  D-PKG-2, and no-PR-gate publishing, D-PKG-3, by construction). The manifest in
  the tree reads `1.2.19` — the last version the demoted incubator repo
  published — and the `major` changeset is what resolves it to 2.0.0.
  Hand-setting the manifest to `2.0.0` as well would make changesets emit
  **3.0.0**, since it bumps from whatever the manifest currently says;
  `tests/composition/package-surface.test.ts` asserts the manifest is still
  pre-2.0.0 with a major changeset pending, so that cannot happen silently.
- **ESLint 10** peer (`^10.0.0`), current `@nuxt/eslint`-composed foundation,
  `vue-eslint-parser ^10`. Node >= 24.
- **Replace-by-default** (Logan's directive): a maintained third-party rule
  replaces a bespoke rule wherever it covers the intent. No bespoke rule is
  ported without a deep-review KEEP verdict, and none without tests.
- **API compatibility**: `createAppLintConfig({ withNuxt, capabilityPacks })`
  and `composeSharedConfigs(...)` keep their signatures; the 14 capability pack
  names survive (`core`, `design-system`, `nuxt-ui`, `seo`, `cloudflare`,
  `server`, `auth`, `template`, `correctness`, `a11y`, `complexity`,
  `formatting`, `e2e`, `monorepo`). Pack _contents_ change; consumer
  `eslint.config.mjs` files should need only a version bump.
- `license: UNLICENSED` (D-PKG-5 — the old package wrongly said MIT).
- Every surviving autofixer is either proven safe by tests or stripped to a
  non-fixing rule. The five proven code-corrupting fixers do not survive.
- Tests use the real gates — the old suites' `testMode` bypass (which let a dead
  CSRF gate ship green) is banned; path-gate behavior is tested through real
  filenames.

## Dropped wholesale

Legacy presets (`recommended`/`nuxt`/`vue`/`vue-strict`/`app`/`all`/…), the
`@narduk-enterprises/narduk-skills` postinstall coupling, the frozen
`nuxt-ui-v4.json` spec tier and its seven spec-driven rules (`replacedBy` data
was prose-scraped garbage), the dead `src/utils/utils.mjs` twin, the wrong
hand-written `vue-eslint-parser.d.ts` ambient types, and every DROP-verdict rule
in the review.

## Replaced by maintained third-party

| Bespoke intent                                                                                                   | Replacement                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 11 `no-native-*` element rules + `prefer-uform`                                                                  | `vue/no-restricted-html-elements` (one config entry per element, custom messages)                                                                                               |
| Tailwind tier (`no-raw-tailwind-colors`, `no-tailwind-v3-deprecated`, `no-invalid-nuxt-ui-token`, var shorthand) | `eslint-plugin-better-tailwindcss` — MUST be fixture-validated against a real `.vue` template before adoption; fall back to `eslint-plugin-tailwindcss` if SFC extraction fails |
| `no-unknown-nuxt-ui-component`                                                                                   | `vue/no-undef-components` (pattern already wired in v1's app config)                                                                                                            |
| `prefer-import-meta-client`/`-dev`                                                                               | `@nuxt/eslint-plugin` `prefer-import-meta`                                                                                                                                      |
| `no-await-in-loop-in-server`                                                                                     | core `no-await-in-loop` (server files scope)                                                                                                                                    |
| `file-size-budget`                                                                                               | core `max-lines`                                                                                                                                                                |
| `no-relative-server-imports`, `no-direct-layer-source-imports`                                                   | core `no-restricted-imports` patterns                                                                                                                                           |
| `eslint-plugin-vitest` (abandoned)                                                                               | `@vitest/eslint-plugin`                                                                                                                                                         |
| Pinia state-mutation/storeToRefs intents (partial)                                                               | `eslint-plugin-pinia` + our two SOLID pinia rules                                                                                                                               |

## Ported (KEEP), with tests

SOLID core: `prefer-safe-parse-in-event-handlers`,
`no-blocking-top-level-io-in-nuxt-plugin`, `no-legacy-overlay-api`,
`no-legacy-overlay-model`, `no-legacy-options-prop`, `no-legacy-fetch-hook`,
`no-barrel-auto-imports`, `no-map-async-in-server`, `no-static-mermaid-import`,
`no-tight-interval`, `pinia-require-defineStore-id`, `prefer-shallow-watch`,
`no-multi-statement-inline-handler`.

## Rebuilt (KEEP + harden), with review-proof regression tests

- **Hydration**: `require-client-only-switch` and
  `require-client-only-hydration-sensitive` were exactly inverted
  (`VElement.name` is lowercased; match `rawName`, walk real parents) — fixed,
  with the review's A/B/D/E proof cases as tests. `no-ssr-dom-access` guard
  rebuilt (the `type.startsWith('V')` ancestor check matched
  `VariableDeclarator`), tested under `vue-eslint-parser`.
  `no-locale-date-format-in-ssr-text`: keep; fix the `v-bind` attribute
  exemption hole and recognize `process.client` guards.
- **Nitro security tier**: shared `mutation-route-utils` gate rebuilt (covers
  `server/api/**` and `server/routes/**`, method-suffix files AND handlers
  declaring methods; a rename cannot silently disable four rules);
  `require-csrf-header-on-mutations` rewired to file globs that exist;
  `no-raw-sql-with-variable-input` polarity fixed (parameterized interpolation
  is the SAFE form; flag `sql.raw(...)` with variable input through namespace/
  alias/barrel imports); `require-immediate-mutation-body-validation` made
  receiver-aware (`JSON.parse` is not a validator);
  `require-enforce-rate-limit-on-mutations` scope-aware;
  `no-csrf-exempt-route-misuse` inspects the header it claims to;
  `require-limit-on-drizzle-list-queries` covers `db.query.*.findMany()`;
  `prefer-drizzle-operators`, `require-validated-body/query` gain real tests or
  are dropped by the lane if unhardenable in scope (record which).
- **Cloudflare tier**: 4 rules kept; shared utils rebuilt (no cross-run
  module-level `WeakMap` cache; worker-runtime detection not fooled by a
  `~/workers/` checkout path; driver map extended).
- **Data-fetch/Nuxt tier keeps**: `no-raw-fetch` (gate fixed — relative
  filenames; the canonical `useAsyncData(() => $fetch())` composition is VALID),
  `no-raw-fetch-in-stores`, `no-fetch-create-bypass`,
  `no-sequential-awaited-io-in-event-handler`,
  `no-blocking-io-in-server-plugin`, `no-fetch-in-onmounted`,
  `no-fetch-in-watch` (receiver-aware), `component-directory-structure`,
  `composable-primary-export`, `require-use-prefix-for-composables`,
  `no-setup-top-level-side-effects`, `no-module-scope-ref`,
  `no-template-complex-expressions` (operator-count fixed),
  `no-composable-conditional-hooks` (unref/isRef/toValue are not hooks; cover
  for-of/for-in), `no-attrs-on-fragment`, `no-non-serializable-store-state`
  (matcher matches its message). Rules the lane judges unhardenable in scope are
  dropped and recorded here rather than shipped shaky.
- The leading-slash path-gate bug class (8 rules dead on relative filenames) is
  fixed once in a shared, tested `path-scope` util.

## Layout

```
packages/tooling/eslint-config/
  package.json  tsconfig.json  tsup.config.ts  DESIGN.md  README.md
  src/index.ts                  # plugin object: rules + pack re-exports
  eslint-app-config.mjs         # createAppLintConfig / composeSharedConfigs
  configs/*.mjs                 # 14 packs (same names, new contents)
  configs/restricted-imports.mjs  # not a pack: the one shared no-restricted-imports option
  src/rules/<tier>/*.ts         # ported + rebuilt rules (TypeScript only)
  src/rules/utils/*.ts          # rebuilt shared gates (path-scope, mutation-route, cloudflare)
  tests/**                      # RuleTester + composition tests; no testMode
```

## In-repo integration (same PR)

Workspace root and `narduk-core` move to the workspace version (`workspace:*` →
published `^2.0.0` on release); root `eslint` devDependency moves to `^10`;
`narduk-core`'s re-exported `eslint-app-config` keeps working unchanged. The
monorepo's own lint run under the new config is the first consumer proof;
`release:consumer-smoke` is the second.

## Build-time drop record (lanes, 2026-08-01)

- `require-reactive-watch-on-useAsyncData` — dropped by the nuxt lane:
  trustworthy hardening needs four simultaneous judgments (scope-resolved
  reactive sources, key classification, external-watch awareness, and
  `useFetch`'s implicit reactive watching), and the residual false-positive risk
  at error severity is the "shipped shaky" outcome this design forbids.
- `prefer-drizzle-operators` — dropped by the server lane: regex-matching
  reconstructed SQL text; needs a real SQL parser to be trustworthy; zero
  security value; zero v1 tests.
- `require-validated-body` — dropped by the server lane: superseded by the
  rebuilt receiver-aware `require-immediate-mutation-body-validation` (shipping
  both double-reports the same line).
- `require-validated-query` was retained (rebuilt scope- and receiver-aware),
  despite early drafts of this document listing it with the above.
- `eslint-plugin-redundant-nuxt-auto-import` (the standalone plugin behind
  `redundantNuxtAutoImportFlatConfig`) — dropped at integration: it regex-parses
  `.nuxt/imports.d.ts` with brace counting, silently no-ops on reformatted
  export blocks, and walks the filesystem per linted file. The
  `eslint-nuxt-flat-fragments` subpath survives as a compat shim (settings
  fragment intact; the rule's fragment inert) so narduk-core's re-export and
  consumer configs keep resolving. A hardened rebuild can restore it behind the
  same name.

### Nine review-KEEP rules that did not ship (recorded 2026-08-02)

The sections above list these as intended keeps in one place or another; none of
them exists in `src/rules/`. They are **dropped for v2**, and this is the record
that was missing — a consumer upgrading from v1 loses each of them, and until
now nothing said so.

| v1 rule                                         | Tier      |
| ----------------------------------------------- | --------- |
| `valid-useAsyncData`                            | data      |
| `no-await-nuxt-async-data-in-spa-surfaces`      | data      |
| `no-sequential-awaited-data-fetching`           | data      |
| `require-use-seo-on-pages`                      | seo       |
| `require-schema-on-pages`                       | seo       |
| `prefer-use-seo-over-bare-meta`                 | seo       |
| `no-legacy-head`                                | seo       |
| `no-reactive-in-services`                       | structure |
| `no-composable-dom-access-without-client-guard` | hydration |

**Rationale — design-time scoping, not a per-rule verdict.** v2 was scoped to
the "genuinely defensible core" the deep review named (narduk-libs#50: the Nitro
security tier, the overlay/legacy-API rules, the hydration rules, the safe-parse
and blocking-IO rules) plus everything a maintained plugin could replace. The
nine above sit outside both sets: each needs analysis this package does not yet
have — cross-file page/route awareness for the four SEO rules, `useAsyncData`
option and reactive-key semantics for the three data rules, service-layer
boundary knowledge for `no-reactive-in-services`, and composable-call-graph
reachability for the hydration one. Shipping any of them at `error` on the
strength of v1's implementation is the "shipped shaky" outcome the goals above
forbid, and none had a hardening budget in this lane.

They are **rebuild candidates, not rejections**: each has a real intent.
Restoring one means building the missing analysis first and carrying its own
regression proofs.

Where the packs already state a reason, this table consolidates rather than
overrides them, and those reasons are the specific ones:

- `configs/seo.mjs` records `require-use-seo-on-pages`,
  `prefer-use-seo-over-bare-meta` and `require-schema-on-pages` as DROP verdicts
  — each gated on `filename.includes('/app/pages/')`, so each was dead under the
  relative filenames `eslint .` produces, and none had a maintained equivalent
  worth wiring. `no-legacy-head` belongs with them and was the one the pack
  header omitted.
- `configs/template.mjs` records `no-reactive-in-services` as a DROP verdict.
- `no-sequential-awaited-data-fetching` is not merely absent: the deep review
  found it recommending `Promise.all` for `/cart/lock` followed by
  `/cart/submit`, i.e. introducing a race in code whose ordering was the point.
  Its defensible half survives as `no-sequential-awaited-io-in-event-handler`,
  which excludes mutation-shaped calls for exactly that reason.
- `valid-useAsyncData` and `no-reactive-in-services` are on narduk-libs#50's
  "turn off, today" list. So is `no-raw-fetch`, which _was_ rebuilt and does
  ship — being on that list is a statement about a v1 implementation, not a
  verdict on the intent.

## Integration-time adjustment record (2026-08-02)

- **All three theme-resolving `better-tailwindcss` rules are gated, not two.**
  `no-unknown-classes` and `no-deprecated-classes` were already off in the pack
  and enabled by `createAppLintConfig` only when the app declares
  `tailwindEntryPoint` and that file exists (narduk-libs#665). Inferring from a
  conventional stylesheet or from `tailwindcss` resolving is how a non-Tailwind
  app picked up 2411 unknown-class errors (operator-portal#431).
  `enforce-canonical-classes` (the `prefer-tailwind-var-shorthand` replacement)
  resolves the compiled theme through the same shared plugin context and so
  emitted the identical "No tailwind css entry point found at
  `app/assets/css/main.css`. Option `entryPoint` may be misconfigured" report —
  16 of them across `narduk-core`, `narduk-seo` and `narduk-auth`, none of which
  is fixable in app code. It now sits behind the same gate, at its original
  `warn` severity. Proof: `eslint-plugin-better-tailwindcss@4.7.0`
  `lib/utils/context.js` (`getEntryPointWarning`) is reached by
  `lib/rules/enforce-canonical-classes.js` exactly as by the other two. Pinned
  by `tests/composition/tailwind-theme-override.test.ts`.
- **`eslint-nuxt-flat-fragments.mjs` was missing from `files`.** The export
  subpath resolved in the workspace and would have 404'd from the published
  tarball. Added, and `tests/composition/package-surface.test.ts` now asserts
  every export target is covered by `files`.
- **`packages/tooling/eslint-config/eslint.config.mjs` added.** A flat config's
  relative `files` globs resolve against the directory of the config that
  declares them, so linted from the workspace root the shared tail's
  `narduk/rule-authoring` entry (`src/rules/**`, where rule implementations
  legitimately traffic in parser-specific `any`) could never match
  `packages/tooling/eslint-config/src/…`. The package reported ~420 warnings it
  was explicitly exempt from. The local config restores the intended scope and
  copies the root's `packages/**` relaxations verbatim; nothing about what
  consumers receive changes.

## Adversarial-hardening record (2026-08-02)

An adversarial pass against the packed tarball, run from a consumer harness,
found six ways to walk past the shipped security tier and two correctness
defects. All eight are fixed here, each with the fixture that proved it encoded
as a regression test.

### Security evasions

1. **Aliased handler-defining calls.** `const handler = defineEventHandler`
   followed by `export default handler(…)` produced **zero** diagnostics on a
   POST route: every consumer of the shared gate compared the callee's
   _spelling_ against a name set. `resolveIdentifierAliasChain()` in
   `utils/mutation-route` now walks a callee identifier back through
   single-assignment local bindings via the scope manager (bounded, cycle-safe,
   and refusing any reassigned binding), and the wrapper, rate-limit and CSRF
   rules resolve through it. An aliased _approved wrapper_ correctly still
   counts as the wrapper.

2. **Indeterminate methods.** `const method = ['POST'][0]` compared against
   `getMethod(event)` left the route on `unspecified`, so every rule needing a
   proven mutation stayed silent on a live POST handler. The gate cannot invent
   the method, so it records the ambiguity (`hasIndeterminateMethod` /
   `hasUnresolvableMethod`) and `no-raw-define-event-handler-in-mutation-routes`
   reports it once, telling the author to pin the method with a method-suffixed
   filename or a literal — which makes the rest of the tier decidable.
   Deliberately **one** rule: firing the whole tier on an ambiguity would report
   obligations that may not exist. Module-local string constants
   (`const POST = 'POST'`) resolve and are not ambiguous; a filename that
   already pins the method settles it regardless of the body.

3. **`.raw` lifted out of the call shape.** `const { raw: rawSql } = sql` and
   `const rawSql = sql.raw` both bypassed `no-raw-sql-with-variable-input`,
   which matched the `<receiver>.raw(…)` member _shape_. The rule now tracks the
   binding: any local whose sole initializer extracts `.raw` from a known
   drizzle `sql` — member access or object pattern — is itself a raw-SQL callee,
   and an identifier alias of `sql` resolves back to the builder. A local
   `const sql = { raw }` helper still resolves to an object literal and is still
   not flagged.

4. **Aliased Drizzle receivers and `limit: undefined`.**
   `const { users } = db.query; users.findMany()` removed the `.query.` segment
   the shape test required; `findMany({ limit: undefined })` was read as bounded
   because the _key_ was present. Receivers now resolve through
   single-assignment locals (member and destructured), and an explicit
   `undefined`/`void 0` counts as no limit.

5. **Nesting.** The server, auth and cloudflare globs were `server/**` and
   `workers/**`, which ESLint anchors at the config's base path — so a tree
   linted from an outer `cwd` (any monorepo, any app checked out one level down)
   matched _nothing_, and `--print-config` on a nested unwrapped handler showed
   no server security rules at all. The globs now carry a leading
   recursive-wildcard segment. Over-match is safe because every bespoke rule
   re-derives its scope from the filename; the two **core** rules the packs
   carry (`no-restricted-imports`, `no-await-in-loop`) have no such gate, so
   they moved to entries with `TEST_TREE_IGNORES` — the glob-level twin of
   `inTestOrFixtureDirectory()` — to keep the widening out of `tests/server/**`.
   Both nestings are asserted through ESLint's own resolver in
   `tests/composition/security-scope.test.ts`.

6. **Test-named routes.** `server/api/deploy.test.post.ts` — a route Nitro
   deploys as `POST /api/deploy.test` — matched the shared
   `isTestOrFixturePath()` infix exemption and switched the **entire** security
   tier off. Inside a route tree the exemption is now directory-only
   (`isExemptTestPath()`): a file escapes a security rule by living somewhere
   Nitro does not serve from, never by how it is spelled. **Consumer-visible**:
   a route suite colocated as `server/api/x.post.test.ts` is now linted as a
   route. Move it under `tests/` or `__tests__/` — which is also where it has to
   be for Nitro not to deploy it.

### Correctness

7. **`no-legacy-overlay-model` was blind to camelCase.** The element check read
   `rawName`; every _attribute_ check read `name`, which vue-eslint-parser
   case-folds. So the rule caught `v-model:model-value` and missed
   `v-model:modelValue`, `:modelValue` and the plain `modelValue` attribute —
   the spelling the older Nuxt UI docs actually used, and therefore the likelier
   one in real code. It also echoed `@update:modelValue` back as
   `"update:modelvalue"`, telling authors to fix a string not in their file.
   Every attribute name now reads `rawName` first.

8. **`no-restricted-imports` was decided by pack order.**
   `configs/cloudflare.mjs` set it with `paths` only; `server` and `template`
   each restated it _with_ `patterns`, which is safe only while `cloudflare`
   sorts before them. The adversarial order
   `core, server, auth, template, cloudflare` — legal, and close to what
   `nardukTemplateStrictCapabilityPacks` uses — put the paths-only entry last
   and deleted both pattern groups for every Nitro handler. All three packs now
   assign one shared constant (`configs/restricted-imports.mjs`); the merged
   option is identical under every permutation, asserted through ESLint's
   resolver.

   **Consumer-visible fallout, handled.** Making the option order-independent
   turns the two pattern groups back on for consumers that had them silently
   inert. Five packages here are portable Nuxt layers with no `#server/*` alias
   for their own sources, so the relative-parent ban is unsatisfiable inside
   them by construction. Rather than five hand-rolled opt-outs, the package
   exports `PORTABLE_LAYER_RESTRICTED_IMPORTS_RULE` — the same option minus
   exactly that one pattern group, keeping the Node-built-in and
   other-layer-source bans — and `narduk-core`, `-auth`, `-seo`, `-ai` and
   `-uploads` assign it to their own server globs. (Estate standard: an adapter
   shape belongs in the shared package once three or more consumers converge on
   it. `narduk-ai`'s hand-rolled first copy had already lost the layer-source
   ban it was not thinking about.)

### Newly-covered code (a consequence of fix 5)

Making the globs nesting-safe lints `runtime/server/**` in the layer packages
for the first time — the intent of the fix, since that is Nitro code shipped to
every consuming app. It surfaced pre-existing conditions that are recorded as
scoped, commented exceptions in the owning packages rather than as pack changes:
`narduk-core`'s documented `node:net` dependency in the SSRF validator (its own
header states the `nodejs_compat` contract) and two deliberately sequential
`await` loops; `narduk-uploads`' multipart upload handler, where the body reader
is narrowed rather than the rule disabled, because `readMultipartFormData()`
returns binary parts that a schema parser asserts nothing useful about while
`validateUploadFiles()` does the real MIME/size validation.

### Known limitation: `no-ssr-dom-access` has no template-reachability analysis

A function whose _only_ call sites are template event bindings (`@click="copy"`)
never runs during SSR, but the rule reports unguarded DOM access in it all the
same. It already understands `<ClientOnly>`, `.client` files, client-only
lifecycle hooks (`onMounted` and eleven siblings), Nuxt `app:mounted` hooks, and
`import.meta.client` guards in the correct branch — the gap is exactly the
handler-called-from-template case. Three narduk-core components carry an
`import.meta.client` early return for this reason (`AppCopyButton`,
`AppShareButtons`, `AppSettingsProfile`); each is a runtime no-op on a path that
was already client-only.

**Not implemented here, deliberately.** The analysis is tractable — collect the
identifiers referenced from `v-on` expression containers via
`defineTemplateBodyVisitor`, resolve them by name against module scope (skipping
references vue-eslint-parser already bound to template-local variables), and
exempt a function whose references are _all_ from that set — but it is a new
two-phase analysis in a rule that is itself the rebuild of a proven-unreliable
v1 rule, and every mistake in the permissive direction stops the rule catching a
real SSR crash. Shipping it unreviewed at the end of a hardening pass is the
outcome the goals above forbid.

A future implementation must handle: `v-on` versus `v-bind` containers (a
`:title="copy()"` binding evaluates during render and must NOT exempt);
options-API methods and cross-file handlers, which do not resolve and must stay
reported; template-local shadowing, distinguished by
`reference.variable != null`; one-hop helpers called _by_ an exempt handler,
which stay reported under the strict "sole references" rule; and buffering the
script-phase candidate reports, since the template visitor runs after the script
traversal completes.

## Explicit non-goals of this PR

Consumer app migrations (per-repo follow-ups), archiving the incubator repo
(publish workflow already disabled 2026-08-01), and the ESLint-10 rollout in
apps (happens per app as they adopt v2).

## Warning budgets and the 2026-09 rules (recorded 2026-09-18)

### Why budgets

`eslint . --max-warnings 0` made every new warning rule a coordinated event:
someone had to track each rollout and step in wherever it went red. Logan,
2026-09-18: "I dont like the next pack....its hard on me cause it requires i
keep track of it and intervene.....i wonder how we can not enforce warnings and
keep the warnings in check maybe like max warnings? and just accept the super
offenders go red and have to be fixed?"

So there are two tiers. **Errors** are defects worth a red build, and they fail
everywhere. **Warnings** are held to a per-package `lint-budget.json`: a rule
may not grow past its recorded count, an unbudgeted rule passes, and a local run
ratchets counts down (never up) and prunes zeros. A new warning rule therefore
ships without turning anyone red, and existing debt can only shrink unless a
reviewer accepts a hand-edited increase.

Decisions inside that design:

- **The budget lives in the working directory, not next to the ESLint config.**
  Most narduk-libs packages share the root config; one file next to it would
  pool their counts and let one package's cleanup pay for another's new
  warnings.
- **CI never writes.** A stale budget (counts below the recorded budget, or an
  unbudgeted rule) prints a notice, not a failure. Failing on staleness would
  recreate the intervention the design exists to remove.
- **Unused-directive warnings** have no rule id in ESLint's output; they are
  counted as `eslint/unused-disable-directive`.
- **`--max-warnings` is refused**, so a lint script cannot quietly reinstate the
  old gate alongside the budget.
- **Turbo** declares `lint-budget.json` as a `lint` output, so a cache hit
  restores the file a real run would have written.

### Secrets rule choice

The brief asked for a secrets rule at error, choosing between
`eslint-plugin-no-secrets` and a custom rule.

`eslint-plugin-no-secrets` 2.3.3 (Shannon-entropy string scanning) was run
across narduk-libs: **222 reports in 104 files; every report spot-checked was a
false positive**. Examples: env-catalog selectors such as
`"doppler:narduk/tokens/TURNSTILE_SECRET_KEY"`, content hashes, and base64 test
fixtures. At error severity that is unshippable, and at warn it would be noise
that budgets would freeze in place.

The custom `narduk/no-secret-in-public-runtime-config` looks only where Nuxt
actually publishes values: credential-named keys under `runtimeConfig.public`
(serialized into every page), and credential-named keys with a string literal
default anywhere in `runtimeConfig`. It reported **0** on narduk-libs, which is
the expected result for a tree with no leaks. It trades recall (a literal token
pasted into ordinary code is out of scope; secret scanning in CI covers that)
for a zero false-positive rate at error.

### SQL rules

`sonarjs/sql-queries` (S2077, string-built SQL) is on at warn in the server
pack, test trees excluded, and counts toward budgets. It reported 0 in the
narduk-libs packages that use the server pack. `eslint-plugin-drizzle`,
`eslint-plugin-sql`, SafeQL and `eslint-plugin-sqlite` were evaluated by the
orchestrating lane and rejected, so none of them is added.

### `require-limit-on-drizzle-list-queries`: wider, with an escape hatch

The rule now also reports `.where(eq(<non-key column>, …))` with no `.limit()`.
An equality on a foreign or ordinary column is a list, not a lookup; the one
libs hit was `GET /api/auth/api-keys`, filtering by `userId`. Nothing caps how
many keys a user may create (the POST route is rate limited only), so it got a
real bound (`orderBy(desc(createdAt)).limit(100)`) rather than a
`narduk-bounded` comment, which would have been a false claim. The
`// narduk-bounded: <reason>` comment exists for sets that are bounded by
construction, and requires a reason so review can check it.

### `no-render-clock` precision choices

The rule is an error, so it stays inside one component: a composable that reads
the clock and is invoked during render is out of scope. A mounted flag (a
`useMounted()` ref, or a ref assigned `true` inside `onMounted`) guards its true
side only, including after `if (!mounted.value) return`; its false side is
exactly the SSR and hydrating render, so it stays reported. That was added after
narduk-ui's `NsFreshnessChip`, which renders a placeholder until mount, was
reported.

### Type-aware rules and the plugin copy

The server pack's promise rules and the correctness pack's type-aware warnings
are the first type-aware rules the packs turn on. `withNuxt()` registers
`@nuxt/eslint-config`'s own `@typescript-eslint` plugin, while the packs parse
with this package's `tseslint.parser`. In narduk-libs those two resolved
different TypeScript versions (5.9 through the modules, 6.0 through this
package, D-TOOLCHAIN-1), `TypeFlags` differ between them, and
`no-misused-promises` crashed. `createAppLintConfig()` now calls the composer's
`replacePlugin('@typescript-eslint', tseslint.plugin)`, so rules and program
always come from one install. In a consumer app both copies usually resolve the
app's single TypeScript, so the swap changes little there beyond the plugin
version.
