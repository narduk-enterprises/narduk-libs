---
'@narduk-enterprises/narduk-mapkit': patch
'@narduk-enterprises/create-narduk-app': patch
---

Check the same-origin token route before downloading MapKit JS. Unconfigured or refused maps skip the SDK, concurrent callers share the preflight, and the first token is reused for initialization while renewal still requests a fresh token.
