# @narduk-enterprises/stylelint-config

Stylelint baseline for Narduk CSS. Rules are warn-level. `narduk-stylelint`
holds those warnings to a checked-in `stylelint-budget.json` (per rule and per
file), the same ratchet as `narduk-lint`.

## Rules

- `narduk/no-raw-z-index` — `z-index` must be `var(--ns-z-*)`
- `narduk/no-legacy-breakpoints` — media queries may not use 620/820/1080 px
- `narduk/bs-alias-only` — `--bs-*` must be `var(--ns-*)` of the same stem

Stylelint 16's `media-feature-name-value-allowed-list` does read CSS range
syntax (`width < 40rem`), so width values are limited to Tailwind `40rem` /
`64rem`. The custom rule still names the retired 620/820/1080 scale.

## Usage

```js
export { default } from '@narduk-enterprises/stylelint-config'
```

```json
{ "scripts": { "lint": "narduk-stylelint" } }
```
