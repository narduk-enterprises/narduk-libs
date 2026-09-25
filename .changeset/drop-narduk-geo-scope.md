---
'@narduk-enterprises/narduk-platform': minor
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': patch
---

Registry auth no longer routes the retired `@narduk-geo` scope (#140). Its last consumer, farm-analytics, is retired. `patchPackageRegistryNpmrcContent` (narduk-platform) and `renderRegistryAuth` / `narduk-app registry-auth` (narduk-app-tools) now write only the `@narduk-enterprises` route. They drop a stale `@narduk-geo:registry=` line the same way they already drop `@loganrenz:registry=`. The exported constants `MAPKIT_PACKAGE_REGISTRY_SCOPE` (narduk-platform) and `NARDUK_GEO_SCOPE` (narduk-app-tools) are removed. A GitHub code search across narduk-enterprises and loganrenz found no importer outside narduk-libs.
