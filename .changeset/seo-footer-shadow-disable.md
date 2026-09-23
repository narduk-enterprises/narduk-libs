---
'@narduk-enterprises/narduk-seo': patch
---

`LayerAppFooter.vue` now carries a justified inline disable for the new
`narduk/no-shadowed-shared-component` rule. The component is a deliberate fork
of narduk-core's footer, kept only to render `<LayerNetworkFooter />`, and
narduk-libs#743 replaces it with a core slot. Runtime behaviour is unchanged.
