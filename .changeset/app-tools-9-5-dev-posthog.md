---
'@narduk-enterprises/narduk-app-tools': patch
---

Doctor item 9.5 no longer names a `posthog-js` pin that sits only in `devDependencies`. That pin is a test or tooling dependency (it ships in no bundle), so the "pins posthog-js directly with no import in the scanned source" heuristic now fires only for a pin in `dependencies`, `optionalDependencies` or `peerDependencies`. Direct `posthog-js` imports in scanned app source still fail as before. Fixes harbor reading Platform=unknown on /products.
