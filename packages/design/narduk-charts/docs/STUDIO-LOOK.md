# The studio look

`look="studio"` is an opt-in presentation for `NardukLineChart` (and the frame of every
other chart) that makes a chart read like an editorial data graphic instead of a widget.
`look="classic"` (the default) is unchanged, so no existing consumer repaints.

The lab (`pnpm exec vite --config vite.lab.config.ts`, port 5181) draws real public data
(CDC NWSS wastewater and NSSP ED visits for the Kansas City region) in every look. Judge
a change there, light and dark, at 1280 and 375 px.

## Direction

Five things from the world these charts serve: a weekly sampling cadence, public-health
threshold levels, seasons compared year over year, a short projection with its
uncertainty, and "this week" as the only number a reader acts on.

**Signature: the now tag and the level rail.** The latest value of each emphasized
series ends in a ringed dot, and its value sits in a tag in the right gutter at that
height, the way a trading chart pins the last price. Threshold bands (`yBands`) stop
being pastel blocks across the plot: the plot carries a faint wash and a 4px rail on the
right edge carries the band colour at full strength, labelled in the gutter. Everything
else stays quiet.

**Defaults we do not use.**
1. A marker on every point, and Catmull-Rom curves that overshoot spiky weekly data
   below zero.
2. Every series at equal weight: the current season and two past ones fight.
3. Card-in-card chrome: a rounded, shadowed, gradient frame inside the consumer's card,
   a centred title and a detached legend under the plot.

## Spec

| Part | Classic | Studio |
| --- | --- | --- |
| Frame | rounded border, shadow, gradient | none: transparent, sits in the host card |
| Title / description | centred | left-aligned, title 14px semibold, description muted 12px |
| Legend | dots, centred below | line keys (14×2px), left-aligned above the plot, inline |
| Grid | horizontal + vertical | horizontal hairlines only; baseline one step stronger |
| Y axis | line + labels | no line; labels right-aligned in the gutter, 11px tabular, muted |
| Unit | — | `yUnit` prints after the top tick label |
| Lines | 2px Catmull-Rom | 2px, monotone cubic when `smooth` (never overshoots), round caps |
| Series emphasis | — | `emphasis: 'context'` series draw 1.5px at 40% via `color-mix` with muted, no tag, behind the rest |
| Area | flat 0.1 fill | `showArea` (or a single emphasized series) is a vertical fade, 16% to 0 |
| Last value | — | ringed dot (r 4, 2px surface ring) + gutter now tag (`showNowTag`, default on in studio) |
| End labels | — | `endLabels`: series name beside the now tag when ≤ 4 series; collisions fall back to the legend |
| yBands | 0.12 fill blocks | 0.06 wash + 4px rail at the right plot edge in the band colour; labels in the gutter when the band is ≥ 14px tall |
| Projection band (`bands`) | accent fill | the paired series' colour at 14% |
| Crosshair | — | vertical hairline + a ringed dot on each visible series at the hovered index |
| X ticks | can overlap at the right edge | never overlap: the last label wins, its neighbour is dropped |
| Motion | draw-in | draw-in 600ms ease-out; respects reduced motion |

Dark mode is selected, not flipped: its own grid, muted and surface steps in
`.narduk-chart--dark.narduk-chart--look-studio`.

Text never wears a series colour: tags and end labels are ink on a surface chip with a
series-coloured key.
