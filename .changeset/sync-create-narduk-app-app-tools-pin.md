---
'@narduk-enterprises/create-narduk-app': patch
---

create-narduk-app: pick up the `@narduk-enterprises/narduk-app-tools` minor
release (`foundation:check`, D-WEBFOUND-2 Q5(a)/Q9(a)) so a freshly scaffolded
app pins the version that ships the new command. No generator behavior changes;
this is the release-plan companion changeset required whenever a generator-owned
package pin moves (company-hq#628).
