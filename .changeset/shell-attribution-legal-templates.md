---
'@narduk-enterprises/narduk-shell': minor
'@narduk-enterprises/create-narduk-app': patch
---

Add `NeDataAttribution`, a consistent "Data from <source>, updated <time>" credit
driven by a structural `NeDataSource` (name, http(s)-only href, licence, publish
time) and formatted through `./format` with a required zone and a caller-supplied
`now`, and `NeLegalPage`, a legal-page layout with a formatted "Last updated"
date and a table of contents. `privacyPolicyTemplate()` and
`termsOfServiceTemplate()` return section structure whose every body is a marked
placeholder — no legal wording ships (narduk-libs#388, "Build, wording later").
A page stays a visible, `data-ne-legal-status="draft"` draft until the app sets
`wordingApproved` and no placeholder remains; `hasLegalPlaceholders()` lets an
app's own test guard the launch.
