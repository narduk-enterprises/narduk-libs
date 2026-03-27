# Migrations

Breaking changes are listed here and in `CHANGELOG.md` with semver bumps.

## Policy

- **Patch:** bugfixes only, no intentional breaking changes.
- **Minor:** new features; deprecations may warn in dev.
- **Major:** breaking API or default behavior changes — each major section below describes required app updates.

## 2.0.0

- **Package name** is now **`@narduk-enterprises/narduk-charts`** (published to **GitHub Packages**). Replace imports and `npm install` / lockfile entries:
  - `narduk-charts` → `@narduk-enterprises/narduk-charts`
  - `narduk-charts/style.css` → `@narduk-enterprises/narduk-charts/style.css`
  - `narduk-charts/line` (and other subpaths) → `@narduk-enterprises/narduk-charts/line`, etc.
- Configure the `@narduk-enterprises` scope in `.npmrc` to use `https://npm.pkg.github.com` with a token that has `read:packages` (and `write:packages` for publishing).

## 1.x

- Subpath imports `@narduk-enterprises/narduk-charts/line`, `/bar`, `/pie` are additive; the root export is unchanged (pre-2.0 these were documented as `narduk-charts/line`, …).
- `ChartLegend` is now a `<fieldset>` with a screen-reader legend; visual layout is unchanged except focus rings on interactive elements.
- Line chart keyboard focus is on the SVG; arrow keys move the active category when focused.

_No breaking changes in the initial commercial roadmap drop._
