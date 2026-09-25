---
'@narduk-enterprises/narduk-shell': minor
'@narduk-enterprises/eslint-config': patch
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/libs-explorer': patch
'@narduk-enterprises/create-narduk-app': patch
---

Add the marketing sections (components backlog item 21, narduk-libs#268):
`NeHero`, `NeFeatureGrid`, `NeCta` and `NeMarketingFooter`, thin themed wrappers
over Nuxt UI's `UPageHero`, `UPageGrid` + `UPageFeature`, `UPageCTA` and
`UFooter`. Each takes its primitive's own props and slots unchanged and adds only
the suite's token classes through the primitive's `ui` prop (the headline and
feature icons read `--ne-accent`, the CTA panel `--ne-radius-panel`, the footer a
`--ne-hairline` rule); a caller's `ui` merges after them and wins a conflict.
Their prop types are exported from the package root.

The eslint-config and narduk-app-tools shared-component lists name the four so
the drift and item-13 tests match `narduk-shell`'s registry. Explorer inventory,
catalog and usage ship beside the components.

`create-narduk-app` takes the patch because it pins `narduk-shell` in generated
apps; its `PACKAGE_VERSIONS` literal is not hand-edited (`versions:sync` re-pins
it at `release:version`). The generator's landing-page scaffold is not part of this change.
