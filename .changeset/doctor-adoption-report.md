---
'@narduk-enterprises/narduk-app-tools': minor
---

feat(narduk-app-tools): `doctor --adoption` reports the fifteen adoption
requirements

The narduk-app adoption standard (company-hq#746) asks fifteen questions of an
app. Six CLI commands already answered twelve of the web-foundation contract's
items, but nothing assembled them into the thing a sign-off actually needs: one
artefact, per requirement, that says what was checked, what the verdict is, what
the evidence was, and **who decides the part no command can**.

`narduk-app doctor --adoption` is that artefact. It composes the existing checks
rather than reimplementing them — `foundation:check`, `:shared-ui-pinned`,
`:coverage`, `:security-headers`, `:toolchain`, `:deployment` — and adds the two
evaluators nothing owned:

**Requirement 2, package currency.** Every consumed estate package must be
exact-pinned at the latest published stable release, every manifest that pins it
must agree, and the installed version must be the declared one. Four failures
hide behind "the dependencies are fine": a range spec, two manifests in one
workspace pinning different versions (the normal shape of a generated app, with
the app's own dependencies in `apps/web`, and the normal way the two fall out of
step), a pin behind the registry, and a pin that matches the registry while
`node_modules` holds something else. `foundation:check:shared-ui-pinned` already
refuses a non-exact pin, but only for the shared-UI packages and only on
exactness; currency is a different claim over a wider set.

**Requirement 9, MapKit provenance.** "The app installed a package called
mapkit" is not "the app consumes the maintained one", and four stale shapes look
identical from a dependency list: a standalone-era package name, a vendored copy
a lockfile resolves happily, a `file:`/tarball specifier, and the frozen
`narduk-mapkit-nuxt` adapter pinned at 2.0.x — which leaves a Nuxt app on a
supported package and an unsupported entry at once.

**What it refuses to claim.** Every requirement carries the tier it was actually
decided at: `enforced`, `partially-enforced`, or `manual`. A `manual`
requirement reports `unknown`, names its owner, and appears in `manualReview`;
there is no flag that turns one into a pass. The top-level `result` is the
verdict over the machine-decidable requirements only, so a PASS can never be
read as proving more than was checked. Requirement 9 never says the map works —
that is real-SDK browser evidence, and inferring it from a dependency line would
be the false capability claim the standard forbids.

Item 12 reports `not-applicable` for two different facts, and this report keeps
them apart: an app with no `deployment` block is `unknown` (rollout mode's N/A
is right for a rollout gate and wrong for a declaration — nobody wrote the
delivery path down), while an app declaring a different standard is the
`deviation` verdict.

**The seven-item artefact is untouched.** `foundation:check` emits exactly the
document its consumers already parse, bare `doctor` keeps its output and exit
code, and this is a separate artefact with its own tool name and schema.

Exit codes follow the existing convention — `0` PASS, `1` FAIL, `2` UNKNOWN, the
last including every run given no `--live`, since three requirements are
questions only a deployed origin can answer — and add `3` DEVIATION. An app
declaring a different deployment standard is not failing the standard, but it
has not adopted it either; exiting `0` would let an automation reading the exit
code as "adopted narduk-v1" read a declared departure as adoption.
