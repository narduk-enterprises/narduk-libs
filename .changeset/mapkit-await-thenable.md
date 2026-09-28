---
'@narduk-enterprises/narduk-mapkit': patch
'@narduk-enterprises/create-narduk-app': patch
---

Test-only: the SSR preload hydration tests call unhead 3's synchronous `renderSSRHead`/`renderDOMHead` without `await`, clearing the package's last lint warnings. No runtime change.
