---
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/narduk-seo': minor
---

`Config/brand.json` takes an optional `fonts.display` (`family`, `weight`, `style`, or a local `.ttf` `file`). `narduk-app assets generate` resolves it from Google Fonts (or the file) into `public/fonts/brand-display.ttf` and sets the static card's title and monogram in it; `assets check` fails when that file is missing or a variable font. narduk-seo serves the same file as an app `@font-face`, so the runtime `OgImageDefault` and `OgImageArticle` cards use it for the title and monogram and the app gets `--brand-font-display` for its wordmark. A face that cannot be resolved falls back to the bundled one with a warning. The card renderer now forces libvips onto fontconfig (`PANGOCAIRO_BACKEND=fc`, a minimal `FONTCONFIG_FILE`), so macOS renders the bundled and brand fonts instead of Helvetica.
