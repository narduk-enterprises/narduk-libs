# @narduk-enterprises/narduk-ui

Narduk's shared interface library. One package, several outputs.

| Output                                      | Contents                                                                         |
| ------------------------------------------- | -------------------------------------------------------------------------------- |
| `@narduk-enterprises/narduk-ui/tokens.css`  | The Narduk Status Design System v1.0 `--ns-*` token layer                        |
| `@narduk-enterprises/narduk-ui/core`        | Framework-free measurement logic: freshness classification, value and band maths |
| `@narduk-enterprises/narduk-ui/instruments` | Measurement components: wells, range bars, ladders, readouts, freshness signals  |
| _(future)_                                  | forms, nav, marketing…                                                           |

## Publication

Published from `narduk-libs` to GitHub Packages under `@narduk-enterprises`.
Source is TypeScript, Vue, and CSS with no build step — consumers import the
exported paths directly. Pin an exact version; never use a path or monorepo
workspace protocol dependency.

## Guardrails

1. **No cross-output imports.** `instruments` may not import from a future
   `forms`. Shared primitives live in `_core`, published as the framework-free
   `@narduk-enterprises/narduk-ui/core` output — deliberately importable without Vue, so server
   routes and tests can classify freshness without a component runtime. Without
   this rule the subpaths become folders in one blob within a month.
2. **One version covers every output.** A breaking change in a future output
   bumps `instruments` consumers too. That is the accepted cost of a single
   package; it is cheaper than juggling several, but it is a real cost.
3. **Tokens are the only styling contract.** Components read `--ns-*` and never
   hardcode a colour, radius, shadow or font. An app restyles a component by
   setting its accent triplet, not by overriding component CSS.

## Design rules these components encode

From the design system, in priority order:

1. **Reference or nothing.** Every value appears against a band, median,
   conservation pool or forecast. A bare number is not information — which is
   why `NsRangeBar` requires a band and `NsLevelWell` requires a median.
2. **Missing is a state.** Gaps get the hatch material plus a mono reason line.
   Never zero-filled, never interpolated. The missing variant of any component
   keeps an identical footprint to the present variant, so a directory does not
   reflow as data arrives.
3. **Machined depth.** Hairlines, wells and bezels rather than one flat card.
4. **Numbers are mono.** Tabular IBM Plex Mono for every measurement, so columns
   align and digits never dance.
5. **Accent is never status.** Accent carries interaction, data ink and the brand
   mark. Freshness and severity use the four shared signal tokens.
