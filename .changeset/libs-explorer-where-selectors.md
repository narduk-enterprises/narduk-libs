---
'@narduk-enterprises/libs-explorer': patch
---

Token inventory reads custom properties declared inside zero-specificity `:where(:root, .light)` / `:where(.dark)` selectors, as narduk-shell's theme now writes them (#1785).
