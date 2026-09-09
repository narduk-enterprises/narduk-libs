# Coded design-system previews

Run `pnpm design-system:build` from the workspace root. This private build tool
prerenders a Nuxt gallery of the actual `narduk-ui` Vue instruments and four
explicitly configured Nuxt UI component families, then extracts static HTML
cards and the compiled CSS into `dist/design-system/` in this package.

Open `dist/design-system/index.html`. Each card carries an `@dsCard` marker and
links to `tokens.css` (only the coded `--ns-*` custom properties, with their
selectors and media/layer context) and `styles.css` (compiled Tailwind, Nuxt UI
and component rules). `_ds_manifest.json` lists both in load order.
`build-manifest.json` records package versions, input hashes, output hashes and
component coverage derived from the Vue tags in each gallery section. Rebuilding
the same source and lockfile produces identical bytes. Source data uses fixed
demonstration values. No production services or remote fonts are needed.

The gallery has no product `data-app` scope, so instruments use their coded base
fallbacks instead of a hard-coded Lakestat accent. The coded
`narduk-ui/tokens.css` and compiled component styles are authoritative. This
tool never reads canvas exports, emits React, publishes a package, or contacts
Claude Design. The fixtures are authored Vue examples; the HTML and token bundle
are generated.

`narduk-shell` has not yet landed in this repository. The manifest reports that
gap. Nuxt UI cards demonstrate the gallery's blue/slate baseline configuration,
not every app's overrides. Extend the Vue gallery with real implemented
components and their actual configuration as coverage grows.

The generated manifest describes this bundle only. It is not a replacement for
an existing NE Base project's complete manifest: preserve legacy templates and
unrelated cards when preparing a supported DesignSync update. The
[`design-system-build` skill in agent-infrastructure](https://github.com/narduk-enterprises/agent-infrastructure/pull/1343)
is delivered by the companion PR. Its `design_bundle.py prepare-system-update`
command stages a merged manifest and content-addressed preview paths while
preserving every existing template, card and unknown manifest field. That staged
directory is the `finalize_plan.localDir` for a requested DesignSync push;
`write_files` uses its local paths. Building here alone does not upload
anything.

Validation: `pnpm --filter @narduk-enterprises/design-system-build typecheck`,
`lint`, `test:unit` and `build`. The package is private and has no publishing
contract.
