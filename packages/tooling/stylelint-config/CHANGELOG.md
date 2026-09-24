# @narduk-enterprises/stylelint-config

## 0.2.0

### Minor Changes

- 1c10b9b: Phase 1c of the libs modernize review (narduk-libs#535): narduk-ui
  ships the `--ns-z-*` page and map layer scale, moves media queries from
  620/820/1080 to Tailwind `40rem`/`64rem` (small visible layout shift in every
  narduk-ui app), and maps `--bs-*` onto `--ns-*`.
  `@narduk-enterprises/stylelint-config` is the warn-level gate with a
  ratcheting per-rule and per-file budget. Stylelint 16's
  `media-feature-name-value-allowed-list` does read range syntax, so width
  values are limited to `40rem`/`64rem`. The custom rule still names the retired
  620/820/1080 scale. libs-explorer's inventory lists the new package.
