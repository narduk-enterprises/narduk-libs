---
'@narduk-enterprises/narduk-app-tools': minor
---

narduk-app-tools: add the `foundation:check` command (D-WEBFOUND-2 Q5(a),
Q9(a)) — the app-owned half of the web-foundation contract, built against the
spec company-hq PR #631 merged at `docs/WEB-FOUNDATION-CHECK.md` and
`strategy/web-foundation-libs-plan.md` §4.

`foundation:check` evaluates all seven §4 items from inside an app's own
checkout and CI, and writes a `foundation-check.json` artefact that
`company-hq/scripts/check-web-foundation.py`'s weekly rollup accepts as-is
(exact schema, `CONTRACT_ITEMS` naming, and the item-7 `not-applicable`
invariant all mirror the rollup's own `validate_artefact()`). Exit code 0 =
PASS, 1 = FAIL, 2 = UNKNOWN (CI must treat unknown as a failing gate too — no
warning tier, per D-WEBFOUND-2 Q9(a)).

Unlike the rollup, this command owns four sub-checks the rollup can only
report `unknown` for, because they need the real checkout or a live registry
read that a cross-repo weekly scan does not have:

- 1.1 — resolves the actual Nitro preset from `.output/nitro.json` or
  `nuxt.config.*` when `Config/cloudflare-app.json` doesn't declare one.
- 2.3 — the narduk-core N-1 support window (D-PKG-2), by resolving the
  installed major against the live published major.
- item 3 in full — the five capability-package checks (auth, seo/analytics,
  uploads, status-runtime, no unauthorised chart/map dependency), gated on
  the real `access.exposureClass` and binding config.
- 4.2 — a whitespace-normalised content-hash scan against a `narduk-libs#76`
  Wave-1 fork fingerprint list, so a locally-vendored copy of package-owned
  behaviour is caught by content, not by path.
- P7 — eslint-config's "v2" requirement is checked against the *resolved*
  installed major, not the manifest's pin string.

Ships as `src/foundation/**` (schema, roll-up, per-item evaluators, an
injectable `RegistryReality` for the live npm/GitHub-Packages read) and
`src/commands/foundation-check.ts` (`--checkout <dir>`, `--json [path]`),
wired into `narduk-app foundation:check` in `src/cli.ts`. Full test suite
under `tests/foundation/**` proves every sub-check in both directions with
seeded-lie fixtures (a fixture that passes is mutated one fact at a time
until it fails, and back).

The shared CI callable step in the `workflows` repo that runs this command
and uploads its artefact is out of scope for this change; see the follow-up
noted on company-hq#628.

Part of company-hq#628.
