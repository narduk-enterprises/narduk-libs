# Migrations

Breaking changes are listed here and in `CHANGELOG.md` with semver bumps.

## Policy

- **Patch:** bugfixes only, no intentional breaking changes.
- **Minor:** new features; deprecations may warn in dev.
- **Major:** breaking API or default behavior changes — each major section below describes required app updates.

## Unreleased / 1.x

- Subpath imports `narduk-charts/line`, `/bar`, `/pie` are additive; the root export is unchanged.
- `ChartLegend` is now a `<fieldset>` with a screen-reader legend; visual layout is unchanged except focus rings on interactive elements.
- Line chart keyboard focus is on the SVG; arrow keys move the active category when focused.

_No breaking changes in the initial commercial roadmap drop._
