---
'@narduk-enterprises/narduk-analytics': patch
---

Send GA4 pageviews with manual events after the initial route and successful SPA
path changes. The Google tag is now configured once without automatic pageview
emission, preventing repeated configuration from dropping SPA views.
