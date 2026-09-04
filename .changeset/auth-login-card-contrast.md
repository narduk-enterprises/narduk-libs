---
'@narduk-enterprises/narduk-auth': patch
---

narduk-auth: fix WCAG AA colour-contrast failure on the `/login` auth card's
subtitle, "Forgot your password?" link, and footer text.

`AuthLoginCard.vue` rendered those three lines with Nuxt UI's `text-muted`
utility, which resolves to `neutral-500` (light) / `neutral-400` (dark) — a
pairing Nuxt UI only guarantees against its own default `--ui-bg` (white in
light mode). Consuming apps are free to repoint `--ui-bg` at a different
"default" surface, as operator-portal does (`app/assets/css/tokens.css`:
`--ui-bg: var(--op-ground)`, `#edf0f4`). Against that background `neutral-500`
measures 4.17:1 — below the 4.5:1 floor, matching the 4.16:1 axe found on
operator-portal's `/login` (narduk-enterprises/operator-portal#238,
`tests/e2e/accessibility-baseline.json`).

Swapped `text-muted` for Nuxt UI's `text-toned` (`neutral-600` light /
`neutral-300` dark) on all three lines — still a muted, secondary ink, but with
headroom to clear 4.5:1 against both Nuxt UI's own default background and
operator-portal's `#edf0f4` ground, in both themes. The fix stays local to
narduk-auth: `text-muted` is a Nuxt UI framework default, not a value the
narduk-ui design-token layer (`packages/design/narduk-ui/tokens.css`) defines or
owns, so a token-layer edit would not have touched this component and would have
rippled into unrelated narduk-ui consumers for no benefit.

Added a deterministic, browser-free unit test
(`tests/auth-login-card-contrast.test.ts`) that computes the WCAG contrast ratio
from Tailwind's own oklch colour definitions and asserts the fix clears 4.5:1 in
both themes, including against the exact background that exposed the bug — so
this cannot regress silently.

Refs narduk-enterprises/operator-portal#238
