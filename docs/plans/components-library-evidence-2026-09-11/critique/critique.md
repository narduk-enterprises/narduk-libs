# Adversarial review — `docs/plans/components-library-plan.md`

Read-only, 2026-09-11. **3 BLOCKER · 10 MAJOR · 8 MINOR.** Paths relative to the
worktree root. Verified correct (12+ spot checks):
`narduk-core/src/module.ts:544-547` `addComponentsDir({pathPrefix:false})`;
`create-narduk-app/src/generate.ts:528` pack list; `manifest.ts` pins no
narduk-ui/narduk-charts; L0 55/5/5/45 inventory; §3a transcribes merged §2
row-for-row; 71 surfaces / 15 apps sums; "41 list-UI defects" = 28+5+5+3; stonx
formatters 690/21/134; operator-portal 421 LOC / 17 consumers / 647 LOC e2e;
pacc-trac's 20 `{rows,total,limit,offset}` routes; the 9 legacy-layer apps; the
4 zero-pin apps.

## BLOCKER

**B1 — "Every app gets it for free" is false under a rule ratified seven days
ago.** §1/§4a/§4d rest on "a Nuxt module so every app gets it for free".
`company-hq/strategy/web-foundation-libs-plan.md:307` — "all
`@narduk-enterprises/*` pins exact" — is a `foundation:check` **failure** per
D-WEBFOUND-2 Q9(a) (`company-hq/DECISIONS.md` § 2026-09-04), and
`manifest.ts:6-17` already pins exactly. The family reaches an app only via a
bump PR _in that app_ — 29 of them. That is the exact friction the plan blames
for `AppEmptyState`'s zero adoption. _Fix:_ name the real mechanism (Renovate
`@narduk-enterprises/**` grouping, §4 item 5) plus a bump wave, and make "family
pinned" a `foundation:check` item — module registration is not adoption.

**B2 — Every Q1 option amends a decided call, while the preamble says it reopens
none.** D-WEBFOUND-2 Q2(a) ratified `design/` membership by name (narduk-ui,
narduk-shell, status-runtime, charts); Q3(a) ratified narduk-ui + narduk-shell
as _the_ coded design system. Q1(b) adds a fifth `design/` package; Q1(c) puts
design-system components in `modules/`; Q1(a) requires rewriting §4 item 3
(`web-foundation-libs-plan.md:316`, "narduk-ui + status-runtime **on status
apps**") to "on every app" — frozen by Q9. _Fix:_ declare Q1 a D-WEBFOUND-2
amendment, name the ratified line each option edits, route the answer to a dated
`DECISIONS.md` amendment.

**B3 — Wave 1's done-when cannot be run in wave 1.** §6 gates on "`NeDataTable`
**in server mode** passes the ported operator-portal mobile specs … and the
scale test". `lanes/L6/operator-portal.json` `patterns.table[0]`:
`server_api: "none (app is read-model-driven … no page/limit/cursor/sort query params)"`,
`paginated:"none"`, `searchable:false`. The D-WEBFOUND-2 Q4 first consumer has
no server list route. Separately, AGENTS.md's data-path contract demands the
scaling shape be proven _in the target repository_ — which does not exist until
the wave-2 pilots. _Fix:_ wave 1 proves client mode + the reflow specs; server
mode and the scale test become pacc-trac/stonx gates in wave 2.

## MAJOR

**M1 — Undisclosed cross-pattern double counting inflates the headline adoption
number.** 54 files are classified under 2–7 patterns each (scan of
`lanes/L*/*.json` `patterns.*[].path`): `bluebonnet AdminObservations.vue` (7),
`lakestat lakes/index.vue` (5), `papa-everetts admin/index.vue` 802 LOC (4).
§3's "what the numbers license" paragraph names three caveats, not this one.
§4a's `format` row ("26 formatter files, 419 consumers" = 18+8 and 208+211)
counts five shared files **twice**: stonx `utils/formatters.ts` 690 LOC/134
consumers, harvest `almanac-format.ts` 321/48, pacc-trac `format.ts` 69/8,
riverstatus `riverstatus.ts` 252/1, lakestat `lakestat-format.ts`. Distinct ≈
**21 files, ~228 consumers** — cited figure ~45% high. _Fix:_ recompute every
cross-pattern sum on distinct paths; add the caveat.

**M2 — "≈5.8k LOC deletable by a table component" includes 1,150 LOC that is not
table work.** `lanes/L5/papa-everetts-pizza.json` files two `pattern:"table"`
candidates that are existing-package adoption: "Admin analytics panel trio
(already exist in narduk-analytics)" `loc_saved_estimate:900` and
"AdminUsersTab-equivalent (already exists in narduk-auth)" `250`.
harvest-tracker LedgerTable claims `saved:823` on a 278-LOC file. _Fix:_ restate
as "≈4.6k table LOC, plus ≈1.2k that adopting existing packages removes
independently".

**M3 — Q2(b)'s stated blocker does not exist.** §7 Q2(b) says a semantic
`<table>` "needs a library exemption from the estate's raw-`<table>` lint ban".
The ban is `eslint-config/configs/design-system.mjs:88` and applies only to apps
selecting the `design-system` pack; narduk-libs' own `eslint.config.mjs:4`
composes `('core','correctness','complexity','formatting')` and narduk-ui has no
override. No exemption needed — (b)'s real cost is reimplementing TanStack.

**M4 — The default mobile mode rests on an exemplar its own record
contradicts.** §4b makes `mobile:'reflow'` the default for 71 surfaces citing
operator-portal, but `lanes/L6/operator-portal.json` `patterns.table[0].mobile`
is `"cards"` (merged.md §3 line 137 transcribes `cards`); only the lane prose
(`lanes/L6/operator-portal.md:24,29`) says reflow. _Fix:_ re-verify
`CollectionTable.vue:18-25` live before Q2 — §3b's "five mobile strategies"
depends on the same field.

**M5 — No `@nuxt/ui` peer range, against a fleet spanning 4.3.0 → 4.11.0.**
merged.md §1: austin ^4.3.0, circuit-breaker 4.5.0, papa 4.6.0, stonx ~4.7.1,
pacc-trac ^4.9.0, farm-analytics 4.10.0, nvault 4.11.0 — while
`narduk-core/package.json` pins `@nuxt/ui` at exact `4.6.0`. `UTable`'s header
API already cost stonx#39 and stonx#313 (`lanes/L3/stonx.json` defect_history);
a wrapper inherits that churn fleet-wide. _Fix:_ wave-1 done-when names a
minimum and a tested support range.

**M6 — The reliability claim over-reads a title-keyword bucket.** §3 discloses
the method ("40-issue + 40-PR keyword search per repo, titles only"); §6 then
claims "six of seven classes removed by construction". Of the eight `table`
defects merged.md §6 shows, ≥4 are not list-UI: circuit-breaker#22 (unguarded
`JSON.parse`), bluebonnet#6 (`Date.now()` primary key), buoys#8 (D1 retention),
pacc-trac#935 (data gap). _Fix:_ hand-classify the 41, or restate as "41
keyword-matched issues, of which N confirmed".

**M7 — `useCollection` is measured against the wrong half of the data-path
contract.** §4b names single-flight, coalescing, stale-scope cancellation,
debounce, clamp-on-mutation, pageSize ceiling. AGENTS.md also requires inactive
pauses, mutation-triggered refreshes merged with scheduled ones, correctness
parity, a stress case, rollback thresholds tied to exact code and environment,
and truth preserved across authorization/tenant boundaries and the
missing/stale/unknown/proven-zero states — none appear. The promised "statement
ceiling" is owned by `parseListQuery`/`listResponse` (C1, server side), not a
client composable. _Fix:_ move the obligations onto C1 and enumerate the six
gaps in C3's done-when.

**M8 — Q1(a) destroys narduk-ui's posture and can silently ship an empty
tarball.** `packages/design/narduk-ui/package.json`: no `dependencies`,
`peerDependencies` is `vue` only, `"build":"pnpm run typecheck"`, and `files` is
an allowlist (`tokens.css`, `instruments`, `_core`, `README.md`). Adding
`/collections`, `/feedback`, `/format`, `/nuxt` means `@nuxt/kit` + `@nuxt/ui`
deps in a package whose guardrail 1 (README:21-26) makes `/core` deliberately
Vue-free, plus new `files` entries or the tarball omits the outputs while CI
stays green. And `0.1.2 → 0.2.0` does **not** satisfy a `^0.1.2` range. _Fix:_
name the deps, the `files` change, the fixture assertion, and the semver break
in C0.

**M9 — The proposed lint rule contradicts the pack that ships today.**
`design-system.mjs:88` errors on `<table>` ("Use `<UTable>`"); §4d.2's
`narduk/prefer-shared-collection` warns on `<UTable>` toward `NeDataTable`. An
app with both packs and no family pin has no satisfiable markup. _Fix:_ gate the
new rule on the family being a dependency.

**M10 — Normative bullets ship without enforcement declarations.** §4d.1–3 carry
`<!-- enforcement: none yet -->`; §4d.4/.5/.6, all of §4b's contract bullets,
and §4c's "unknown query keys are rejected" / "`limit` is always present" carry
none. AGENTS.md § Policy enforcement declarations requires one line or all four
labels per policy statement. Inconsistency inside one section reads as
oversight, not exemption.

## MINOR

- §10 says "34 JSON + 34 Markdown"; 35 of each exist
  (`ls lanes/L*/*.json | wc -l`).
- §3a headers "29 Nuxt apps" over a table merged.md §2 computed across "30 Nuxt
  apps". Say which.
- `narduk-libs#224` (§3c) appears nowhere in the evidence or repo. §4d.3/§8 cite
  `company-hq#628` while `lanes/L4/tprinvest.json:152` names `company-hq#629` as
  parent. Resolve before filing.
- §8 gives labels only for the narduk-libs umbrella row, and asserts rather than
  discovers them; AGENTS.md § Issue labels wants per-repo `gh label list` labels
  on all 13 rows. Add filed URLs back, as Q8 required of §8 there.
- `Ne` pre-empts D-WEBFOUND-2 Q7(a) (renames parked): a sixth first-class prefix
  (`U*`/`App*`/`Ns*`/`Narduk*`/`Layer*`/`Ne*`) is a call the parked pass would
  make. Mark it provisional.
- §3c's "delete, don't extract" lists austin-texas-net `app/MapKit.vue` (915
  LOC); merged.md §4 records **11 consumers** — an active shadow, not dead code.
- §3c says pacc-trac PR #774 "tried and did not finish"; merged.md §6 records it
  `[merged]`, title only.
- §3d's adoption list omits `AuthLoginCard` (2 uses / 2 repos),
  `AuthRegisterCard`, `AppLightbox`, `LayerNetworkFooter`, `NardukPieChart`,
  `NardukCandleChart` (merged.md §8) — material, since §3c argues the Auth\*
  copies are dead.

## Design challenge — strongest case against each recommendation, and the missing option

- **Q1(a) against:** makes the estate's one framework-free, zero-dep package
  depend on Nuxt and Nuxt UI, couples the status instruments' release train to
  app-tier churn (guardrail 2, README:27-30 — accepted, but at 0.x every release
  is a breaking range bump for the status apps), and forces the ratified
  status-apps scope open. **Missing (d): put the family in `narduk-shell`** —
  the other half of the coded system under Q3, already the `--ui-*` token bridge
  in §4d.6 — leaving narduk-ui framework-free and status-scoped. The plan treats
  shell only as wave-4 layout and never considers it as the home.
- **Q2(a) against:** forces the estate's single a11y-reviewed, 647-LOC-tested
  implementation (operator-portal, deliberately raw-`<table>`) onto a foundation
  it avoided; (b)'s claimed lint cost is fictional (M3); and it buys UTable's
  API churn for 71 surfaces at once (M5). **Missing (d): headless first** — ship
  `useCollection` + `defineColumns` + `NePager` + `NeFilterBar` with **no
  renderer**. Every defect class §6 claims lives in state/query logic, none in
  markup; this captures them at a fraction of wave 1 and defers the renderer
  until pilots have a column model in production.
- **Q3(a) against:** the response envelope causes no defects. Every list defect
  in the corpus — stonx#188 (negative limit), #208 (unbounded limit, unchecked
  sort columns), #251 (clamp), mybo#14 (unbounded bytes), every "Unbounded" row
  in §3b — is a **query-parsing** failure. Unifying 40 routes' envelopes is
  large churn for zero measured defect reduction, and `useCollection({adapter})`
  makes it optional forever. **Missing (d):** standardize the query half only —
  the only half `foundation:check` and `require-limit-on-drizzle-list-queries`
  can gate.
- **Q4(a) against:** front-loads the most expensive, least-certain output.
  **Missing (d): `format` + `feedback` first, collections in wave 2** —
  framework-light, no server dependency, highest distinct consumer counts (≈228
  formatter + 133 empty-state + 161 chip), and it proves the §4d adoption
  machinery (the plan's own risk #1) on cheap components before the table bets
  on it.

## Sequencing, cost, and rejection risk

Wave 1 (C3+C4+C5, "2–3 weeks") asks for 6 components + a composable +
`defineColumns` + 2 ESLint rules + generator packs/pin/scaffold + 2
`foundation:check` items + NE Base cards + the surface-check script, each
component needing README + mount test + SSR test + card under §4d.1. narduk-libs
has produced **5 documented and 5 mount-tested components in its entire life**
(L0 §1). `NeDataTable` alone is 11 column types × 4 mobile modes × 2 data modes
× 5 render states, a strict superset of the best prior art (operator-portal: 421
LOC, 647 LOC of tests, **zero** sort/page/search). _Fix:_ wave 1a = C3 table +
pager + `useCollection`; wave 1b = C4 + C5.

Missing from the done-when entirely: any wave-0 gate; the `@nuxt/ui` support
range; the consumer-fixture proof that new subpath exports actually publish; an
axe threshold (C3 mentions a baseline, §6 does not gate it); the Workers/SSR
render; an expiry on C4's N-1 `App*` aliases; a bundle-size budget; rollback
thresholds; and any owner, date, or issue number.

**Rejection risks, ranked:** (1) Q1 is put as an open question when two of three
options edit a decision Logan ratified on 2026-09-04 and the plan says it
reopens nothing (B2); (2) the adoption story contradicts the exact-pin rule from
the same packet (B1); (3) the two numbers he will quote — "≈10k LOC deletable",
"419 formatter consumers" — are both inflated (M1, M2); (4) no cost in
engineer-days, no owner, no dates; (5) wave 1's gate cannot be run in wave 1
(B3).
