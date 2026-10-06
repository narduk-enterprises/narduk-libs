---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

The `colorMode` defaults, `classSuffix: ''` among them, now reach the built page. narduk-core wrote them after it had already installed `@nuxtjs/color-mode`, which reads its options once in its own setup, so an app that stated no `colorMode` key still shipped `class="dark-mode"` and every `.dark` rule stayed inert. The defaults are now written before the install, and an app's own `colorMode` values still win. Proved on a real build of a consumer that names no `colorMode` (#1464).
