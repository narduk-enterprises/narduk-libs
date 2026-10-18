---
'@narduk-enterprises/narduk-shell': patch
'@narduk-enterprises/create-narduk-app': patch
'@narduk-enterprises/narduk-core': patch
---

Bundle the icons the package's own components name into the `@nuxt/icon` client bundle. The module scans Nuxt layers only, so an icon such as `lucide:arrow-up-down` (`NeSortHeader`) was loaded through `/api/_nuxt_icon` while a page rendered, and a cold worker waited out the module's 1500 ms timeout on the first page that used one (operator-portal#2757). Each package now adds its runtime's Lucide icons through `icon:clientBundleIcons`.
