---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

foundation:check items 3.1 and 3.2 treat `access.exposureClass: customer-authenticated` as a login app: 3.1 is not-applicable and 3.2 requires narduk-auth. Before this, such an app was read as a public site and failed 3.1 for missing narduk-seo and narduk-analytics.
