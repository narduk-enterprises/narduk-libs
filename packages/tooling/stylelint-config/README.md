# @narduk-enterprises/stylelint-config

Stylelint baseline for Narduk CSS. Rules are warn-level, and `narduk-stylelint`
is **strict: 0 errors, 0 warnings**. Any warning fails, like
`stylelint --max-warnings 0`, whether or not a `stylelint-budget.json` exists.
Warning budgets are retired (v1.0.0, Logan 2026-10-01; see
`@narduk-enterprises/eslint-config` DESIGN.md, "Strict, no budgets"): a
`stylelint-budget.json` that still lists a rule or file entry above 0 fails with
a message to fix those warnings and delete the entries, and an empty one passes
with a notice to delete it. The tool never writes a file. A new warn-level rule
in this package turns every consumer that violates it red on upgrade.

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
{ "scripts": { "lint": "narduk-stylelint \"**/*.css\"" } }
```

With no arguments, `narduk-stylelint` lints `**/*.{css,scss}` only. Vue SFCs
need a Stylelint `customSyntax` (for example `postcss-html`) and an explicit
path; the shared config does not parse `<style>` blocks.

Exit codes: `0` pass; `1` a lint error, any warning, or a budget file that still
allows warnings; `2` a usage or configuration error. `--accept-new-rules` is
refused. `--ci`, `--local`, `--no-write` and `--verbose` are accepted and do
nothing.
