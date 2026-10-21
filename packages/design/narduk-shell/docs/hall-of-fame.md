# Hall of fame sections

Three reusable patterns from designs Logan liked. The source apps remain
unchanged; adoption follows package publication. All examples are illustrative,
with no live feed or promise of freshness. Use one hero per page.

## Picks and provenance

- **NeSettle — PACC·TRAC.** The small, one-direction card arrival communicates a
  completed move without bouncing the words someone is reading. Its clean CSS
  boundary needs no yard policy, network call or device API. Source:
  `narduk-enterprises-clients/pacc-trac/packages/app-shell/app/assets/css/main.css`
  (`pt-settle`, motion tokens, reduced-motion block), commit
  `7c722a2648c3e456fb4aee93494bd3d9e781da98`. The design canvas's
  `design/system/project/components/Motion/README.md` explicitly records no
  overshoot and no load choreography. Keep the 180ms, three-pixel settle; expose
  timing and easing as `--ne-settle-duration` and `--ne-ease-settle`. The
  orchestrator's October 21 addendum specifically excludes the app bar.
- **NeTimelineHero — TX Spends.** A product's own number becomes the sentence;
  selectable bars provide temporal context, not decorative motion. The source
  already separates supplied columns from a selection event. Source:
  `narduk-enterprises/tx-spends/apps/web/app/components/r4/R4Hero.vue` and
  `apps/web/app/assets/css/r4.css` (`r4-hero`, `fy-cols`, motion block), commit
  `08a35db7a068e2b0cdc5fd7238722ee05c2de5fb`. Keep the controlled selection,
  partial-period treatment and phone scroll strip. Use the library's existing
  feel tokens for the headline arrival and bar updates; river art stays with the
  product and can enter through the `media` slot.
- **NeStatementHero — KZFR.** The current show is the statement, with a visible
  now/last-known marker and actions. The composition is independent of radio
  playback or WordPress. Source:
  `narduk-enterprises/kzfr-website-bid/design/canvas/frag/shared/home.html`
  (`hero`, `hero-kick`, `onair-h`) and `wordpress/theme/assets/kzfr.css`, commit
  `31d5f459414bc6be1bd5264bf878ba8838a4f35f`. Preserve the marker, large
  headline and content/media split; the app owns the factual state, clock,
  playback action and art. A stale or unknown marker always adds its visible
  qualifier, even if the caller's label omits it.

CRPC CEDS was also inspected at
`narduk-enterprises/crpc-ceds-demo/apps/web/app/pages/index.vue`, commit
`28f746cf18009b15c001b6c8ea8f75bf15585886`. Its eleven-parish river hero is
strong but depends on regional cartography and editorial art direction. The
three picks above have cleaner reusable boundaries.

The selection is supported by the lane brief's October 15 ratings and its
October 21 motion addendum, then checked against the source code and existing
canvas artifacts. Intelligence search was unavailable in this session; no
additional historical verification is claimed.

## Contracts

`NeSettle` accepts `motionKey?: string | number` (default `0`) and
`disabled?: boolean` (default `false`). Its default slot is remounted on a new
key, so keep editable inputs outside the remounted subtree. It deliberately has
no `appear` animation, no exit delay and no layout or focus policy. Set a key
only when an actual arrival occurs. Reduced motion also disables Vue's CSS
transition and the stylesheet supplies no movement under that preference. This
is a small transition wrapper; it composes with Nuxt UI cards and buttons.

`NeTimelineHero` requires `subject`, `verb`, `value: string | null` and
`periods: NeTimelinePeriod[]`. Optional `eyebrow`, `suffix`, `description`,
`timelineLabel` (default `Period`) and `modelValue` complete the contract. Each
period has a unique string `id`, visible `label`, same-unit finite nonnegative
`value` or `null`, optional formatted `valueLabel` and `partial`. Selection
emits `update:modelValue`; the caller updates both selection and headline facts.
Null, negative, NaN and infinite values draw a labelled gap. Zero draws zero;
partial data is hatched and named. All-zero/missing arrays never divide by zero.
The scale is relative to the largest reported period; it does not imply a shared
ceiling across different datasets. Keep the series bounded to a useful
comparison window. `source` and `media` are optional slots. The strip scrolls on
narrow screens and reveals the chosen period without scrolling the document; all
periods remain real, keyboard-operable Nuxt UI buttons. No data fetching or
currency arithmetic lives here.

`NeStatementHero` requires `title` and a `marker` with `state` (`current`,
`stale`, `unknown`), `label` and optional `detail`. The app must supply honest
labels and timestamps; this component never infers currentness. Optional
`eyebrow`, `description` and `links` (`NeMarketingLink[]`, Nuxt UI button props)
complete it. Slots: `actions` replaces links, `media` holds sourced art or a
product readout, default adds product context. The phone layout stacks the media
instead of hiding the fact it contains. Static presentation has no perpetual
pulse and no motion to disable.

All paint, type, radius and shadow use the existing NE token system. The two new
settle tokens are additive and scheme-independent. Existing feel timings remain
unchanged. No app navigation, roles, station schedule, chart fetching, playback
engine or regional map becomes shared policy.

## Consumer examples

Install the normal `narduk-shell` Nuxt module and theme as documented in the
package README. Types are exported from `@narduk-enterprises/narduk-shell`. The
Explorer typechecks and renders these complete examples:

- `libs-explorer/app/usage/ne-settle.usage.vue`
- `libs-explorer/app/usage/ne-timeline-hero.usage.vue`
- `libs-explorer/app/usage/ne-statement-hero.usage.vue`

Their sibling design cards are packaged with `narduk-shell`; they run outside an
app and use explicit imports. The settle button and the timeline selection are
interactive. Neither claims its fixture numbers or schedule are live.
