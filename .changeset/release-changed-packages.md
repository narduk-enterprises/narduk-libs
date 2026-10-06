---
'@narduk-enterprises/libs-explorer': patch
'@narduk-enterprises/narduk-logging': patch
---

The Swift quality fixture copies NardukMusic's sources, because the shared root Package.swift now declares them (#1520). libs-explorer's inventory test expects a directory without package.json to be skipped, as pnpm skips it.
