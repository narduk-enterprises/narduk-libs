---
'@narduk-enterprises/narduk-app-tools': minor
---

`narduk-app assets generate` draws the favicon set (a real 16/32/48 px ICO, `favicon.svg`, a 32 px PNG, a 180 px opaque apple-touch icon), the 192/512/maskable manifest icons, `site.webmanifest` and the default 1200×630 share card from `Config/brand.json`, with bundled OFL type so the card renders the same on any machine. The card has four layouts (`poster`, `split`, `stamp`, `ledger`) and five textures. `narduk-app assets check` fails (exit 1) when any of those files is missing, `favicon.ico` is a placeholder or not a real ICO, the apple-touch icon is transparent, the manifest lacks its icons, or the share card is missing, flat or the legacy generic create-narduk-app card; `--live [url]` also checks the deployed head links and theme-color and fetches each file. `og:generate` renders the brand card when `defaultImage.source` is absent, and `assets favicons` now writes a real ICO.
