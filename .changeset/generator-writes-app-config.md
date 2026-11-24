---
'@narduk-enterprises/create-narduk-app': minor
---

`create-narduk-app` writes `Config/cloudflare-app.json` again. The Operator Portal is retired as the
source of an app's declaration (Logan, 2026-11-24): the file in the app's repository is the source,
and apps run `narduk-app` with `NARDUK_APP_CONFIG_SOURCE=file`. The generated file holds what a
checkout can know (product identity, the Worker shape, the exposure class, the bindings mirror);
onboarding adds `product.repository`, the Cloudflare account id, `domains` and the `deployment`
block to it. The resolver in `narduk-app-tools` is unchanged: `auto` still reads a local file first.
