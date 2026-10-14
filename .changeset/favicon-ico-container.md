---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

`narduk-app assets favicons` writes `favicon.ico` as a real ICO container holding 16, 32 and 48 px PNG images. Before this, it wrote bare 32 px PNG bytes under the `.ico` name.
