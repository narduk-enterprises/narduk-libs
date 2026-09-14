# MapKit consolidation plan — recovered review dispositions

Reviewed artifact: `docs/plans/mapkit-consolidation-plan.md`, PR #303. The
recovered Claude adversarial report reviewed `29126a1`; this continuation
compared all findings against the handed-off head `887929a` and the revised plan
on 2026-09-14. The review had completed. This is a disposition and scoped
verification record, not a claim that the old reviewer reviewed the new head. No
package or consumer implementation is part of this PR.

| Finding                                                                     | Disposition        | Resolution and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1 — crossfade default change mislabeled additive (major)                   | disposition: fixed | §6 explicitly identifies the behavior correction. D3 records Logan's “Lets do an aggressive move” response to the release-behavior choices, interpreted as v6 plus the clock repair in 3.0.0. `runtime.ts:275,308` and `timers.ts:53-57` confirm the epoch/rAF mismatch. W1 requires progress/completion, cancellation, native rAF, fallback with/without performance, injected pairs, and registry integration tests; changing only `now` would leave the fallback incoherent. |
| R2 — capability #18 absent from W1 (major)                                  | disposition: fixed | W1 explicitly schedules **#18 map type** and assigns all 28 capabilities to the consolidation release. The unrelated standalone issue #18 remains capability #2.                                                                                                                                                                                                                                                                                                                |
| R3 — MapKit allegedly offers only singular overlay add/remove (major)       | disposition: fixed | Apple's [tileOverlays documentation](https://developer.apple.com/documentation/mapkitjs/map/tileoverlays), fetched 2026-09-14, declares a getter and setter. The two-method limitation belongs to our `MapKitLayerMapHandle` in `layers.ts:58-59`. §6 #2 compares optional array reassignment with bounded remove/re-add while preserving unmanaged/fading overlays and existing structural handles. Browser proof of ordering is still an implementation gate.                 |
| R4 — D-NAME-1 misapplied to npm names (moderate)                            | disposition: fixed | §7 now states that D-NAME-1 explicitly excludes package names. Company-hq `DECISIONS.md` D-WEBFOUND-2 Q7 parks repository renames until folds land. §9.3 says deletion would moot the standalone rename target, not fulfill it or change other parked renames.                                                                                                                                                                                                                  |
| R5 — missing vtraceroute in adapter roster (moderate)                       | disposition: fixed | Added vtraceroute to §5.3's component consumer row, consistent with §5.4.                                                                                                                                                                                                                                                                                                                                                                                                       |
| R6 — deletion silently depends on unanswered family-location choice (minor) | disposition: fixed | D4 is recorded verbatim, W2.10 explicitly schedules the risk exception, and §9.3 item 4 requires observed migration and package-link proof before deletion. Scheduling the bump is not proof of its completion.                                                                                                                                                                                                                                                                 |
| R7 — swapped core type line numbers (minor)                                 | disposition: fixed | §5.4 now pairs `MapKitGeoJSONFeatureV2` with `types.ts:203` and `MapKitOverlayStyle` with `types.ts:25`.                                                                                                                                                                                                                                                                                                                                                                        |
| R8 — MutationObserver citation (minor)                                      | disposition: fixed | The prior §5.0 wording accurately described the class-list read at 907–912; the review paraphrased it as observer construction. Added explicit observer declaration/construction lines 905/920, preserving that distinction and matching §5.5.                                                                                                                                                                                                                                  |
| R9 — unshipped rate-limit example called unique (minor)                     | disposition: fixed | §5.0 acknowledges the shipped README hook example at 258–274 and identifies the playground middleware as an unshipped standalone example. Removed the similar uniqueness overstatement from farm-analytics' inventory row.                                                                                                                                                                                                                                                      |

The complete historical report also identified three documentation
uncertainties:

- **GitHub Packages after linked repository deletion:** still TBC. §9.3 item 4
  requires ownership/link evidence and replacement installability, plus all
  exact-2.0.0 consumers moving. No deletion is authorized by this plan PR.
- **Wiki fate/recovery after deletion:** still TBC. The historical survey found
  no wiki pages, but that does not prove general recovery semantics. §9.3 item 2
  does not treat wiki recovery as preservation.
- **Cross-repository backlinks after deletion:** still TBC. §9.3 item 2 requires
  recording the thread-export decision; W0.1 copies the ordering requirement
  into the owning repository rather than relying on the old backlink.

The recovered report confirmed the scope/library-first citations, fold tracker
semantics, manifest/env-catalog citations, package repository metadata, most
core/adapter references, and the previously surveyed Apple/Cloudflare API
capabilities. Those remain dated survey evidence, subject to the live
reverification requirements in §13; this continuation did not re-run that audit.

Additional consistency corrections made during reconciliation:

- Limit completion and dependency scans to scheduled MapKit consumers; preserve
  W4 exceptions and product-owned rendering. Core-only consumers do not acquire
  a Nuxt adapter just to satisfy a version-equality check.
- Remove the contradiction between “all capabilities migrate” and unnamed rows
  slipping into 2.2.0. All 28 have W1 ownership. Early token-risk patch PRs may
  proceed independently, with lockfiles and consumer proof.
- Move harvest-tracker's single-image placement onto capability #24, rather than
  describing it as a tile-registry migration. Preserve the cell baker.
- Reuse the annotation registry's existing `update()` hook for position changes;
  add movement threshold/fingerprint behavior rather than claiming no hook
  exists.
- Correct the layer/adapter exposed-method comparison and distinguish the
  current narduk-shell surface check from the MapKit-specific check planned for
  W1.
- Record D1–D4 and the additional no-React direction verbatim in §12. Fixed
  versioning survives; D3 changes the first consolidation release from the
  proposed 2.1.0 to 3.0.0. No React dependency, peer, wrapper, export or
  package.
- Require default-v6 consumer validation, explicit-v5 compatibility fixtures,
  paired-clock proof and rollback package/lockfile pins for the major release.
- Keep the freeze, incubator boundary and company-hq #741 deletion
  prerequisites. Symbol inventory is not behavioral parity or proof that
  deletion is safe.

Validation of this document revision is reported on PR #303 for its exact head.
The final PR gate is separate from this review record and from future W0–W4
implementation/release gates.
