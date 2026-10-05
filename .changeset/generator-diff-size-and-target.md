---
'@narduk-enterprises/create-narduk-app': patch
---

Count upgrade summary additions and removals using the same line matching as
the displayed diff, so small comment changes no longer look like full rewrites.

Stop writing the inferred deployment target into the build environment. The
pinned narduk-seo release resolves its own target; fresh apps still preserve an
explicit target and infer production or preview for their site/runtime settings.
