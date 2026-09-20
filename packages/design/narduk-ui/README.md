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
   setting tokens — its accent triplet at minimum, or any `--ns-*` its own
   design calls for — never by overriding component CSS. Apps are designed
   independently (Logan, 2026-09-19); the tokens are shared defaults, and an
   app designed from its own canvas overrides what that design needs. The
   contract is that restyling goes _through_ the token layer, not that the
   values are fixed.

   Two obligations come with an ink or surface override. Set the channel
   triplet beside the hex — `--ns-ink-rgb` with `--ns-ink`, `--ns-surface-rgb`
   with `--ns-surface` — because the machined chrome (well ticks, the dashed
   median, band and tile hairlines, the hatch, every shadow) is composited from
   the channels; changing only the hex restyles the text and leaves the chrome
   at the default ink. And clear the same contrast floor the defaults do, the
   one written on the ink block in `tokens.css`. The app that changes them owns
   that proof — `narduk-shell` requires the same of `--ne-*` overrides, and
   `operator-portal#238` is what happens when nobody does.

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
   mark. Freshness and severity use the four signal tokens. This rule holds even
   for an app that restyles those tokens: an accent that also encodes staleness
   makes brand and meaning unreadable against each other, which is a design
   argument rather than a governance one, so it survives a re-skin.

## Instruments

Import from `@narduk-enterprises/narduk-ui/instruments`. Pair with
`@narduk-enterprises/narduk-ui/tokens.css` so the `--ns-*` contract has values.
These four are the registered measurement components; a ladder is documented in
the design system but is not shipped yet.

### NsFreshnessChip

The estate's freshness chip. Pass an explicit `state`, or pass `observedAt` plus
the source's own `intervalMinutes` and let the chip classify. The second form is
preferred: it keeps the definition of "fresh" in one place rather than in each
caller.

A classified first paint also needs `now`. The chip never reads the ambient
clock during SSR — that is the hydration miss
`narduk-shell/format` documents (`formatRelative` taking `now`). Omit `now`
and the server emits a stable `ns-chip--pending` placeholder; the client
classifies after mount. Explicit `state` still renders on the server.

```vue
<script setup lang="ts">
import { NsFreshnessChip } from "@narduk-enterprises/narduk-ui/instruments";

const now = new Date("2026-07-30T12:00:00Z");
</script>

<template>
  <NsFreshnessChip observed-at="2026-07-30T11:56:00Z" :interval-minutes="10" :now="now" show-age />
</template>
```

#### Props

| Prop              | Type                                     | Default | Description                                                                                                             |
| ----------------- | ---------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| `state`           | `'live' \| 'aging' \| 'stale' \| 'void'` | —       | Explicit state. Omit to derive from `observedAt` + `intervalMinutes`                                                    |
| `observedAt`      | `Date \| string \| null`                 | —       | When the measurement was taken. Used with `intervalMinutes` when `state` is omitted                                     |
| `intervalMinutes` | `number`                                 | —       | The source's own publishing interval, not an arbitrary threshold. Required to classify from a clock                     |
| `now`             | `Date`                                   | —       | Injectable clock. Pass it for a classified first paint; omit it and the chip renders a stable placeholder until mount   |
| `showAge`         | `boolean`                                | `false` | Append the compact age, e.g. `STALE · 3 d`. A stale value is shown with its age rather than hidden. Needs `now` on SSR. |

When `state` is omitted and `intervalMinutes` (or `observedAt`) is missing, the
chip renders `void` rather than guessing live.

#### Events

None.

#### Slots

None.

---

### NsLevelWell

A recessed well with a machined tick edge at 10% intervals and a dashed
long-term median. `median` is required: a fill with nothing to compare against
is decoration. Missing wells are hatched with an em-dash, never rendered empty
— an empty well reads as "zero", which is a measurement we do not have.

```vue
<script setup lang="ts">
import { NsLevelWell } from "@narduk-enterprises/narduk-ui/instruments";
</script>

<template>
  <NsLevelWell :value="47.3" :median="60" name="Lake Travis" />
</template>
```

#### Props

| Prop            | Type             | Default     | Description                                                               |
| --------------- | ---------------- | ----------- | ------------------------------------------------------------------------- |
| `value`         | `number \| null` | —           | Current observation. `null` / non-finite renders the missing variant      |
| `median`        | `number`         | _required_  | Long-term median for this station, drawn as the dashed reference          |
| `medianLabel`   | `string`         | `'MED'`     | Label for the dashed line, e.g. `MED` or `30-YR`                          |
| `min` / `max`   | `number`         | `0` / `100` | Domain the fill and median are placed on                                  |
| `decimals`      | `number`         | `1`         | Digits in the mono readout                                                |
| `unit`          | `string`         | `'%'`       | Appended to the readout with no extra space (`47.3` + `%` → `47.3%`)      |
| `name`          | `string`         | —           | Caption under the well                                                    |
| `missingReason` | `string`         | —           | Accessible description when `value` is missing (default: `Not published`) |

#### Events

None.

#### Slots

None.

---

### NsRangeBar

Every value is shown against a reference. The shaded band is what normal looks
like for this station in this month; the marker is now. `band` is required: a
range bar without a reference is the progress bar this component exists to
retire. Missing values keep an identical footprint and take the hatch material.

```vue
<script setup lang="ts">
import { NsRangeBar } from "@narduk-enterprises/narduk-ui/instruments";
</script>

<template>
  <NsRangeBar
    label="Lake Travis"
    :value="47.3"
    :band="{ low: 55, high: 88, label: 'Normal for July' }"
    unit="ft"
  />
</template>
```

#### Props

| Prop            | Type                    | Default     | Description                                                          |
| --------------- | ----------------------- | ----------- | -------------------------------------------------------------------- |
| `value`         | `number \| null`        | —           | Current observation. `null` / non-finite renders the missing variant |
| `band`          | `{ low, high, label? }` | _required_  | The reference this value is read against                             |
| `min` / `max`   | `number`                | `0` / `100` | Domain the band, fill, marker and forecast are placed on             |
| `decimals`      | `number`                | `1`         | Digits in the mono readout                                           |
| `unit`          | `string`                | —           | Appended to the formatted value (`47.3 ft`)                          |
| `label`         | `string`                | —           | Leading label in the three-column row                                |
| `forecast`      | `number \| null`        | —           | Optional forecast peak, drawn as a hollow marker                     |
| `missingReason` | `string`                | —           | Mono reason line and accessible description when `value` is missing  |

#### Events

None.

#### Slots

None.

---

### NsReadoutTile

Label above, value in mono, change below. The missing variant occupies exactly
the same space as the present one — same padding, same line count, same height
— so a grid of tiles does not reflow as measurements arrive or drop out. That
is why the delta line renders even when empty.

```vue
<script setup lang="ts">
import { NsReadoutTile } from "@narduk-enterprises/narduk-ui/instruments";
</script>

<template>
  <NsReadoutTile
    label="Stage"
    :value="12.35"
    unit="ft"
    :delta="-1.2"
    delta-unit="ft"
    delta-window="24 h"
  />
</template>
```

#### Props

| Prop            | Type             | Default    | Description                                                                      |
| --------------- | ---------------- | ---------- | -------------------------------------------------------------------------------- |
| `label`         | `string`         | _required_ | Uppercase mono eyebrow                                                           |
| `value`         | `number \| null` | —          | Current observation. `null` / non-finite renders the missing variant             |
| `decimals`      | `number`         | `1`        | Digits in the value readout                                                      |
| `unit`          | `string`         | —          | Rendered in a sibling span after the value (margin, not a literal space)         |
| `delta`         | `number \| null` | —          | Change over the stated window. Direction colours are signal tokens, not good/bad |
| `deltaUnit`     | `string`         | —          | Unit on the formatted delta                                                      |
| `deltaWindow`   | `string`         | —          | Window suffix, e.g. `24 h`, rendered as `/ 24 h`                                 |
| `size`          | `'md' \| 'lg'`   | `'md'`     | `lg` uses the `--ns-readout-xl-*` token pair                                     |
| `missingReason` | `string`         | —          | Shown on the delta line when `value` is missing (default: `Not published`)       |

#### Events

None.

#### Slots

None.
