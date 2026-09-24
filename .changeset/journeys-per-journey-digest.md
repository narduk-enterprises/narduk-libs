---
'@narduk-enterprises/journeys': patch
---

The declaration digest that promotion and walkthrough compare is now per
journey (`digestJourney`, recorded as `journeyDigest` on each run). Adding a
sibling journey — or any other file under the catalog directory — no longer
invalidates every promoted capture (narduk-libs#66). The catalog-wide
`digestDirectory` / `declarationDigest` path remains for manifests written
before this field existed. **Not digest-changing** for those older captures
until the catalog directory itself moves; a recapture writes `journeyDigest`
and is then isolated from sibling drift.
