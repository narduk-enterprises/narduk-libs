---
'@narduk-enterprises/narduk-analytics': patch
'@narduk-enterprises/create-narduk-app': patch
---

Register the optional analytics click directive on the server with a no-op stub,
so server-rendered tracked links remain available before hydration. Client
validation and click capture keep their existing behavior.
