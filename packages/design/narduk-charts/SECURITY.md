# Security

## Dependency audits

CI runs `pnpm audit --audit-level high` at the repository root on pushes and
PRs; it honors the ignore list in the root `package.json`
(`pnpm.auditConfig.ignoreGhsas`). Run that command from the root, not `npm audit`
in this package (it has no `package-lock.json`).

## Content Security Policy

- **SVG export / PNG rasterization** uses blob URLs and an in-memory `<img>` +
  `<canvas>`. Allow `blob:` for `img-src` (and avoid blocking inline data where
  the browser requires it) if you expose export in a strict CSP environment.
- The library does not inject remote scripts; chart CSS is static.

## Reporting

Open a private security advisory on the repository or contact the maintainers
per `package.json` `repository` / author.

## License

This package is released under the MIT License (`LICENSE` / `package.json`).
Enterprise dual-licensing is a packaging decision outside this file.
