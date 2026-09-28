---
'@narduk-enterprises/narduk-realtime': patch
---

`withUpgradeRouter` now types its returned `fetch` as `Promise<Response>` (new exported `UpgradeRoutedHandler` type), matching what it returns at runtime even when the wrapped handler's `fetch` is synchronous.
