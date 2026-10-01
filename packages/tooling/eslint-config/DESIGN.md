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

## Strict, no budgets (recorded 2026-10-01, v3.0.0)

**This supersedes the whole of "Warning budgets and the 2026-09 rules" below,
which is kept as the history of how the budget worked.** The default contract of
`narduk-lint` is now **0 errors, 0 warnings**: any warning fails, exactly like
`eslint . --max-warnings 0`, whether or not a `lint-budget.json` exists.

Logan, 2026-10-01: "lets get back to being strict in narduk apps.....i think we
be strict 0 errors 0 warnings and see if i notice it again"

What it replaces, in order:

- 2026-09-18 (narduk-libs#531), asked how to keep warnings in check without the
  opt-in "next pack": "I dont like the next pack....its hard on me cause it
  requires i keep track of it and intervene.....i wonder how we can not enforce
  warnings and keep the warnings in check maybe like max warnings? and just
  accept the super offenders go red and have to be fixed?" That produced the
  ratcheting `lint-budget.json`, with `strict` (#714, #673), the `maxWarnings`
  ceiling (#1222) and the 7-day entry expiry (#1237).
- 2026-09-28, the askme "Lint warnings: keep what shipped, or add expiring
  exceptions?": "Each warning over zero must be fixed within 7 days, cap 10
  stays as backstop; I build expiry into narduk-lint."

### The trade-off, stated honestly

The reason for #531 was real and is **not** solved by this change, it is
accepted. A budget let a new warn-level rule ship without turning anyone red.
Without one, **a new warn-level rule in this package turns every consumer that
violates it red the moment it upgrades**, which is the coordination cost #531
removed. Logan chose to pay it: a rule shipped as `warn` is now a rule consumers
must satisfy to take the release, and the notice is the red build on the upgrade
PR. This is why the release is a major version. Consequences to design for from
here on:

- **Do not reintroduce the "next pack".** A rule is shipped at the severity it
  is meant to have, in the pack where it belongs. A rule too noisy to ship
  strict is not shipped yet, it does not go into a parked opt-in pack.
- **Count the fleet before shipping a new rule.** The cost of a new warn rule is
  the number of apps that violate it. Run it over the fleet, read the count, and
  say it in the changeset. The fleet inventory in narduk-libs's strict-lint PR
  lists who depends on this package.
- **A warning is a failure.** `warn` still means "not a defect worth `error`
  severity in a rule's own documentation", but the gate no longer distinguishes
  them. A rule whose findings should not block a build is a rule to not ship, or
  to ship as a suggestion in an editor, not as a lint rule.

### What `narduk-lint` does now

- An **error** fails. A **warning**, from any rule, new or old, fails. ESLint's
  own unused-disable-directive warnings count. Every one is printed in the
  stylish format with a per-rule count.
- A **`lint-budget.json` that still allows warnings** (a rule count above 0, a
  `maxWarnings` above 0, or a malformed entry, which is not read as zero) fails
  with exit 1 and a message to fix those warnings and delete the entries. Its
  entries no longer permit anything. A file that allows nothing passes with a
  notice that it is obsolete. That was the simplest behavior that does not leave
  a budget quietly meaning something: delete the file when upgrading.
- **No file is ever written.** `--accept-new-rules`, recording, ratcheting,
  stamping and expiry are gone, so the "widening" defect (a local run raising a
  budget) cannot happen, and neither can the expiry-renewal tricks recorded
  below. `--accept-new-rules` and `--max-warnings` exit 2 with a message.
  `--ci`, `--local`, `--no-write` and `--verbose` are accepted and ignored so a
  lint script that passes them keeps running.
- `lint-budget.mjs` keeps its file name and its package export
  (`@narduk-enterprises/eslint-config/lint-budget`) to avoid breaking the `bin`
  and any importer, though it no longer holds a budget.
- The same contract applies to `narduk-stylelint`
  (`@narduk-enterprises/stylelint-config`, major bump): any warning fails, and a
  `stylelint-budget.json` that lists rule or file entries above 0 fails.

### The loophole this closes

`max-lines` (the `template` pack, `warn` at 200, 250 and 300 lines by surface)
yields one warning per file however large the file is. Under a budget, a file
already over the limit could keep growing and the count never moved. Now that
one warning fails the run, a file over the limit has to be split (or carry an
explicit `eslint-disable` with a reason that review sees) before anything
merges.

---

## History: warning budgets and the 2026-09 rules (recorded 2026-09-18)

_The budget subsections below ("Why budgets", "Total ceiling", "Entry expiry")
are superseded on 2026-10-01 by "Strict, no budgets" above. They describe
narduk-lint 2.x and are kept as the record of why it existed. The rule-specific
subsections after them ("Secrets rule choice" onward) still stand; where they
say a rule is "budgeted", read "a warning that now fails"._

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

### Total ceiling: `maxWarnings` (recorded 2026-09-27)

Per-rule budgets stop warnings from growing rule by rule, but nothing capped the
total, and a non-strict or hand-raised budget could hold any number of warnings.
Logan, 2026-09-27: "we also meed to re enable the o error o wRning rule
somewhere that got removed. it breaks apps i guess but thats ok we do them one
at a time not massive switch and if we cant do them one at a time then we deal
wifh it and fix one at a time as soon as we want to make a change" and "i guess
a max warnings of 10 or something would let us eek by in a fast turn around
pinch".

So `lint-budget.json` takes an optional `"maxWarnings": <non-negative integer>`:

- **Above the ceiling fails.** When the total warning count is above
  `maxWarnings`, the run exits 1, locally and in CI alike, whatever the per-rule
  entries allow. The output names the total, the ceiling and the count for each
  rule.
- **Nothing is recorded past it.** No run records new entries that would put the
  recorded total above the ceiling. That covers `--accept-new-rules` and a
  non-strict file's automatic recording. The run fails and names the entries it
  refused. Lowering and clearing entries still happen, so the file can only
  ratchet down.
- **A bad value is a configuration error** (exit 2): a negative number, a
  fraction, a string, `null` or a boolean.
- **Absent means no ceiling**, the behavior before this field existed. No
  consumer turns red on upgrade: the ceiling reaches an app only when its own
  budget file adds the field.
- **`--max-warnings` stays refused.** The ceiling lives in the budget file so
  one mechanism owns every warning limit. A flag could only restate it, or
  disagree with it.

How the two fields combine into the estate policy (errors always fail, zero
warnings, 10 at most in a pinch):

- `{"strict": true, "rules": {}}` already means zero warnings. Any warning is in
  a rule with no entry, and a strict file fails it.
- `{"strict": true, "maxWarnings": 10, "rules": {}}` keeps zero as the normal
  state and adds the pinch allowance. For a fast turnaround, a person runs
  `narduk-lint --accept-new-rules` and commits up to 10 recorded warnings in
  total, which review can see. The ceiling refuses an 11th, and the next change
  to that app pays the recorded ones down.
- `create-narduk-app` generates that file for new apps. Each existing app moves
  to `narduk-lint` with this budget in its next change, one app at a time, never
  as a fleet-wide switch. An app that cannot get under the ceiling straight away
  fixes its warnings one at a time, starting with that change.

### Entry expiry: 7 days (recorded 2026-09-28)

The ceiling capped how many warnings a budget could hold, but not for how long.
A pinch warning recorded with `--accept-new-rules` could sit in the file
forever. Logan was asked on 2026-09-28, "Lint warnings: keep what shipped, or
add expiring exceptions?", and answered "Add 7-day expiry", choosing the option
"Each warning over zero must be fixed within 7 days, cap 10 stays as backstop; I
build expiry into narduk-lint."

So every entry that allows a warning carries an expiry:

```json
{
  "strict": true,
  "maxWarnings": 10,
  "rules": { "no-console": 3 },
  "expires": { "no-console": "2026-10-05" }
}
```

- **Shape.** `expires` is a map beside `rules`, from rule id to a UTC calendar
  date (`YYYY-MM-DD`). `rules` stays a plain map of counts, so the counts read
  the same as before, and an older narduk-lint (2.6.0 and earlier), which
  ignores unknown keys, still reads the file. Key order is fixed: `strict`,
  `maxWarnings`, `rules`, `expires`, each map sorted. `expires` is left out when
  it is empty, so a budget with no entries serializes byte for byte as before. A
  rewrite with nothing new writes nothing, so it produces no diff.
- **Stamping.** Any path that records a new entry stamps it with the recording
  day plus 7: `--accept-new-rules`, and a non-strict file's automatic recording.
  An entry the `maxWarnings` ceiling refuses is never recorded, so it is never
  stamped. An entry of `0` allows no warnings and needs no expiry.
- **The date is the last day that passes.** An entry recorded on 2026-09-28
  expires on 2026-10-05, passes through that day (UTC), and fails from
  2026-10-06 00:00 UTC: the 8th day after the day it was recorded, not the 7th.
  The stamp is the record day plus 7, and the check fails only when today is
  later than it. Using the UTC date both to stamp and to check keeps the answer
  the same on a laptop in Central time and on a CI runner.
- **No renewal.** narduk-lint never moves an existing expiry. Re-running
  `--accept-new-rules`, a hand-raised count and a local ratchet that lowers the
  count all keep the original date. Only clearing the entry removes it: a
  whole-package run saw its count at zero, so the debt was paid. If that rule's
  warnings come back later, recording them again is new debt with a new date,
  which in a strict file again needs `--accept-new-rules`. That is the one route
  to a fresh date, and the next two rules keep a partial or broken run from
  taking it. The ways it can still be taken on purpose or by accident (hand
  edits, an older narduk-lint, ESLint config edits, a renamed rule) are listed
  under "Limits" below.
- **Only a whole-package run writes.** A run may lower, clear, record or stamp
  only when its working directory is the budget file's directory, compared on
  real paths (symlinks resolved, so `/tmp` and `/private/tmp` are one
  directory), every path argument resolves to that directory, and there is no
  `--ignore-pattern`. Every other run is narrowed: a subdirectory, a sibling or
  parent directory pointed at the budget with `--budget`, a budget spelled
  through a symlink from elsewhere, any other path, a glob, or `.` mixed with
  another path. So is a run whose budget file does not exist while a directory
  above it holds one: it is inside that budget's package, and writing would
  leave a stray non-strict budget in the subdirectory (that stray write predates
  expiry; it is closed here because the check is the same one). A narrowed run
  has not seen the whole package. Its counts are a lower bound, so an entry
  whose warnings live in files it skipped reads as zero. Before this rule, such
  a run cleared that entry, and the next full run recorded the rule again with a
  fresh date: `narduk-lint b.js` on a clean file, or a run from a sibling
  directory with `--budget ../pkg/lint-budget.json`, was enough to renew an
  expiry (adversarial verifies of narduk-libs#1237). Now a narrowed run writes
  nothing, reports no lowered or cleared entries, says so in one line, and
  refuses `--accept-new-rules` (exit 2). It still fails what it saw: errors, a
  rule over budget, an unbudgeted or undated entry in a strict file, and an
  expired entry. A lower bound can only under-report, so none of those is a
  false failure. The whole package is whatever ESLint's config lints from the
  package root. A package that must skip files puts them in its ESLint config,
  not in its lint script, and `scripts/lint-budget-strict.test.mjs` fails any
  workspace package whose `lint` script runs narduk-lint with a path,
  `--ignore-pattern`, a `--budget` in another directory, a directory-changing
  package-manager flag, or after a `cd`, however the call is prefixed
  (`pnpm exec`, `npx`, `cross-env`, an environment assignment,
  `node …/narduk-lint.mjs`, `package-quality.mjs lint`). The eleven packages
  that did (`src tests` and the like) were moved to plain `narduk-lint` in the
  same change; each gives the same verdict and the same per-rule counts, and the
  extra files are only config and build scripts.
- **A run with lint errors never writes.** A file that fails to parse reports an
  error and no warnings, so its entries would read as zero and be cleared
  exactly like a narrowed run's. The decision to fail is made before anything is
  written, and a run with any error writes nothing and says so. Other failures
  (a rule over budget, an expired or undated entry, the ceiling) come from
  complete counts, so they still ratchet down, as the ceiling has always
  promised.
- **Enforcement.** Once the date has passed, an entry that still has warnings
  fails, locally and in CI (`--ci` / `CI=true`) alike, with exit 1. The output
  names the rule, its count, the expiry and today's date, the top locations, and
  the fix: fix the warnings, run `narduk-lint` locally so the cleared entry
  leaves the file, and commit it. `--accept-new-rules` cannot rescue an expired
  entry. An expired entry with no warnings left passes: CI says it can be
  cleared, and a local run clears it. While an entry is live, every run prints
  what it owes and by when.
- **The ceiling is unchanged.** `maxWarnings` still caps the total and still
  refuses to record past itself. Expiry bounds how long a recorded warning may
  stay. The ceiling bounds how many there may be.
- **The clock is injectable.** `runNardukLint(argv, { now })` takes a
  `() => Date`, and every test passes a fixed one, so no test depends on the
  wall clock. There is no environment variable or flag for the date, so a CI job
  cannot turn the clock back.

**An entry with no expiry** is what a budget written by 2.6.0 or earlier holds.
It is treated exactly like a rule with no entry, because in both cases nobody
has agreed to a date yet:

- In a **strict** file it fails, locally and in CI, and nothing is written. The
  message gives the exact fix: fix the warnings, or start the 7-day clock on
  purpose with `narduk-lint --accept-new-rules` locally, which stamps today plus
  7 (the message prints the date) and leaves the change for review. A local
  ratchet still lowers or clears such an entry but does not stamp it.
- In a **non-strict** file, a local run stamps it, just as that run records an
  unbudgeted rule, and CI prints a notice asking for a local run and a commit. A
  non-strict file cannot gate a rule with no entry, so failing an entry with no
  date would gate less-recorded debt harder than unrecorded debt.

This was chosen over grandfathering. An entry left without a date would never
expire, which is the loophole Logan's answer closes. It was also chosen over
stamping silently on the first local run. That would start the clock with nobody
deciding to, and CI would have to pass unstamped entries until someone happened
to lint locally. Failing costs the consumer one deliberate command when it
upgrades, and that command is printed in full. The known consumers with entries:
this repository's own packages, which this change stamps in the same PR, and
been-sober-for (strict, one rule), which meets the message when it bumps
eslint-config. acre-oracle's budget is non-strict and empty.

Limits, stated so nobody relies on more:

- A person can still edit the file by hand, moving a date or deleting an
  `expires` key and re-running `--accept-new-rules`. That is the same standing
  as a hand-raised count: the diff shows it, and review should refuse it.
- **An older narduk-lint renews by accident.** eslint-config 2.6.0 and earlier
  know nothing of `expires`: they ignore the key when they read the file and
  drop it when they rewrite it (any local run that lowers, clears or records an
  entry). The next run of this version then finds entries with no date, and in a
  strict file its failure message offers `--accept-new-rules`, which stamps a
  new today + 7. A published 2.6.0 cannot be changed, so the guard is
  procedural: after pulling a change that bumps eslint-config, reinstall
  (`pnpm install`) before linting locally, and review should refuse a
  `lint-budget.json` diff that deletes `expires` keys while their entries stay.
- **ESLint config edits clear entries.** Ignoring files in the ESLint config, or
  turning a rule off, is a whole-package run's truth: the rule's count drops to
  zero and its entry (with its date) leaves the file. Turning the rule back on,
  or un-ignoring the files, brings the warnings back as new debt with a fresh
  today + 7. A strict file makes that a deliberate `--accept-new-rules`, and the
  config diff is in review, but nothing links the new entry to the old date.
- **A renamed rule is a new entry.** Entries are keyed by rule id. When a rule
  is renamed (a plugin major, or a move between plugins), the old entry clears
  and the new id is recorded with a fresh today + 7, carrying the same warnings.
  A strict file makes that a deliberate `--accept-new-rules`, so review sees the
  pair; nothing links the two ids automatically.
- Turbo caches `lint` by its inputs, and the date is not one of them. A cache
  hit replays the verdict of the run that produced it, so an unchanged package
  whose entry has expired fails on its next change or uncached run, not on the
  day it expires.

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
