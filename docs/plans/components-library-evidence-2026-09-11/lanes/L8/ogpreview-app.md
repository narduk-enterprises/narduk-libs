# ogpreview-app — component-usage survey (lane L8)

SHA `8ad74565` (main). App dir: `apps/web` (71 .vue files: 42 components, 26
pages, 1 layout, app.vue, error.vue). **Legacy template layer** consumer:
`narduk-nuxt-template-layer-{core,seo,analytics,testing} @^1.18.x`, plus one
contracts-only package `narduk-platform@^1.28.25` (types/schemas, not UI).
Public product: an Open Graph / social-card preview simulator
(Discord/Facebook/IMessage/LinkedIn/Slack/Telegram/Twitter/ WhatsApp mockups) —
functionally adjacent to but distinct from narduk-seo's admin-facing
OgImagePreviewLab.

## Most reusable hand-rolled things (path, LOC, consumers, what a shared version must cover)

1. **`apps/web/app/pages/what-is-open-graph.vue` lines 236-267** — a genuine
   native `<table>` for an editorial comparison table, with an explicit
   `<!-- eslint-disable narduk/no-native-table -->` comment at line 236.
   **Cross-cutting finding**: this proves a narduk-libs eslint rule named
   `narduk/no-native-table` actively discourages bare `<table>` elements
   estate-wide, with an escape hatch for genuinely tabular content. This almost
   certainly explains why zero other component across this entire 6-repo lane
   used a literal `<table>` without either avoiding it (div-grid/card patterns
   everywhere) or explicitly disabling the rule. Flagged for the orchestrator
   and the L0 narduk-libs lane — a new shared table component's own markup needs
   to satisfy or be exempted from this rule.
2. `apps/web/app/components/url-history/Modal.vue` — 176 LOC. Line 33: "clear
   all history" uses the **browser-native `window.confirm()`** dialog rather
   than any styled modal — a worse AppConfirmModal gap than anything else seen
   in this lane (every other repo at least hand-rolls a styled confirm).
3. `apps/web/app/components/url-history/Quick.vue` — 73 LOC. Clean "recent
   items" chip list sourced from a `useUrlHistory` composable
   (localStorage-backed); `v-if` hidden entirely when empty rather than showing
   an explicit empty state.
4. `apps/web/app/components/o-g-preview/*` — 9 platform-specific social-card
   mockup renderers, 819 LOC total (Discord 101, Facebook 97, IMessage 75,
   LinkedIn 99, Slack 105, Sponsored 29, Telegram 113, Twitter 118, WhatsApp
   82). This is the app's core differentiating product, not a shared-library
   extraction candidate.
5. `apps/web/app/components/layouts/{Article,Content,Simple}Layout.vue` — three
   custom layout wrappers, not narduk-core's `dashboard`/`landing` layouts (app
   has no narduk-core dependency, only the legacy layer).
6. `apps/web/app/components/share/Button.vue` — share/copy-link button; overlaps
   narduk-core's `AppShareButtons`/`AppCopyButton`.

## Table story

Effectively none as a UI pattern — the one `<table>` found is static editorial
content in an article page, not data-driven. No server list contracts, no
pagination, no sort. The URL-input flow (`sections/UrlInputSection.vue`,
`sections/PreviewInputCard.vue`) is this app's closest thing to a filter/search
bar, but it drives a single preview fetch, not a list.

## What has broken (evidence: `gh issue/pr list --repo narduk-enterprises/ogpreview-app`)

- Issue #16 (open) "Duplicate footer on preview pages: `app.vue` inline footer
  and `AppFooter.vue` both render on the same page" — a real shell/layout
  defect.
- Issue #13 (open) "SSR hydration mismatch from `Date.now()` in `useUnfurl`
  `cacheBustToken` initial value."
- Issue #8 (open) "replace runtime `new Date()` in SSR render paths with static
  values" — same hydration class of bug.
- Issue #12 (open) "Broken structured data and garbled title on two guide
  pages."
- No table/pagination/mobile-specific defects (consistent with having no table
  UI).

## Surprise

The standout finding here isn't table-shaped: it's `narduk/no-native-table`, an
eslint rule surfaced by the one `eslint-disable` comment in this repo. It's the
best explanation found anywhere in this lane for why six different apps, several
with genuinely list-shaped data, never once reached for a plain `<table>` —
they're being steered toward div-grid/card patterns by lint, not by the absence
of a shared table component. Worth confirming its exact scope with the L0
(narduk-libs internal) lane.
