---
'@narduk-enterprises/narduk-seo': minor
---

narduk-seo no longer ships its own copy of `LayerAppFooter` (narduk-libs#743).
It registers `LayerNetworkFooter` globally and adds it to
`appConfig.nardukCore.footer.after`, so narduk-core's footer renders the network
row. The footer an app sees is unchanged. This needs narduk-core 2.11.0 or
later, and the peer range now says so.
