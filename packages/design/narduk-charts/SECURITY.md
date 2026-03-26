# Security

## Dependency audits

Run `npm audit` regularly; CI runs `npm audit --audit-level=high` on pushes and PRs.

## Content Security Policy

- **SVG export / PNG rasterization** uses blob URLs and an in-memory `<img>` + `<canvas>`. Allow `blob:` for `img-src` (and avoid blocking inline data where the browser requires it) if you expose export in a strict CSP environment.
- The library does not inject remote scripts; chart CSS is static.

## Reporting

Open a private security advisory on the repository or contact the maintainers per `package.json` `repository` / author.

## License

This package is released under the MIT License (`LICENSE` / `package.json`). Enterprise dual-licensing is a packaging decision outside this file.
